import { invoke } from '@tauri-apps/api/core';
import type { LLMConfig } from '../types/llm';
import { DEFAULT_LLM_CONFIG } from '../types/llm';

export class LLMClient {
  private config: LLMConfig = { ...DEFAULT_LLM_CONFIG };

  updateConfig(config: Partial<LLMConfig>): void {
    Object.assign(this.config, config);
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  async captureScreen(): Promise<string> {
    return invoke<string>('capture_screen');
  }

  async queryLLM(screenshotB64: string): Promise<string> {
    return invoke<string>('query_llm', {
      endpoint: this.config.endpoint,
      model: this.config.model,
      screenshotB64: screenshotB64,
    });
  }
}
