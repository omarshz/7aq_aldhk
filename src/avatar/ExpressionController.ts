import type { VRM } from '@pixiv/three-vrm';
import type { Mood } from '../types/avatar';
import { MOOD_TO_EXPRESSION } from '../types/avatar';

export class ExpressionController {
  private currentMood: Mood = 'neutral';
  private blinkTimer = 0;
  private nextBlinkTime = 3;
  private isBlinking = false;
  private blinkProgress = 0;

  // Target and current expression values for lerping
  private targetExpressions: Record<string, number> = {};
  private currentExpressions: Record<string, number> = {};

  // Cache of expression names actually present on this model
  private availableExpressions = new Set<string>();

  constructor(private vrm: VRM) {
    // Build the set of expressions this particular model supports.
    // This prevents setValue calls for presets the model does not have.
    if (vrm.expressionManager) {
      for (const expr of vrm.expressionManager.expressions) {
        if (expr.expressionName) {
          this.availableExpressions.add(expr.expressionName);
        }
      }
    }

    // Log which mood expressions the model supports for debugging
    const moodExpressions = ['happy', 'surprised', 'sad', 'angry'];
    const missing = moodExpressions.filter(e => !this.availableExpressions.has(e));
    if (missing.length > 0) {
      console.warn(`VRM model missing mood expressions: ${missing.join(', ')} — using body language fallback`);
    }
  }

  /** Returns true if the loaded VRM has the given expression preset. */
  private hasExpression(name: string): boolean {
    return this.availableExpressions.has(name);
  }

  setMood(mood: Mood): void {
    // Clear previous mood expression target
    const prevExpr = MOOD_TO_EXPRESSION[this.currentMood];
    if (prevExpr && prevExpr !== 'neutral' && this.hasExpression(prevExpr)) {
      this.targetExpressions[prevExpr] = 0;
    }

    this.currentMood = mood;

    // Set new mood expression target (only if model supports it)
    const newExpr = MOOD_TO_EXPRESSION[mood];
    if (newExpr && newExpr !== 'neutral' && this.hasExpression(newExpr)) {
      this.targetExpressions[newExpr] = 1;
    }
  }

  setMouth(shape: string, value: number): void {
    if (!this.hasExpression(shape)) return;
    this.vrm.expressionManager?.setValue(shape, value);
  }

  update(delta: number): void {
    this.updateBlink(delta);
    this.updateExpressionLerp(delta);
  }

  private updateBlink(delta: number): void {
    // Skip blinking entirely if the model has no blink expression
    if (!this.hasExpression('blink')) return;

    if (!this.isBlinking) {
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.isBlinking = true;
        this.blinkProgress = 0;
        this.blinkTimer = 0;
        this.nextBlinkTime = 2 + Math.random() * 5;
      }
    } else {
      this.blinkProgress += delta * 10;
      if (this.blinkProgress <= 1) {
        // Closing
        this.vrm.expressionManager?.setValue('blink', this.blinkProgress);
      } else if (this.blinkProgress <= 2) {
        // Opening
        this.vrm.expressionManager?.setValue('blink', 2 - this.blinkProgress);
      } else {
        this.vrm.expressionManager?.setValue('blink', 0);
        this.isBlinking = false;
      }
    }
  }

  private updateExpressionLerp(delta: number): void {
    const lerpSpeed = delta / 0.3; // ~300ms transition

    for (const [name, target] of Object.entries(this.targetExpressions)) {
      if (!this.hasExpression(name)) continue;

      const current = this.currentExpressions[name] ?? 0;
      const newVal = Math.max(0, Math.min(1, current + (target - current) * Math.min(lerpSpeed, 1)));
      this.currentExpressions[name] = newVal;
      this.vrm.expressionManager?.setValue(name, newVal);
    }
  }
}
