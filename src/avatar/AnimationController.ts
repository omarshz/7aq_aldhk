import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { ExpressionController } from './ExpressionController';
import type { AnimationState, Mood } from '../types/avatar';

const MOUTH_SHAPES = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Cheap Perlin-ish noise seeded by a phase value. Multiple octaves of sine
 *  at irrational frequency ratios produce an organic, non-repeating wobble. */
function noise(phase: number): number {
  return (
    Math.sin(phase) * 0.5 +
    Math.sin(phase * 1.7 + 1.3) * 0.3 +
    Math.sin(phase * 3.1 + 2.7) * 0.2
  );
}

/** Smooth ease-in-out for transition blending */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// ─── Bone cache ───────────────────────────────────────────────────────────────

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

function cacheBones(vrm: VRM): BoneCache {
  const h = vrm.humanoid;
  // Cast to any to bypass strict VRMHumanBoneName enum — we handle missing bones via null
  const g = (n: string) => h?.getNormalizedBoneNode(n as never) ?? null;
  return {
    hips: g('hips'),
    spine: g('spine'),
    chest: g('chest'),
    upperChest: g('upperChest'),
    neck: g('neck'),
    head: g('head'),
    leftShoulder: g('leftShoulder'),
    rightShoulder: g('rightShoulder'),
    leftUpperArm: g('leftUpperArm'),
    rightUpperArm: g('rightUpperArm'),
    leftLowerArm: g('leftLowerArm'),
    rightLowerArm: g('rightLowerArm'),
    leftHand: g('leftHand'),
    rightHand: g('rightHand'),
    leftUpperLeg: g('leftUpperLeg'),
    rightUpperLeg: g('rightUpperLeg'),
    leftLowerLeg: g('leftLowerLeg'),
    rightLowerLeg: g('rightLowerLeg'),
  };
}

// ─── Per-bone target for blending ─────────────────────────────────────────────

interface BonePose {
  rx: number; ry: number; rz: number;
  py?: number; // optional position.y offset (hips only)
}

const ZERO_POSE: BonePose = { rx: 0, ry: 0, rz: 0 };

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

type PoseMap = Partial<Record<keyof BoneCache, BonePose>>;

function lerpPoseMap(a: PoseMap, b: PoseMap, t: number): PoseMap {
  const result: PoseMap = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof BoneCache>;
  for (const k of keys) {
    result[k] = lerpPose(a[k] ?? ZERO_POSE, b[k] ?? ZERO_POSE, t);
  }
  return result;
}

// ─── Controller ───────────────────────────────────────────────────────────────

export class AnimationController {
  private bones: BoneCache;
  /** Original rest position.y for each bone (captured once on construction). */
  private restPositionY: Partial<Record<keyof BoneCache, number>> = {};
  private state: AnimationState = 'idle';
  private prevState: AnimationState = 'idle';
  private stateTime = 0;
  private blendTime = 0;
  private blendDuration = 0.4; // seconds to crossfade between states
  private globalTime = 0;

  // Phases for organic motion (advance at different speeds)
  private breathPhase = Math.random() * Math.PI * 2;
  private swayPhase = Math.random() * Math.PI * 2;
  private armPhaseL = Math.random() * Math.PI * 2;
  private armPhaseR = Math.random() * Math.PI * 2;
  private fidgetPhase = Math.random() * Math.PI * 2;
  private walkPhase = 0;

  // Head look
  private headTargetX = 0;
  private headTargetY = 0;
  private headCurrentX = 0;
  private headCurrentY = 0;
  private headLookTimer = 0;

  // Talking
  private talkShapeIndex = 0;
  private talkTimer = 0;
  private gestureHand: 'left' | 'right' | 'both' = 'both';
  private gestureTimer = 0;

  // Mood body language
  private currentMood: Mood = 'neutral';
  private moodIntensity = 0;
  private targetMoodIntensity = 0;

  constructor(
    private vrm: VRM,
    private expressions: ExpressionController
  ) {
    this.bones = cacheBones(vrm);

    // Capture the rest position.y of every bone so applyPose can set
    // absolute offsets instead of accumulating drift each frame.
    for (const [key, bone] of Object.entries(this.bones) as [keyof BoneCache, THREE.Object3D | null][]) {
      if (bone) {
        this.restPositionY[key] = bone.position.y;
      }
    }
  }

  setState(state: AnimationState): void {
    if (this.state === state) return;
    this.prevState = this.state;
    this.state = state;
    this.blendTime = 0;
    this.stateTime = 0;

    if (state !== 'talking') {
      for (const shape of MOUTH_SHAPES) {
        this.expressions.setMouth(shape, 0);
      }
    }
  }

  getState(): AnimationState {
    return this.state;
  }

  setMood(mood: Mood): void {
    this.currentMood = mood;
    this.targetMoodIntensity = mood === 'neutral' ? 0 : 1;
  }

  update(delta: number): void {
    // Clamp delta to prevent physics explosions on tab-switch
    const dt = Math.min(delta, 0.1);
    this.globalTime += dt;
    this.stateTime += dt;
    this.blendTime += dt;

    // Advance phases at different irrational speeds for organic motion
    this.breathPhase += dt * 1.9;
    this.swayPhase += dt * 0.73;
    this.armPhaseL += dt * 1.1;
    this.armPhaseR += dt * 1.05;
    this.fidgetPhase += dt * 0.47;

    // Head look targeting
    this.headLookTimer -= dt;
    if (this.headLookTimer <= 0) {
      this.headTargetX = (Math.random() - 0.5) * 0.6;
      this.headTargetY = (Math.random() - 0.5) * 0.3;
      this.headLookTimer = 1.5 + Math.random() * 3;
    }
    this.headCurrentX += (this.headTargetX - this.headCurrentX) * dt * 2.5;
    this.headCurrentY += (this.headTargetY - this.headCurrentY) * dt * 2.5;

    // Mood lerp
    this.moodIntensity += (this.targetMoodIntensity - this.moodIntensity) * Math.min(dt * 4, 1);
    if (this.targetMoodIntensity > 0 && this.moodIntensity > 0.9) {
      this.targetMoodIntensity = Math.max(0, this.targetMoodIntensity - dt * 0.15);
    }

    // Compute poses for current and previous state
    const currentPose = this.computePose(this.state, dt);
    const blendFactor = smoothstep(Math.min(this.blendTime / this.blendDuration, 1));

    let finalPose: PoseMap;
    if (blendFactor < 1) {
      const prevPose = this.computePose(this.prevState, dt);
      finalPose = lerpPoseMap(prevPose, currentPose, blendFactor);
    } else {
      finalPose = currentPose;
    }

    // Layer mood body language on top
    const moodPose = this.computeMoodPose();
    for (const [k, mp] of Object.entries(moodPose) as [keyof BoneCache, BonePose][]) {
      const existing = finalPose[k] ?? ZERO_POSE;
      finalPose[k] = {
        rx: existing.rx + mp.rx,
        ry: existing.ry + mp.ry,
        rz: existing.rz + mp.rz,
        py: (existing.py ?? 0) + (mp.py ?? 0) || undefined,
      };
    }

    // Apply to bones
    this.applyPose(finalPose);
  }

  // ─── Pose generators ─────────────────────────────────────────────────

  private computePose(state: AnimationState, dt: number): PoseMap {
    switch (state) {
      case 'idle': return this.poseIdle();
      case 'talking': return this.poseTalking(dt);
      case 'reacting': return this.poseReacting();
      case 'moving': return this.poseMoving(dt);
      default: return {};
    }
  }

  private poseIdle(): PoseMap {
    const b = this.breathPhase;
    const s = this.swayPhase;
    const f = this.fidgetPhase;

    // Breathing: spine + chest expand/contract
    const breathAmt = noise(b) * 0.05;
    const chestAmt = noise(b + 0.5) * 0.025;

    // Body sway: hips shift, spine tilts
    const swayZ = noise(s) * 0.04;
    const hipSway = noise(s * 0.8) * 0.03;

    // Weight shift: hips tilt, legs respond
    const weightShift = noise(f) * 0.03;

    // Arms: natural hang with gentle secondary motion from body sway
    const armBaseZ = 0.35; // angled out from body
    const armSwayL = noise(this.armPhaseL) * 0.05;
    const armSwayR = noise(this.armPhaseR) * 0.05;
    const forearmBend = 0.15; // slight natural bend at elbow

    return {
      hips: { rx: 0, ry: hipSway, rz: weightShift },
      spine: { rx: breathAmt, ry: 0, rz: swayZ },
      chest: { rx: chestAmt * 0.5, ry: 0, rz: swayZ * 0.3 },
      upperChest: { rx: chestAmt, ry: 0, rz: 0 },
      neck: { rx: this.headCurrentY * 0.3, ry: this.headCurrentX * 0.3, rz: 0 },
      head: { rx: this.headCurrentY * 0.7, ry: this.headCurrentX * 0.7, rz: noise(f * 1.3) * 0.02 },
      leftShoulder: { rx: 0, ry: 0, rz: breathAmt * 0.3 },
      rightShoulder: { rx: 0, ry: 0, rz: -breathAmt * 0.3 },
      leftUpperArm: {
        rx: noise(this.armPhaseL * 0.6) * 0.03,
        ry: 0,
        rz: armBaseZ + armSwayL,
      },
      rightUpperArm: {
        rx: noise(this.armPhaseR * 0.6) * 0.03,
        ry: 0,
        rz: -(armBaseZ + armSwayR),
      },
      leftLowerArm: { rx: 0, ry: 0, rz: forearmBend + noise(this.armPhaseL * 0.4) * 0.03 },
      rightLowerArm: { rx: 0, ry: 0, rz: -(forearmBend + noise(this.armPhaseR * 0.4) * 0.03) },
      leftUpperLeg: { rx: 0, ry: 0, rz: -weightShift * 0.5 },
      rightUpperLeg: { rx: 0, ry: 0, rz: weightShift * 0.5 },
    };
  }

  private poseTalking(dt: number): PoseMap {
    const base = this.poseIdle();

    // Mouth shapes
    this.talkTimer += dt;
    if (this.talkTimer > 0.08 + Math.random() * 0.04) {
      this.talkTimer = 0;
      for (const shape of MOUTH_SHAPES) this.expressions.setMouth(shape, 0);
      this.talkShapeIndex = (this.talkShapeIndex + 1) % MOUTH_SHAPES.length;
      this.expressions.setMouth(MOUTH_SHAPES[this.talkShapeIndex], 0.3 + Math.random() * 0.5);
    }

    // Switch gesture hand periodically
    this.gestureTimer += dt;
    if (this.gestureTimer > 1.5 + Math.random() * 2) {
      this.gestureTimer = 0;
      const choices: Array<'left' | 'right' | 'both'> = ['left', 'right', 'both'];
      this.gestureHand = choices[Math.floor(Math.random() * choices.length)];
    }

    // Head nodding -- more emphatic than idle
    const nodPhase = this.stateTime * 3.5;
    const headNod = Math.sin(nodPhase) * 0.08;
    const headTilt = Math.sin(nodPhase * 0.6) * 0.05;

    // Gesture arms -- raised and moving
    const gp = this.stateTime * 2.2;
    const gestureL = (this.gestureHand === 'left' || this.gestureHand === 'both') ? 1 : 0.3;
    const gestureR = (this.gestureHand === 'right' || this.gestureHand === 'both') ? 1 : 0.3;

    // Body leans into speech
    const leanForward = 0.04 + noise(this.stateTime * 1.5) * 0.03;

    return {
      ...base,
      spine: {
        rx: (base.spine?.rx ?? 0) + leanForward,
        ry: (base.spine?.ry ?? 0) + noise(gp * 0.7) * 0.03,
        rz: (base.spine?.rz ?? 0),
      },
      neck: {
        rx: (base.neck?.rx ?? 0) + headNod * 0.3,
        ry: (base.neck?.ry ?? 0),
        rz: headTilt * 0.3,
      },
      head: {
        rx: (base.head?.rx ?? 0) + headNod * 0.7,
        ry: (base.head?.ry ?? 0),
        rz: headTilt * 0.7,
      },
      leftUpperArm: {
        rx: -0.2 * gestureL + Math.sin(gp) * 0.15 * gestureL,
        ry: noise(gp * 1.1) * 0.08 * gestureL,
        rz: 0.5 * gestureL + Math.sin(gp * 1.3) * 0.1 * gestureL,
      },
      rightUpperArm: {
        rx: -0.2 * gestureR + Math.sin(gp + 1.5) * 0.15 * gestureR,
        ry: noise(gp * 1.1 + 2) * 0.08 * gestureR,
        rz: -(0.5 * gestureR + Math.sin(gp * 1.3 + 1.5) * 0.1 * gestureR),
      },
      leftLowerArm: {
        rx: -0.1 * gestureL + noise(gp * 1.5) * 0.1 * gestureL,
        ry: 0,
        rz: 0.25 * gestureL + noise(gp * 0.9) * 0.08 * gestureL,
      },
      rightLowerArm: {
        rx: -0.1 * gestureR + noise(gp * 1.5 + 1) * 0.1 * gestureR,
        ry: 0,
        rz: -(0.25 * gestureR + noise(gp * 0.9 + 1) * 0.08 * gestureR),
      },
    };
  }

  private poseReacting(): PoseMap {
    const base = this.poseIdle();
    const t = this.stateTime;

    // Quick jump-back reaction in the first 0.5s
    const reactT = smoothstep(Math.min(t / 0.15, 1));
    const fadeT = t > 0.5 ? smoothstep((t - 0.5) / 1.0) : 0;
    const intensity = reactT * (1 - fadeT);

    // Startle: lean back, arms up, shoulders up
    return {
      ...base,
      hips: {
        rx: (base.hips?.rx ?? 0),
        ry: (base.hips?.ry ?? 0),
        rz: (base.hips?.rz ?? 0),
        py: intensity * 0.01, // slight jump
      },
      spine: {
        rx: (base.spine?.rx ?? 0) - 0.1 * intensity,
        ry: (base.spine?.ry ?? 0),
        rz: (base.spine?.rz ?? 0) + Math.sin(t * 12) * 0.04 * intensity,
      },
      upperChest: {
        rx: (base.upperChest?.rx ?? 0) - 0.06 * intensity,
        ry: 0, rz: 0,
      },
      neck: {
        rx: (base.neck?.rx ?? 0) - 0.05 * intensity,
        ry: (base.neck?.ry ?? 0),
        rz: 0,
      },
      head: {
        rx: (base.head?.rx ?? 0) - 0.08 * intensity,
        ry: (base.head?.ry ?? 0),
        rz: Math.sin(t * 8) * 0.03 * intensity,
      },
      leftShoulder: { rx: 0, ry: 0, rz: -0.1 * intensity },
      rightShoulder: { rx: 0, ry: 0, rz: 0.1 * intensity },
      leftUpperArm: {
        rx: -0.35 * intensity,
        ry: 0,
        rz: 0.6 * intensity + (base.leftUpperArm?.rz ?? 0) * (1 - intensity),
      },
      rightUpperArm: {
        rx: -0.35 * intensity,
        ry: 0,
        rz: -(0.6 * intensity) + (base.rightUpperArm?.rz ?? 0) * (1 - intensity),
      },
      leftLowerArm: {
        rx: -0.3 * intensity,
        ry: 0,
        rz: 0.2 * intensity,
      },
      rightLowerArm: {
        rx: -0.3 * intensity,
        ry: 0,
        rz: -0.2 * intensity,
      },
    };
  }

  private poseMoving(dt: number): PoseMap {
    // Proper walk cycle
    this.walkPhase += dt * 5.5; // steps per second
    const w = this.walkPhase;

    const stride = 0.25;      // leg swing amplitude
    const bounce = 0.008;      // vertical bounce
    const armSwing = 0.2;      // counter-arm swing
    const spineRot = 0.05;     // spine rotation during walk
    const leanFwd = 0.06;      // forward lean

    return {
      hips: {
        rx: leanFwd * 0.3,
        ry: Math.sin(w) * spineRot * 0.5,
        rz: Math.sin(w) * 0.03,
        py: Math.abs(Math.sin(w)) * bounce,
      },
      spine: {
        rx: leanFwd,
        ry: -Math.sin(w) * spineRot * 0.3,
        rz: Math.sin(w) * 0.04,
      },
      chest: {
        rx: leanFwd * 0.3,
        ry: -Math.sin(w) * spineRot * 0.2,
        rz: 0,
      },
      upperChest: { rx: 0, ry: 0, rz: 0 },
      neck: { rx: -leanFwd * 0.5, ry: 0, rz: 0 },
      head: {
        rx: -leanFwd * 0.3,
        ry: this.headCurrentX * 0.3,
        rz: Math.sin(w * 2) * 0.015,
      },
      leftUpperArm: {
        rx: Math.sin(w + Math.PI) * armSwing,
        ry: 0,
        rz: 0.15,
      },
      rightUpperArm: {
        rx: Math.sin(w) * armSwing,
        ry: 0,
        rz: -0.15,
      },
      leftLowerArm: {
        rx: -Math.max(0, Math.sin(w + Math.PI)) * 0.3,
        ry: 0,
        rz: 0.1,
      },
      rightLowerArm: {
        rx: -Math.max(0, Math.sin(w)) * 0.3,
        ry: 0,
        rz: -0.1,
      },
      leftUpperLeg: {
        rx: Math.sin(w) * stride,
        ry: 0,
        rz: 0,
      },
      rightUpperLeg: {
        rx: Math.sin(w + Math.PI) * stride,
        ry: 0,
        rz: 0,
      },
      leftLowerLeg: {
        rx: -Math.max(0, -Math.sin(w)) * stride * 1.2,
        ry: 0,
        rz: 0,
      },
      rightLowerLeg: {
        rx: -Math.max(0, -Math.sin(w + Math.PI)) * stride * 1.2,
        ry: 0,
        rz: 0,
      },
    };
  }

  // ─── Mood body language ─────────────────────────────────────────────

  private computeMoodPose(): PoseMap {
    const t = this.moodIntensity;
    if (t < 0.01) return {};

    switch (this.currentMood) {
      case 'happy':
        return {
          spine: { rx: -0.05 * t, ry: 0, rz: 0 },
          hips: { rx: 0, ry: 0, rz: 0, py: 0.005 * t },
          leftUpperArm: { rx: 0, ry: 0, rz: 0.15 * t },
          rightUpperArm: { rx: 0, ry: 0, rz: -0.15 * t },
          head: { rx: -0.05 * t, ry: 0, rz: noise(this.globalTime * 3) * 0.03 * t },
        };
      case 'sad':
        return {
          spine: { rx: 0.1 * t, ry: 0, rz: 0 },
          head: { rx: 0.12 * t, ry: 0, rz: 0 },
          leftUpperArm: { rx: 0, ry: 0, rz: -0.08 * t },
          rightUpperArm: { rx: 0, ry: 0, rz: 0.08 * t },
          neck: { rx: 0.06 * t, ry: 0, rz: 0 },
        };
      case 'surprised':
      case 'confused':
        return {
          spine: { rx: -0.08 * t, ry: 0, rz: 0 },
          head: { rx: -0.06 * t, ry: 0, rz: this.currentMood === 'confused' ? 0.1 * t : 0 },
          leftUpperArm: { rx: -0.2 * t, ry: 0, rz: 0.15 * t },
          rightUpperArm: { rx: -0.2 * t, ry: 0, rz: -0.15 * t },
          leftLowerArm: { rx: -0.15 * t, ry: 0, rz: 0.1 * t },
          rightLowerArm: { rx: -0.15 * t, ry: 0, rz: -0.1 * t },
        };
      case 'angry':
        return {
          spine: { rx: 0.08 * t, ry: 0, rz: 0 },
          head: { rx: -0.06 * t, ry: 0, rz: 0 },
          leftUpperArm: { rx: -0.1 * t, ry: 0, rz: 0.12 * t },
          rightUpperArm: { rx: -0.1 * t, ry: 0, rz: -0.12 * t },
          leftLowerArm: { rx: -0.3 * t, ry: 0, rz: 0.15 * t },
          rightLowerArm: { rx: -0.3 * t, ry: 0, rz: -0.15 * t },
        };
      default:
        return {};
    }
  }

  // ─── Apply pose to skeleton ─────────────────────────────────────────

  private applyPose(pose: PoseMap): void {
    for (const [key, p] of Object.entries(pose) as [keyof BoneCache, BonePose][]) {
      const bone = this.bones[key];
      if (!bone) continue;
      bone.rotation.set(p.rx, p.ry, p.rz);
      // Set position.y as an absolute offset from the rest pose, NOT additive,
      // to prevent infinite upward drift every frame.
      const restY = this.restPositionY[key] ?? 0;
      bone.position.y = restY + (p.py ?? 0);
    }

    // Auto-transition reacting -> idle
    if (this.state === 'reacting' && this.stateTime > 2) {
      this.setState('idle');
    }
  }
}
