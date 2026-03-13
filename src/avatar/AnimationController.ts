import type { VRM } from '@pixiv/three-vrm';
import type { ExpressionController } from './ExpressionController';
import type { AnimationState } from '../types/avatar';

const MOUTH_SHAPES = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;

export class AnimationController {
  private state: AnimationState = 'idle';
  private stateTime = 0;
  private breathPhase = 0;
  private talkShapeIndex = 0;
  private talkTimer = 0;
  private headLookTimer = 0;
  private headTargetX = 0;
  private headTargetY = 0;
  private nodTimer = 0;
  private idleSwayPhase = 0;
  private armSwayPhase = 0;

  constructor(
    private vrm: VRM,
    private expressions: ExpressionController
  ) {}

  setState(state: AnimationState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;

    // Clear talking mouth shapes when leaving talking state
    if (state !== 'talking') {
      for (const shape of MOUTH_SHAPES) {
        this.expressions.setMouth(shape, 0);
      }
    }
  }

  getState(): AnimationState {
    return this.state;
  }

  update(delta: number): void {
    this.stateTime += delta;

    switch (this.state) {
      case 'idle':
        this.updateIdle(delta);
        break;
      case 'talking':
        this.updateTalking(delta);
        break;
      case 'reacting':
        this.updateReacting(delta);
        break;
      case 'moving':
        this.updateMoving(delta);
        break;
    }
  }

  private updateIdle(delta: number): void {
    // Breathing — visible chest/spine movement
    this.breathPhase += delta * 1.8;
    const breathAmount = Math.sin(this.breathPhase) * 0.03;
    const spine = this.vrm.humanoid?.getNormalizedBoneNode('spine');
    if (spine) {
      spine.rotation.x = breathAmount;
    }

    // Upper chest follows breathing
    const chest = this.vrm.humanoid?.getNormalizedBoneNode('upperChest');
    if (chest) {
      chest.rotation.x = Math.sin(this.breathPhase) * 0.015;
    }

    // Idle body sway — gentle side-to-side
    this.idleSwayPhase += delta * 0.8;
    if (spine) {
      spine.rotation.z = Math.sin(this.idleSwayPhase) * 0.02;
    }

    // Arm sway — keep arms close to body so they stay in frame.
    // A smaller base Z rotation (0.15 vs 0.3) keeps elbows tighter.
    this.armSwayPhase += delta * 1.2;
    const leftArm = this.vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const rightArm = this.vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
    if (leftArm) {
      leftArm.rotation.z = 0.15 + Math.sin(this.armSwayPhase) * 0.03;
      leftArm.rotation.x = Math.sin(this.armSwayPhase * 0.7) * 0.02;
    }
    if (rightArm) {
      rightArm.rotation.z = -0.15 + Math.sin(this.armSwayPhase + 1) * 0.03;
      rightArm.rotation.x = Math.sin(this.armSwayPhase * 0.7 + 1) * 0.02;
    }

    // Random head look
    this.headLookTimer -= delta;
    if (this.headLookTimer <= 0) {
      this.headTargetX = (Math.random() - 0.5) * 0.4;
      this.headTargetY = (Math.random() - 0.5) * 0.2;
      this.headLookTimer = 2 + Math.random() * 3;
    }

    const head = this.vrm.humanoid?.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.y += (this.headTargetX - head.rotation.y) * delta * 3;
      head.rotation.x += (this.headTargetY - head.rotation.x) * delta * 3;
    }
  }

  private updateTalking(delta: number): void {
    // Continue idle animations
    this.updateIdle(delta);

    // Cycle through mouth shapes for "talking"
    this.talkTimer += delta;
    if (this.talkTimer > 0.08) {
      this.talkTimer = 0;

      // Clear previous shape
      for (const shape of MOUTH_SHAPES) {
        this.expressions.setMouth(shape, 0);
      }

      // Set new shape with varying intensity
      this.talkShapeIndex = (this.talkShapeIndex + 1) % MOUTH_SHAPES.length;
      const intensity = 0.4 + Math.random() * 0.4;
      this.expressions.setMouth(MOUTH_SHAPES[this.talkShapeIndex], intensity);
    }

    // Animated head nodding while talking
    this.nodTimer += delta * 4;
    const head = this.vrm.humanoid?.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.x += Math.sin(this.nodTimer) * 0.04;
      head.rotation.z = Math.sin(this.nodTimer * 0.5) * 0.03;
    }

    // Gesture — arms move while talking, but kept tight to avoid going out of frame.
    const leftArm = this.vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const rightArm = this.vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
    const gesturePhase = this.stateTime * 2.5;
    if (leftArm) {
      leftArm.rotation.z = 0.15 + Math.sin(gesturePhase) * 0.06;
      leftArm.rotation.x = -0.05 + Math.sin(gesturePhase * 1.3) * 0.04;
    }
    if (rightArm) {
      rightArm.rotation.z = -0.15 + Math.sin(gesturePhase + 2) * 0.06;
      rightArm.rotation.x = -0.05 + Math.sin(gesturePhase * 1.3 + 2) * 0.04;
    }
  }

  private updateReacting(delta: number): void {
    // Continue idle animations
    this.updateIdle(delta);

    // Quick body shift reaction
    const spine = this.vrm.humanoid?.getNormalizedBoneNode('spine');
    if (spine) {
      const t = Math.min(this.stateTime / 0.3, 1);
      spine.rotation.z += Math.sin(t * Math.PI) * 0.08;
      spine.rotation.x += Math.sin(t * Math.PI * 2) * 0.04;
    }

    // Surprised arm raise — constrained so arms stay in frame
    const leftArm = this.vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const rightArm = this.vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
    if (this.stateTime < 0.5) {
      const t = this.stateTime / 0.5;
      if (leftArm) leftArm.rotation.x = -t * 0.15;
      if (rightArm) rightArm.rotation.x = -t * 0.15;
    }

    // Auto-transition back to idle after 2 seconds
    if (this.stateTime > 2) {
      this.setState('idle');
    }
  }

  private updateMoving(delta: number): void {
    // Walking bounce
    this.breathPhase += delta * 6;
    const spine = this.vrm.humanoid?.getNormalizedBoneNode('spine');
    const hips = this.vrm.humanoid?.getNormalizedBoneNode('hips');
    if (spine) {
      spine.rotation.z = Math.sin(this.breathPhase) * 0.04;
      spine.rotation.x = 0.05; // lean forward
    }
    if (hips) {
      hips.position.y = Math.abs(Math.sin(this.breathPhase)) * 0.01;
    }

    // Arm swing while walking — reduced to stay in frame
    const leftArm = this.vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const rightArm = this.vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
    if (leftArm) {
      leftArm.rotation.x = Math.sin(this.breathPhase) * 0.08;
    }
    if (rightArm) {
      rightArm.rotation.x = Math.sin(this.breathPhase + Math.PI) * 0.08;
    }

    // Head stays forward while moving
    const head = this.vrm.humanoid?.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.y *= 0.9; // gradually face forward
      head.rotation.x = 0;
    }
  }
}
