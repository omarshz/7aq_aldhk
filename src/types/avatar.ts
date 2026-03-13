export type AnimationState =
  | 'idle'
  | 'talking'
  | 'reacting'
  | 'moving'
  | 'settling'
  | 'dizzy'
  | 'peeking'
  | 'pacing'
  | 'fidgeting'
  | 'excited'
  | 'thinking';

export type Mood =
  | 'happy'
  | 'surprised'
  | 'sad'
  | 'angry'
  | 'neutral'
  | 'confused'
  | 'curious'
  | 'playful'
  | 'sleepy'
  | 'excited';

export const MOOD_TO_EXPRESSION: Record<Mood, string> = {
  happy: 'happy',
  surprised: 'surprised',
  sad: 'sad',
  angry: 'angry',
  neutral: 'neutral',
  confused: 'surprised',
  curious: 'neutral',
  playful: 'happy',
  sleepy: 'relaxed',
  excited: 'happy',
};

export type FidgetType =
  | 'headTilt'
  | 'shoulderShrug'
  | 'stretch'
  | 'lookAround'
  | 'weightShift'
  | 'hop'
  | 'scratch';

export type MovementStyle =
  | 'saunter'
  | 'scurry'
  | 'pace'
  | 'peek'
  | 'settle';

export interface AvatarConfig {
  modelPath: string;
  canvasId: string;
}
