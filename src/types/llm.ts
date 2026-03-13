import type { Mood } from './avatar';

export interface LLMResponse {
  mood: Mood;
  comment: string;
}

export interface LLMConfig {
  endpoint: string;
  model: string;
  maxTokens: number;
  temperature: number;
  screenshotInterval: number;
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  endpoint: 'http://127.0.0.1:1234',
  model: 'default',
  maxTokens: 100,
  temperature: 0.8,
  screenshotInterval: 30,
};
