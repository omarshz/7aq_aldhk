export type AnimationState = 'idle' | 'talking' | 'reacting' | 'moving';

export type Mood = 'happy' | 'surprised' | 'sad' | 'angry' | 'neutral' | 'confused';

export const MOOD_TO_EXPRESSION: Record<Mood, string> = {
  happy: 'happy',
  surprised: 'surprised',
  sad: 'sad',
  angry: 'angry',
  neutral: 'neutral',
  confused: 'surprised',
};

export interface AvatarConfig {
  modelPath: string;
  canvasId: string;
}
