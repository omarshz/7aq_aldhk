import { LLMClient } from './LLMClient';
import { parseResponse } from './ResponseParser';
import { toFriendlyError } from '../utils/errorMessages';
import type { AvatarManager } from '../avatar/AvatarManager';
import type { MovementController } from '../avatar/MovementController';
import type { SpeechBubble } from '../ui/SpeechBubble';
import type { LLMResponse } from '../types/llm';

// ─── Smart interval constants ─────────────────────────────────────────────────
const INTERVAL_ACTIVE = 30_000;   // 30s when user is actively interacting
const INTERVAL_IDLE = 60_000;     // 60s when idle for 2+ minutes
const IDLE_THRESHOLD = 120_000;   // 2 minutes without interaction -> idle mode
const DEBOUNCE_MS = 500;          // debounce rapid state changes to prevent animation thrashing

export class ScreenshotPipeline {
  private llmClient: LLMClient;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private initialTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private paused = false;
  private intervalMs: number;

  // ─── Smart interval: track user interaction ─────────────────────────
  private lastInteractionTime = Date.now();
  private isIdleMode = false;
  private idleCheckId: ReturnType<typeof setInterval> | null = null;

  // ─── Debounce: prevent animation thrashing from rapid state changes ─
  private pendingDisplayTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastResponse: LLMResponse | null = null;

  constructor(
    private avatarManager: AvatarManager,
    private movementController: MovementController,
    private speechBubble: SpeechBubble
  ) {
    this.llmClient = new LLMClient();
    this.intervalMs = INTERVAL_ACTIVE;
  }

  getLLMClient(): LLMClient {
    return this.llmClient;
  }

  /** Call this whenever the user interacts (chat, click, etc.) to keep active interval. */
  notifyUserInteraction(): void {
    this.lastInteractionTime = Date.now();
    // If we were in idle mode, switch back to active interval
    if (this.isIdleMode) {
      this.isIdleMode = false;
      this.intervalMs = INTERVAL_ACTIVE;
      this.restartInterval();
    }
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

    // Perf: periodically check for idle mode to increase interval
    this.idleCheckId = setInterval(() => {
      if (!this.isIdleMode && Date.now() - this.lastInteractionTime > IDLE_THRESHOLD) {
        this.isIdleMode = true;
        this.intervalMs = INTERVAL_IDLE;
        this.restartInterval();
      }
    }, 10_000);
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
    if (this.idleCheckId) {
      clearInterval(this.idleCheckId);
      this.idleCheckId = null;
    }
    if (this.pendingDisplayTimeout) {
      clearTimeout(this.pendingDisplayTimeout);
      this.pendingDisplayTimeout = null;
    }
    this.isProcessing = false;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  setInterval(ms: number): void {
    this.intervalMs = ms;
    this.restartInterval();
  }

  /** Restart the recurring interval with the current intervalMs. */
  private restartInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        if (!this.paused) {
          this.runPipeline();
        }
      }, this.intervalMs);
    }
  }

  async runPipeline(): Promise<void> {
    if (this.isProcessing || this.paused) return;
    this.isProcessing = true;

    // Pause movement during response
    this.movementController.pause();

    try {
      this.speechBubble.showThinking();

      // Step 1: Capture screen (returns JSON with b64 + changed flag)
      const captureResult = await this.llmClient.captureScreen();

      // Perf: parse the capture result to check if screen changed
      let screenshotB64: string;
      let screenChanged = true;
      try {
        const parsed = JSON.parse(captureResult);
        screenshotB64 = parsed.b64;
        screenChanged = parsed.changed;
      } catch {
        // Fallback: treat as raw b64 string (backwards compat)
        screenshotB64 = captureResult;
      }

      // Perf: skip LLM call if screen hasn't changed
      if (!screenChanged && this.lastResponse) {
        this.speechBubble.hide();
        this.isProcessing = false;
        this.movementController.resume();
        return;
      }

      // Step 2: Query LLM
      const rawResponse = await this.llmClient.queryLLM(screenshotB64);

      // Step 3: Parse response
      const response = parseResponse(rawResponse);

      // Step 4: Display response (debounced to prevent animation thrashing)
      await this.debouncedDisplay(response);
    } catch (error) {
      console.error('Pipeline error:', error);

      // Provide a user-friendly fallback without raw error internals
      const friendly = toFriendlyError(error);
      await this.debouncedDisplay({
        mood: 'confused',
        comment: friendly,
      });
    } finally {
      this.isProcessing = false;
      this.movementController.resume();
    }
  }

  /**
   * Debounce rapid display calls to prevent animation thrashing.
   * If another display is requested within DEBOUNCE_MS, the previous one is cancelled.
   */
  private debouncedDisplay(response: LLMResponse): Promise<void> {
    // Cancel any pending debounced display
    if (this.pendingDisplayTimeout) {
      clearTimeout(this.pendingDisplayTimeout);
      this.pendingDisplayTimeout = null;
    }

    this.lastResponse = response;

    return new Promise<void>((resolve) => {
      this.pendingDisplayTimeout = setTimeout(async () => {
        this.pendingDisplayTimeout = null;
        await this.displayResponse(response);
        resolve();
      }, DEBOUNCE_MS);
    });
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
