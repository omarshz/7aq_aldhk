import { LLMClient } from './LLMClient';
import { parseResponse } from './ResponseParser';
import type { AvatarManager } from '../avatar/AvatarManager';
import type { MovementController } from '../avatar/MovementController';
import type { SpeechBubble } from '../ui/SpeechBubble';
import type { LLMResponse } from '../types/llm';

export class ScreenshotPipeline {
  private llmClient: LLMClient;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private initialTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private paused = false;
  private intervalMs: number;

  constructor(
    private avatarManager: AvatarManager,
    private movementController: MovementController,
    private speechBubble: SpeechBubble
  ) {
    this.llmClient = new LLMClient();
    this.intervalMs = 30000;
  }

  getLLMClient(): LLMClient {
    return this.llmClient;
  }

  start(): void {
    // Run once after a short delay, then start the recurring interval.
    // The initial timeout is tracked so stop() and setInterval() can cancel it.
    this.initialTimeoutId = setTimeout(() => {
      this.initialTimeoutId = null;
      this.runPipeline();
    }, 5000);

    this.intervalId = setInterval(() => {
      if (!this.paused) {
        this.runPipeline();
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.intervalId) {
      // Only restart the recurring interval -- do not re-trigger the initial
      // delayed run (which would cause a duplicate pipeline execution).
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        if (!this.paused) {
          this.runPipeline();
        }
      }, this.intervalMs);
    }
  }

  private async runPipeline(): Promise<void> {
    if (this.isProcessing || this.paused) return;
    this.isProcessing = true;

    // Pause movement during response
    this.movementController.pause();

    try {
      // Step 1: Capture screen
      const screenshot = await this.llmClient.captureScreen();

      // Step 2: Query LLM
      const rawResponse = await this.llmClient.queryLLM(screenshot);

      // Step 3: Parse response
      const response = parseResponse(rawResponse);

      // Step 4: Display response
      await this.displayResponse(response);
    } catch (error) {
      console.error('Pipeline error:', error);

      // Provide a user-friendly fallback without raw error internals
      const friendly = toFriendlyError(error);
      await this.displayResponse({
        mood: 'confused',
        comment: friendly,
      });
    } finally {
      this.isProcessing = false;
      this.movementController.resume();
    }
  }

  private async displayResponse(response: LLMResponse): Promise<void> {
    // Set mood expression
    this.avatarManager.setMood(response.mood);

    // Start talking animation
    this.avatarManager.setTalking(true);

    // Show speech bubble with typewriter
    await this.speechBubble.show(response.comment);

    // Stop talking, start reacting
    this.avatarManager.setTalking(false);
    this.avatarManager.setReacting();

    // Wait for auto-hide
    await this.speechBubble.waitForHide();
  }
}

/** Map raw error objects to short, friendly messages for the speech bubble. */
function toFriendlyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "I can't seem to see anything right now!";
  }

  const msg = error.message.toLowerCase();

  if (msg.includes('connection') || msg.includes('refused') || msg.includes('network')) {
    return "I can't reach my brain right now -- is LM Studio running?";
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'My brain is taking too long to respond... try again in a moment!';
  }
  if (msg.includes('capture') || msg.includes('screenshot') || msg.includes('monitor')) {
    return "I couldn't get a look at your screen. Something blocked my view!";
  }
  if (msg.includes('parse') || msg.includes('json')) {
    return 'I got a weird response and could not make sense of it.';
  }

  return "Hmm, something went wrong. I'll try again shortly!";
}
