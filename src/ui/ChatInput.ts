import { parseResponse } from '../pipeline/ResponseParser';
import { toFriendlyError } from '../utils/errorMessages';
import type { AvatarManager } from '../avatar/AvatarManager';
import type { SpeechBubble } from './SpeechBubble';
import type { LLMClient } from '../pipeline/LLMClient';
import type { ScreenshotPipeline } from '../pipeline/ScreenshotPipeline';

export class ChatInput {
  private container: HTMLDivElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private isProcessing = false;
  private history: Array<{role: string; content: string}> = [];

  constructor(
    private avatarManager: AvatarManager,
    private speechBubble: SpeechBubble,
    private llmClient: LLMClient,
    private pipeline: ScreenshotPipeline
  ) {
    // Create DOM elements
    this.container = document.createElement('div');
    this.container.className = 'chat-input-container hidden';
    this.container.id = 'chat-input';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'Say something...';

    this.sendBtn = document.createElement('button');
    this.sendBtn.textContent = 'Send';

    const lookBtn = document.createElement('button');
    lookBtn.textContent = 'Look';
    lookBtn.className = 'look-btn-inline';
    lookBtn.title = 'Look at my screen now';

    this.container.appendChild(this.input);
    this.container.appendChild(this.sendBtn);
    this.container.appendChild(lookBtn);
    document.body.appendChild(this.container);

    // ----- Event listeners -----

    this.sendBtn.addEventListener('click', () => this.send());
    lookBtn.addEventListener('click', () => {
      this.hide();
      this.pipeline.runPipeline();
    });

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
    if (this.isProcessing) return;
    if (!text) {
      // Shake animation on empty submit
      this.container.classList.remove('shake');
      // Force reflow to re-trigger animation
      void this.container.offsetWidth;
      this.container.classList.add('shake');
      this.container.addEventListener('animationend', () => {
        this.container.classList.remove('shake');
      }, { once: true });
      return;
    }

    this.isProcessing = true;
    this.pipeline.pause();
    this.input.value = '';
    this.hide();

    const SYSTEM_PROMPT =
      'You are Dubly, a tiny cute alien on the user\'s desktop. The user is chatting with you.\n' +
      '\n' +
      'Rules:\n' +
      '- 1-2 sentences max\n' +
      '- Be cute, curious, a little sassy\n' +
      '- You don\'t fully understand human stuff\n' +
      '- Never say you are an AI\n' +
      '\n' +
      'Always reply in this exact format:\n' +
      'MOOD: <one of: happy, surprised, sad, angry, neutral, confused>\n' +
      'COMMENT: <your reply>\n' +
      '\n' +
      'Examples:\n' +
      'MOOD: happy\n' +
      'COMMENT: Hi human! What are we doing today?\n' +
      'MOOD: confused\n' +
      'COMMENT: You want me to explain... feelings? I barely understand gravity!';

    try {
      this.speechBubble.showThinking();

      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...this.history.slice(-10),
        { role: 'user', content: text },
      ];

      const response = await this.llmClient.queryLLMChat(messages);

      const parsed = parseResponse(response);

      this.history.push({ role: 'user', content: text });
      this.history.push({ role: 'assistant', content: parsed.comment });
      // Keep history bounded
      if (this.history.length > 20) {
        this.history = this.history.slice(-20);
      }

      // Display response
      this.avatarManager.setMood(parsed.mood);
      this.avatarManager.setTalking(true);
      await this.speechBubble.show(parsed.comment);
      this.avatarManager.setTalking(false);
      this.avatarManager.setReacting();
      await this.speechBubble.waitForHide();
    } catch (error) {
      console.error('Chat error:', error);
      const friendly = toFriendlyError(error);
      this.avatarManager.setMood('confused');
      this.avatarManager.setTalking(true);
      await this.speechBubble.show(friendly);
      this.avatarManager.setTalking(false);
      await this.speechBubble.waitForHide();
    } finally {
      this.pipeline.resume();
      this.isProcessing = false;
    }
  }
}
