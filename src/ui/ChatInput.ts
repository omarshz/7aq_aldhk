import { invoke } from '@tauri-apps/api/core';
import { parseResponse } from '../pipeline/ResponseParser';
import type { AvatarManager } from '../avatar/AvatarManager';
import type { SpeechBubble } from './SpeechBubble';
import type { LLMClient } from '../pipeline/LLMClient';

export class ChatInput {
  private container: HTMLDivElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private isProcessing = false;

  constructor(
    private avatarManager: AvatarManager,
    private speechBubble: SpeechBubble,
    private llmClient: LLMClient
  ) {
    // Create DOM elements
    this.container = document.createElement('div');
    this.container.className = 'chat-input-container hidden';
    this.container.id = 'chat-input';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'Say something to Dubly...';

    this.sendBtn = document.createElement('button');
    this.sendBtn.textContent = 'Send';

    this.container.appendChild(this.input);
    this.container.appendChild(this.sendBtn);
    document.body.appendChild(this.container);

    // ----- Event listeners -----

    this.sendBtn.addEventListener('click', () => this.send());

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.send();
      if (e.key === 'Escape') this.hide();
    });

    // Stop mousedown inside the chat input from propagating to the
    // document-level avatar-click handler, which would immediately close
    // the chat (since the click is not on the avatar).
    this.container.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  /** Whether the text input currently has keyboard focus. */
  isFocused(): boolean {
    return document.activeElement === this.input;
  }

  toggle(): void {
    if (this.container.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  show(): void {
    this.container.classList.remove('hidden');
    // Use requestAnimationFrame so the element is rendered before we focus.
    // Some WebView engines drop the focus call if the element is not yet
    // visible.
    requestAnimationFrame(() => {
      this.input.focus();
    });
  }

  hide(): void {
    this.container.classList.add('hidden');
    this.input.value = '';
    this.input.blur();
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.isProcessing) return;

    this.isProcessing = true;
    this.input.value = '';
    this.hide();

    try {
      const config = this.llmClient.getConfig();
      const response = await invoke<string>('query_llm_chat', {
        endpoint: config.endpoint,
        model: config.model,
        userMessage: text,
      });

      const parsed = parseResponse(response);

      // Display response
      this.avatarManager.setMood(parsed.mood);
      this.avatarManager.setTalking(true);
      await this.speechBubble.show(parsed.comment);
      this.avatarManager.setTalking(false);
      this.avatarManager.setReacting();
      await this.speechBubble.waitForHide();
    } catch (error) {
      console.error('Chat error:', error);
      const friendly = chatFriendlyError(error);
      this.avatarManager.setMood('confused');
      this.avatarManager.setTalking(true);
      await this.speechBubble.show(friendly);
      this.avatarManager.setTalking(false);
      await this.speechBubble.waitForHide();
    } finally {
      this.isProcessing = false;
    }
  }
}

/** Convert a raw error into a short, user-facing message for the speech bubble. */
function chatFriendlyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Hmm, I couldn't think of a response...";
  }

  const msg = error.message.toLowerCase();

  if (msg.includes('connection') || msg.includes('refused') || msg.includes('network')) {
    return "I can't reach my brain right now -- is LM Studio running?";
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'I took too long thinking about that... try again?';
  }
  if (msg.includes('parse') || msg.includes('json')) {
    return 'I got a weird response and could not make sense of it.';
  }

  return "Hmm, I couldn't think of a response. Try again in a moment!";
}
