import type { VRM } from '@pixiv/three-vrm';
import type { Mood } from '../types/avatar';
import { MOOD_TO_EXPRESSION } from '../types/avatar';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(t, 1);
}

const MOUTH_SHAPES = ['aa', 'oh', 'ih', 'ee', 'ou'] as const;

export class ExpressionController {
  private currentMood: Mood = 'neutral';
  private availableExpressions = new Set<string>();

  // Blink
  private blinkTimer = 0;
  private nextBlinkTime = 3 + Math.random() * 3;
  private blinkPhase: 'closed' | 'opening' | 'pause' | 'idle' = 'idle';
  private blinkElapsed = 0;
  private isDoubleBlink = false;
  private doubleBlinkDone = false;

  // Expression
  private currentExpressions: Record<string, number> = {};
  private moodExpression: string | null = null;
  private moodIntensity = 0;
  private moodTargetIntensity = 0;
  private moodHoldTimer = 0;
  private moodHoldDuration = 0;
  private moodReturning = false;

  // Thinking
  private isThinking = false;
  private thinkingIntensity = 0;

  // Talking
  private isTalking = false;
  private talkTimer = 0;
  private currentMouthShape = 0;

  // Eye drift
  private eyeDriftTimer = 0;
  private nextEyeDriftTime = 3 + Math.random() * 2;
  private eyeYaw = 0;
  private eyePitch = 0;
  private eyeTargetYaw = 0;
  private eyeTargetPitch = 0;
  private eyeDriftHoldTimer = 0;
  private eyeDrifting = false;

  constructor(private vrm: VRM) {
    if (vrm.expressionManager) {
      for (const expr of vrm.expressionManager.expressions) {
        if (expr.expressionName) {
          this.availableExpressions.add(expr.expressionName);
        }
      }
    }
  }

  private has(name: string): boolean {
    return this.availableExpressions.has(name);
  }

  private setExpr(name: string, value: number): void {
    if (!this.has(name)) return;
    this.vrm.expressionManager?.setValue(name, value);
    this.currentExpressions[name] = value;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  setMood(mood: Mood): void {
    // Clear previous mood expression
    if (this.moodExpression && this.moodExpression !== 'neutral') {
      this.setExpr(this.moodExpression, 0);
    }

    this.currentMood = mood;
    const expr = MOOD_TO_EXPRESSION[mood];

    if (expr && expr !== 'neutral' && this.has(expr)) {
      this.moodExpression = expr;
      this.moodTargetIntensity = 0.5 + Math.random() * 0.2; // 0.5-0.7
      this.moodHoldTimer = 0;
      this.moodHoldDuration = 5 + Math.random() * 3; // 5-8 seconds
      this.moodReturning = false;
    } else {
      this.moodExpression = null;
      this.moodTargetIntensity = 0;
      this.moodReturning = false;
    }
  }

  setMouth(shape: string, value: number): void {
    if (!this.has(shape)) return;
    this.vrm.expressionManager?.setValue(shape, value);
  }

  setThinking(thinking: boolean): void {
    this.isThinking = thinking;
  }

  setTalking(talking: boolean): void {
    this.isTalking = talking;
    if (!talking) {
      // Clear all mouth shapes
      for (const shape of MOUTH_SHAPES) {
        if (this.has(shape)) this.setExpr(shape, 0);
      }
    }
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.updateBlink(dt);
    this.updateMoodExpression(dt);
    this.updateThinking(dt);
    this.updateTalking(dt);
    this.updateEyeDrift(dt);
  }

  // ── Blink ───────────────────────────────────────────────────────────────

  private updateBlink(dt: number): void {
    if (!this.has('blink')) return;

    if (this.blinkPhase === 'idle') {
      this.blinkTimer += dt;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.blinkPhase = 'closed';
        this.blinkElapsed = 0;
        this.blinkTimer = 0;
        this.nextBlinkTime = 3 + Math.random() * 3;
        this.isDoubleBlink = Math.random() < 0.1;
        this.doubleBlinkDone = false;
      }
      return;
    }

    this.blinkElapsed += dt;

    if (this.blinkPhase === 'closed') {
      // Close over ~150ms
      const t = Math.min(this.blinkElapsed / 0.15, 1);
      this.setExpr('blink', t);
      if (t >= 1) {
        this.blinkPhase = 'opening';
        this.blinkElapsed = 0;
      }
    } else if (this.blinkPhase === 'opening') {
      // Open over ~100ms
      const t = Math.min(this.blinkElapsed / 0.1, 1);
      this.setExpr('blink', 1 - t);
      if (t >= 1) {
        this.setExpr('blink', 0);
        if (this.isDoubleBlink && !this.doubleBlinkDone) {
          // Brief pause then second blink
          this.blinkPhase = 'pause';
          this.blinkElapsed = 0;
          this.doubleBlinkDone = true;
        } else {
          this.blinkPhase = 'idle';
        }
      }
    } else if (this.blinkPhase === 'pause') {
      // ~80ms pause between double blinks
      if (this.blinkElapsed >= 0.08) {
        this.blinkPhase = 'closed';
        this.blinkElapsed = 0;
      }
    }
  }

  // ── Mood expression ─────────────────────────────────────────────────────

  private updateMoodExpression(dt: number): void {
    if (!this.moodExpression) return;

    if (!this.moodReturning) {
      // Transition to target over 300ms
      this.moodIntensity = lerp(this.moodIntensity, this.moodTargetIntensity, dt / 0.3);
      this.moodHoldTimer += dt;

      if (this.moodHoldTimer >= this.moodHoldDuration) {
        this.moodReturning = true;
      }
    } else {
      // Gradually return to neutral over ~1 second
      this.moodIntensity = lerp(this.moodIntensity, 0, dt / 1.0);
      if (this.moodIntensity < 0.01) {
        this.moodIntensity = 0;
        this.setExpr(this.moodExpression, 0);
        this.moodExpression = null;
        return;
      }
    }

    this.setExpr(this.moodExpression, this.moodIntensity);
  }

  // ── Thinking ────────────────────────────────────────────────────────────

  private updateThinking(dt: number): void {
    const target = this.isThinking ? 0.2 : 0;
    this.thinkingIntensity = lerp(this.thinkingIntensity, target, dt / 0.3);

    if (this.thinkingIntensity < 0.01) {
      this.thinkingIntensity = 0;
      return;
    }

    // Slight brow furrow via angry at low intensity
    if (this.has('angry')) {
      this.setExpr('angry', this.thinkingIntensity);
    }

    // Eyes slightly upward when thinking
    if (this.vrm.lookAt) {
      try {
        if ('yaw' in this.vrm.lookAt && 'pitch' in this.vrm.lookAt) {
          (this.vrm.lookAt as unknown as Record<string, number>)['pitch'] = -3 * this.thinkingIntensity;
        }
      } catch { /* lookAt not supported */ }
    }
  }

  // ── Talking ─────────────────────────────────────────────────────────────

  private updateTalking(dt: number): void {
    if (!this.isTalking) return;

    this.talkTimer += dt;
    if (this.talkTimer >= 0.1) {
      this.talkTimer = 0;

      // Clear previous mouth shape
      const prevShape = MOUTH_SHAPES[this.currentMouthShape];
      if (this.has(prevShape)) this.setExpr(prevShape, 0);

      // Pick new random shape
      this.currentMouthShape = Math.floor(Math.random() * MOUTH_SHAPES.length);
      const shape = MOUTH_SHAPES[this.currentMouthShape];
      const amplitude = 0.3 + Math.random() * 0.3; // 0.3-0.6
      if (this.has(shape)) this.setExpr(shape, amplitude);
    }
  }

  // ── Eye drift ───────────────────────────────────────────────────────────

  private updateEyeDrift(dt: number): void {
    if (!this.vrm.lookAt) return;
    if (this.isThinking) return; // thinking controls eyes

    if (!this.eyeDrifting) {
      this.eyeDriftTimer += dt;
      if (this.eyeDriftTimer >= this.nextEyeDriftTime) {
        this.eyeDrifting = true;
        this.eyeDriftTimer = 0;
        this.eyeDriftHoldTimer = 0;
        this.nextEyeDriftTime = 3 + Math.random() * 2;
        this.eyeTargetYaw = (Math.random() - 0.5) * 10;
        this.eyeTargetPitch = (Math.random() - 0.5) * 5;
      }
    } else {
      // Slow smooth movement toward target
      this.eyeYaw = lerp(this.eyeYaw, this.eyeTargetYaw, dt * 2);
      this.eyePitch = lerp(this.eyePitch, this.eyeTargetPitch, dt * 2);

      this.eyeDriftHoldTimer += dt;
      if (this.eyeDriftHoldTimer >= 1 + Math.random()) {
        // Return to center
        this.eyeTargetYaw = 0;
        this.eyeTargetPitch = 0;

        const dist = Math.abs(this.eyeYaw) + Math.abs(this.eyePitch);
        if (dist < 0.3) {
          this.eyeYaw = 0;
          this.eyePitch = 0;
          this.eyeDrifting = false;
        }
      }
    }

    try {
      if ('yaw' in this.vrm.lookAt && 'pitch' in this.vrm.lookAt) {
        (this.vrm.lookAt as unknown as Record<string, number>)['yaw'] = this.eyeYaw;
        (this.vrm.lookAt as unknown as Record<string, number>)['pitch'] = this.eyePitch;
      }
    } catch { /* lookAt not supported */ }
  }
}
