import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { ExpressionController } from './ExpressionController';
import type { AnimationState, Mood } from '../types/avatar';

const MOUTH_SHAPES = ['aa', 'ih', 'ou', 'ee', 'oh', 'nn', 'ff', 'ss', 'ch'] as const;

// ─── Easing ──────────────────────────────────────────────────────────────────

function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function easeOutBack(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  const k = 1.70158;
  return 1 + (k + 1) * Math.pow(c - 1, 3) + k * Math.pow(c - 1, 2);
}

// ─── Pose types ──────────────────────────────────────────────────────────────

interface BonePose {
  rx: number; ry: number; rz: number;
  py?: number;
}

const ZERO: BonePose = { rx: 0, ry: 0, rz: 0 };

interface BoneCache {
  hips: THREE.Object3D | null;
  spine: THREE.Object3D | null;
  chest: THREE.Object3D | null;
  upperChest: THREE.Object3D | null;
  neck: THREE.Object3D | null;
  head: THREE.Object3D | null;
  leftShoulder: THREE.Object3D | null;
  rightShoulder: THREE.Object3D | null;
  leftUpperArm: THREE.Object3D | null;
  rightUpperArm: THREE.Object3D | null;
  leftLowerArm: THREE.Object3D | null;
  rightLowerArm: THREE.Object3D | null;
  leftHand: THREE.Object3D | null;
  rightHand: THREE.Object3D | null;
  leftUpperLeg: THREE.Object3D | null;
  rightUpperLeg: THREE.Object3D | null;
  leftLowerLeg: THREE.Object3D | null;
  rightLowerLeg: THREE.Object3D | null;
}

type PoseMap = Partial<Record<keyof BoneCache, BonePose>>;

function cacheBones(vrm: VRM): BoneCache {
  const g = (n: string) => vrm.humanoid?.getNormalizedBoneNode(n as never) ?? null;
  return {
    hips: g('hips'), spine: g('spine'), chest: g('chest'), upperChest: g('upperChest'),
    neck: g('neck'), head: g('head'),
    leftShoulder: g('leftShoulder'), rightShoulder: g('rightShoulder'),
    leftUpperArm: g('leftUpperArm'), rightUpperArm: g('rightUpperArm'),
    leftLowerArm: g('leftLowerArm'), rightLowerArm: g('rightLowerArm'),
    leftHand: g('leftHand'), rightHand: g('rightHand'),
    leftUpperLeg: g('leftUpperLeg'), rightUpperLeg: g('rightUpperLeg'),
    leftLowerLeg: g('leftLowerLeg'), rightLowerLeg: g('rightLowerLeg'),
  };
}

function lerpPose(a: BonePose, b: BonePose, t: number): BonePose {
  const s = 1 - t;
  return {
    rx: a.rx * s + b.rx * t,
    ry: a.ry * s + b.ry * t,
    rz: a.rz * s + b.rz * t,
    py: (a.py !== undefined || b.py !== undefined)
      ? (a.py ?? 0) * s + (b.py ?? 0) * t
      : undefined,
  };
}

function lerpPoseMap(a: PoseMap, b: PoseMap, t: number): PoseMap {
  const result: PoseMap = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof BoneCache>;
  for (const k of keys) result[k] = lerpPose(a[k] ?? ZERO, b[k] ?? ZERO, t);
  return result;
}

function addPoseMap(a: PoseMap, b: PoseMap): PoseMap {
  const result: PoseMap = { ...a };
  for (const [k, bp] of Object.entries(b) as [keyof BoneCache, BonePose][]) {
    const ap = result[k] ?? ZERO;
    result[k] = {
      rx: ap.rx + bp.rx, ry: ap.ry + bp.ry, rz: ap.rz + bp.rz,
      py: (ap.py ?? 0) + (bp.py ?? 0) || undefined,
    };
  }
  return result;
}

// ─── Idle micro-movements ────────────────────────────────────────────────────

type IdleGesture = 'weightShift' | 'headTurn' | 'shoulderSettle';
const IDLE_GESTURES: IdleGesture[] = ['weightShift', 'headTurn', 'shoulderSettle'];

// ─── Controller ──────────────────────────────────────────────────────────────

export class AnimationController {
  private bones: BoneCache;
  private restPositionY: Partial<Record<keyof BoneCache, number>> = {};
  private state: AnimationState = 'idle';
  private prevState: AnimationState = 'idle';
  private stateTime = 0;
  private blendTime = 0;
  private blendDuration = 0.4;
  private globalTime = 0;

  // Breathing
  private breathPhase = Math.random() * Math.PI * 2;

  // Idle micro-gesture system
  private idleHoldTimer = 3 + Math.random() * 5; // hold still for 3-8s
  private idleGesture: IdleGesture | null = null;
  private idleGestureElapsed = 0;
  private idleGestureDuration = 0;
  private idleGestureDirection = 1; // -1 or 1

  // Head look (smooth, infrequent)
  private headTargetY = 0; // yaw
  private headCurrentY = 0;

  // Walking
  private walkPhase = 0;
  private walkSpeed = 120; // px/s, synced from MovementController

  // Talking
  private talkShapeIndex = 0;
  private talkTimer = 0;
  private talkGestureActive = false;
  private talkGestureBlend = 0; // 0-1, blends the single gesture in/out
  private talkNodPhase = 0;

  // Mood
  private currentMood: Mood = 'neutral';
  private moodIntensity = 0;
  private targetMoodIntensity = 0;

  // Excited
  private excitedIntensity = 0;
  private targetExcitedIntensity = 0;

  constructor(
    private vrm: VRM,
    private expressions: ExpressionController,
  ) {
    this.bones = cacheBones(vrm);
    for (const [key, bone] of Object.entries(this.bones) as [keyof BoneCache, THREE.Object3D | null][]) {
      if (bone) this.restPositionY[key] = bone.position.y;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────

  setState(state: AnimationState): void {
    if (this.state === state) return;
    this.prevState = this.state;
    this.state = state;
    this.blendTime = 0;
    this.stateTime = 0;
    if (state !== 'talking') {
      for (const shape of MOUTH_SHAPES) this.expressions.setMouth(shape, 0);
      this.talkGestureActive = false;
      this.talkGestureBlend = 0;
    }
  }

  getState(): AnimationState { return this.state; }

  setMood(mood: Mood): void {
    this.currentMood = mood;
    this.targetMoodIntensity = mood === 'neutral' ? 0 : 1;
  }

  setExcited(excited: boolean): void {
    this.targetExcitedIntensity = excited ? 1 : 0;
  }

  setWalkSpeed(pxPerSecond: number): void {
    this.walkSpeed = pxPerSecond;
  }

  // ─── Main update ───────────────────────────────────────────────────

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.globalTime += dt;
    this.stateTime += dt;
    this.blendTime += dt;
    this.breathPhase += dt * (2 * Math.PI / 4); // 4-second breathing period

    // Mood/excited intensity smooth lerp
    this.moodIntensity += (this.targetMoodIntensity - this.moodIntensity) * Math.min(dt * 3, 1);
    if (this.targetMoodIntensity > 0 && this.moodIntensity > 0.9)
      this.targetMoodIntensity = Math.max(0, this.targetMoodIntensity - dt * 0.15);

    this.excitedIntensity += (this.targetExcitedIntensity - this.excitedIntensity) * Math.min(dt * 5, 1);
    if (this.targetExcitedIntensity > 0 && this.excitedIntensity > 0.9)
      this.targetExcitedIntensity = Math.max(0, this.targetExcitedIntensity - dt * 0.25);

    // Idle micro-gesture timing
    this.updateIdleGesture(dt);

    // Compute & blend state poses
    const currentPose = this.computePose(this.state, dt);
    const blend = easeInOutCubic(Math.min(this.blendTime / this.blendDuration, 1));
    let finalPose: PoseMap;
    if (blend < 1) {
      const prevPose = this.computePose(this.prevState, dt);
      finalPose = lerpPoseMap(prevPose, currentPose, blend);
    } else {
      finalPose = currentPose;
    }

    // Layer mood posture
    if (this.moodIntensity > 0.01)
      finalPose = addPoseMap(finalPose, this.computeMoodPose());

    // Layer excited bounce
    if (this.excitedIntensity > 0.01)
      finalPose = addPoseMap(finalPose, this.computeExcitedPose());

    this.applyPose(finalPose);
  }

  // ─── Idle micro-gesture system ─────────────────────────────────────

  private updateIdleGesture(dt: number): void {
    if (this.state !== 'idle' && this.state !== 'fidgeting') {
      this.idleGesture = null;
      return;
    }

    if (this.idleGesture) {
      this.idleGestureElapsed += dt;
      if (this.idleGestureElapsed >= this.idleGestureDuration) {
        this.idleGesture = null;
        this.idleHoldTimer = 5 + Math.random() * 7; // 5-12s before next gesture
      }
    } else {
      this.idleHoldTimer -= dt;
      if (this.idleHoldTimer <= 0) {
        this.idleGesture = IDLE_GESTURES[Math.floor(Math.random() * IDLE_GESTURES.length)];
        this.idleGestureElapsed = 0;
        this.idleGestureDuration = 0.8 + Math.random() * 0.6;
        this.idleGestureDirection = Math.random() > 0.5 ? 1 : -1;
      }
    }
  }

  private computeIdleGesturePose(): PoseMap {
    if (!this.idleGesture) return {};
    const t = this.idleGestureElapsed / this.idleGestureDuration;
    // Bell: ease in, hold briefly, ease out
    const intensity = t < 0.3 ? easeOutBack(t / 0.3) : t > 0.7 ? easeInOutCubic(1 - (t - 0.7) / 0.3) : 1;
    const d = this.idleGestureDirection;

    switch (this.idleGesture) {
      case 'weightShift':
        return {
          hips: { rx: 0, ry: 0.02 * d * intensity, rz: 0.03 * d * intensity },
          leftUpperLeg: { rx: 0, ry: 0, rz: -0.02 * d * intensity },
          rightUpperLeg: { rx: 0, ry: 0, rz: 0.02 * d * intensity },
          spine: { rx: 0, ry: 0, rz: -0.015 * d * intensity },
        };
      case 'headTurn':
        return {
          head: { rx: 0, ry: 0.3 * d * intensity, rz: 0 }, // ~17 degrees
          neck: { rx: 0, ry: 0.05 * d * intensity, rz: 0 },
        };
      case 'shoulderSettle':
        return {
          leftShoulder: { rx: 0, ry: 0, rz: -0.04 * intensity },
          rightShoulder: { rx: 0, ry: 0, rz: 0.04 * intensity },
          chest: { rx: 0.01 * intensity, ry: 0, rz: 0 },
        };
    }
  }

  // ─── Pose generators ───────────────────────────────────────────────

  private computePose(state: AnimationState, dt: number): PoseMap {
    switch (state) {
      case 'idle':
      case 'fidgeting':
      case 'settling':
        return this.poseIdle();
      case 'talking':
        return this.poseTalking(dt);
      case 'reacting':
        return this.poseReacting();
      case 'moving':
      case 'pacing':
        return this.poseWalking(dt);
      case 'excited':
        return this.poseIdle(); // excited layer handles the energy
      case 'thinking':
        return this.poseThinking();
      case 'dizzy':
        return this.poseDizzy();
      case 'peeking':
        return this.posePeeking();
      default:
        return this.poseIdle();
    }
  }

  // ─── IDLE: mostly still, subtle breathing, occasional micro-gestures ──

  private poseIdle(): PoseMap {
    // Breathing: very subtle spine extension
    const breathAmt = Math.sin(this.breathPhase) * 0.012; // barely perceptible

    // Resting pose: arms at sides, slight elbow bend, natural hang
    // VRM rest is T-pose (arms horizontal), so rz ~1.2 rad brings arms down to sides
    const pose: PoseMap = {
      spine: { rx: breathAmt, ry: 0, rz: 0 },
      chest: { rx: breathAmt * 0.5, ry: 0, rz: 0 },
      // Arms hanging naturally at sides (T-pose → resting)
      leftUpperArm: { rx: 0.1, ry: 0, rz: 1.2 },
      rightUpperArm: { rx: 0.1, ry: 0, rz: -1.2 },
      // Forearms: slight elbow bend inward
      leftLowerArm: { rx: 0, ry: 0, rz: 0.15 },
      rightLowerArm: { rx: 0, ry: 0, rz: -0.15 },
      // Hands slightly curled inward
      leftHand: { rx: 0.15, ry: 0, rz: 0.05 },
      rightHand: { rx: 0.15, ry: 0, rz: -0.05 },
      // Head: stable with smooth look target
      neck: { rx: 0, ry: this.headCurrentY * 0.3, rz: 0 },
      head: { rx: 0, ry: this.headCurrentY * 0.7, rz: 0 },
    };

    // Layer idle micro-gesture on top
    const gesturePose = this.computeIdleGesturePose();
    return Object.keys(gesturePose).length > 0 ? addPoseMap(pose, gesturePose) : pose;
  }

  // ─── TALKING: subtle lean, one hand gesture, occasional nod ────────

  private poseTalking(dt: number): PoseMap {
    const base = this.poseIdle();

    // Mouth animation
    this.talkTimer += dt;
    if (this.talkTimer > 0.08 + Math.random() * 0.1) {
      this.talkTimer = 0;
      for (const shape of MOUTH_SHAPES) this.expressions.setMouth(shape, 0);
      this.talkShapeIndex = (this.talkShapeIndex + 1 + Math.floor(Math.random() * 2)) % MOUTH_SHAPES.length;
      this.expressions.setMouth(MOUTH_SHAPES[this.talkShapeIndex], 0.3 + Math.random() * 0.4);
    }

    // Single hand gesture: right hand raises slightly when talking
    // Activate after 0.5s of talking, deactivate when not talking (handled in setState)
    if (this.stateTime > 0.5 && !this.talkGestureActive) this.talkGestureActive = true;
    const gestureTarget = this.talkGestureActive ? 1 : 0;
    this.talkGestureBlend += (gestureTarget - this.talkGestureBlend) * Math.min(dt * 4, 1);
    const g = this.talkGestureBlend;

    // Occasional head nod
    this.talkNodPhase += dt * 2.5;
    const nod = Math.sin(this.talkNodPhase) * 0.06;

    const talkOverlay: PoseMap = {
      // Subtle forward lean (~3 degrees = 0.052 rad)
      spine: { rx: 0.05, ry: 0, rz: 0 },
      // Right hand gesture: slight raise from resting (additive on top of idle)
      rightUpperArm: {
        rx: -0.15 * g,
        ry: -0.1 * g,
        rz: 0.3 * g, // lift arm slightly from resting position
      },
      rightLowerArm: {
        rx: -0.25 * g,
        ry: 0,
        rz: -0.2 * g,
      },
      rightHand: {
        rx: Math.sin(this.stateTime * 1.8) * 0.08 * g,
        ry: 0,
        rz: 0,
      },
      // Head nod
      head: { rx: nod, ry: 0, rz: 0 },
      neck: { rx: nod * 0.3, ry: 0, rz: 0 },
    };

    return addPoseMap(base, talkOverlay);
  }

  // ─── REACTING: quick snap back, ~0.8s total ────────────────────────

  private poseReacting(): PoseMap {
    const t = Math.min(this.stateTime / 0.8, 1);
    // Fast ease-in, then settle with slight overshoot
    const snap = t < 0.2 ? easeOutBack(t / 0.2) : easeInOutCubic(1 - (t - 0.2) / 0.8);
    // Tiny overshoot on settle
    const settle = t > 0.5 ? Math.sin((t - 0.5) / 0.3 * Math.PI) * 0.15 * (1 - t) : 0;
    const intensity = snap + settle;

    return {
      // Slight backward lean
      spine: { rx: -0.06 * intensity, ry: 0, rz: 0 },
      chest: { rx: -0.03 * intensity, ry: 0, rz: 0 },
      // Head pulls back slightly
      head: { rx: -0.08 * intensity, ry: 0, rz: 0 },
      neck: { rx: -0.04 * intensity, ry: 0, rz: 0 },
      // Shoulders rise briefly (startle)
      leftShoulder: { rx: 0, ry: 0, rz: -0.06 * intensity },
      rightShoulder: { rx: 0, ry: 0, rz: 0.06 * intensity },
      // Arms stay at sides but tense slightly outward
      leftUpperArm: { rx: -0.05 * intensity, ry: 0, rz: 1.1 - 0.1 * intensity },
      rightUpperArm: { rx: -0.05 * intensity, ry: 0, rz: -1.1 + 0.1 * intensity },
      leftLowerArm: { rx: 0, ry: 0, rz: 0.2 },
      rightLowerArm: { rx: 0, ry: 0, rz: -0.2 },
      // Hips: tiny dip
      hips: { rx: 0, ry: 0, rz: 0, py: -0.003 * intensity },
    };
  }

  // ─── WALKING: proper walk cycle ────────────────────────────────────

  private poseWalking(dt: number): PoseMap {
    // Scale step rate to movement speed: ~1 step per 60px traveled
    const stepsPerSecond = Math.max(1, this.walkSpeed / 60);
    this.walkPhase += dt * stepsPerSecond * Math.PI * 2;
    const p = this.walkPhase;
    const sin = Math.sin(p);
    const cos = Math.cos(p);

    // Stride scales with speed: bigger strides when moving faster
    const speedFactor = Math.min(this.walkSpeed / 120, 1.5);
    const strideAngle = 0.2 + 0.15 * speedFactor;
    // Vertical bounce: up on passing (sin peak), down on contact (sin trough)
    const bounce = Math.abs(Math.sin(p)) * 0.008 - 0.004;

    return {
      hips: {
        rx: 0,
        ry: sin * 0.04, // slight hip rotation with stride
        rz: 0,
        py: bounce,
      },
      // Legs: opposite phase to each other
      leftUpperLeg: { rx: sin * strideAngle, ry: 0, rz: 0 },
      rightUpperLeg: { rx: -sin * strideAngle, ry: 0, rz: 0 },
      // Knee bend on the back leg
      leftLowerLeg: { rx: Math.max(0, -sin) * 0.5, ry: 0, rz: 0 },
      rightLowerLeg: { rx: Math.max(0, sin) * 0.5, ry: 0, rz: 0 },
      // Counter-swing arms (opposite to legs, arms at sides from T-pose)
      leftUpperArm: { rx: -sin * 0.25, ry: 0, rz: 1.15 },
      rightUpperArm: { rx: sin * 0.25, ry: 0, rz: -1.15 },
      leftLowerArm: { rx: Math.max(0, sin) * 0.2, ry: 0, rz: 0.15 },
      rightLowerArm: { rx: Math.max(0, -sin) * 0.2, ry: 0, rz: -0.15 },
      // Slight torso counter-rotation
      spine: { rx: 0.02, ry: -sin * 0.03, rz: 0 },
      chest: { rx: 0, ry: -sin * 0.02, rz: 0 },
      // Head stays stable (tiny bob)
      head: { rx: Math.abs(cos) * 0.015, ry: 0, rz: 0 },
      neck: { rx: 0, ry: 0, rz: 0 },
    };
  }

  // ─── THINKING: chin-down, slight head tilt ─────────────────────────

  private poseThinking(): PoseMap {
    const t = easeInOutCubic(Math.min(this.stateTime / 0.4, 1));
    return {
      head: { rx: 0.1 * t, ry: 0.08 * t, rz: 0 },
      neck: { rx: 0.04 * t, ry: 0.03 * t, rz: 0 },
      spine: { rx: 0.02 * t, ry: 0, rz: 0 },
      leftUpperArm: { rx: 0.1, ry: 0, rz: 1.2 },
      rightUpperArm: { rx: 0.1, ry: 0, rz: -1.2 },
      leftLowerArm: { rx: 0, ry: 0, rz: 0.15 },
      rightLowerArm: { rx: 0, ry: 0, rz: -0.15 },
    };
  }

  // ─── DIZZY: gentle sway ────────────────────────────────────────────

  private poseDizzy(): PoseMap {
    const t = this.stateTime;
    const sway = Math.sin(t * 2.5) * 0.06;
    return {
      hips: { rx: 0, ry: 0, rz: sway },
      spine: { rx: 0, ry: 0, rz: -sway * 0.5 },
      head: { rx: 0.03, ry: Math.sin(t * 1.8) * 0.08, rz: sway * 0.3 },
      leftUpperArm: { rx: 0.1, ry: 0, rz: 1.1 + sway * 0.3 },
      rightUpperArm: { rx: 0.1, ry: 0, rz: -1.1 + sway * 0.3 },
      leftLowerArm: { rx: 0, ry: 0, rz: 0.15 },
      rightLowerArm: { rx: 0, ry: 0, rz: -0.15 },
    };
  }

  // ─── PEEKING: lean to one side ─────────────────────────────────────

  private posePeeking(): PoseMap {
    const t = easeOutBack(Math.min(this.stateTime / 0.4, 1));
    return {
      hips: { rx: 0, ry: 0, rz: 0.08 * t },
      spine: { rx: 0, ry: 0.05 * t, rz: 0.06 * t },
      head: { rx: 0, ry: 0.15 * t, rz: -0.04 * t },
      leftUpperArm: { rx: 0.1, ry: 0, rz: 1.2 },
      rightUpperArm: { rx: 0.1, ry: 0, rz: -1.2 },
      leftLowerArm: { rx: 0, ry: 0, rz: 0.15 },
      rightLowerArm: { rx: 0, ry: 0, rz: -0.15 },
    };
  }

  // ─── Mood posture (subtle additive layer) ──────────────────────────

  private computeMoodPose(): PoseMap {
    const m = this.moodIntensity;
    if (m < 0.01) return {};

    switch (this.currentMood) {
      case 'happy':
      case 'playful':
      case 'excited':
        return {
          spine: { rx: -0.02 * m, ry: 0, rz: 0 }, // slight upright lift
          head: { rx: -0.03 * m, ry: 0, rz: 0 },
        };
      case 'sad':
        return {
          spine: { rx: 0.04 * m, ry: 0, rz: 0 }, // slight slump
          head: { rx: 0.06 * m, ry: 0, rz: 0 },
          leftShoulder: { rx: 0, ry: 0, rz: -0.03 * m },
          rightShoulder: { rx: 0, ry: 0, rz: 0.03 * m },
        };
      case 'angry':
        return {
          spine: { rx: 0.03 * m, ry: 0, rz: 0 }, // tense forward lean
          head: { rx: 0.02 * m, ry: 0, rz: 0 },
          leftShoulder: { rx: 0, ry: 0, rz: -0.04 * m },
          rightShoulder: { rx: 0, ry: 0, rz: 0.04 * m },
        };
      case 'surprised':
      case 'confused':
        return {
          spine: { rx: -0.03 * m, ry: 0, rz: 0 },
          head: { rx: -0.04 * m, ry: 0, rz: 0.03 * m },
        };
      case 'curious':
        return {
          head: { rx: 0.04 * m, ry: 0.1 * m, rz: -0.03 * m },
          neck: { rx: 0.02 * m, ry: 0.04 * m, rz: 0 },
        };
      case 'sleepy':
        return {
          spine: { rx: 0.03 * m, ry: 0, rz: 0 },
          head: { rx: 0.08 * m, ry: 0, rz: 0.03 * m },
          neck: { rx: 0.04 * m, ry: 0, rz: 0 },
        };
      default:
        return {};
    }
  }

  // ─── Excited bounce (additive layer) ───────────────────────────────

  private computeExcitedPose(): PoseMap {
    const t = this.excitedIntensity;
    const bounce = Math.abs(Math.sin(this.globalTime * 8)) * t;
    return {
      hips: { rx: 0, ry: 0, rz: 0, py: 0.01 * bounce },
      spine: { rx: -0.03 * bounce, ry: 0, rz: 0 },
      head: { rx: -0.04 * t, ry: 0, rz: 0 },
    };
  }

  // ─── Apply pose to bones ───────────────────────────────────────────

  private applyPose(pose: PoseMap): void {
    for (const [key, p] of Object.entries(pose) as [keyof BoneCache, BonePose][]) {
      const bone = this.bones[key];
      if (!bone) continue;
      bone.rotation.set(p.rx, p.ry, p.rz);
      if (p.py !== undefined) {
        const restY = this.restPositionY[key] ?? bone.position.y;
        bone.position.y = restY + p.py;
      }
    }
  }
}
