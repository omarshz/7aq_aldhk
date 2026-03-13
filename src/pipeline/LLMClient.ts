import { invoke } from '@tauri-apps/api/core';
import type { LLMConfig } from '../types/llm';
import { DEFAULT_LLM_CONFIG } from '../types/llm';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export class LLMClient {
  private config: LLMConfig = { ...DEFAULT_LLM_CONFIG };

  updateConfig(config: Partial<LLMConfig>): void {
    Object.assign(this.config, config);
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  async captureScreen(): Promise<string> {
    return withTimeout(invoke<string>('capture_screen'), 10000, 'screen capture');
  }

  async queryLLM(screenshotB64: string): Promise<string> {
    return withTimeout(
      invoke<string>('query_llm', {
        endpoint: this.config.endpoint,
        model: this.config.model,
        screenshotB64,
      }),
      35000,
      'LLM query',
    );
  }

  async queryLLMChat(messages: Array<{role: string; content: string}>): Promise<string> {
    return withTimeout(
      invoke<string>('query_llm_chat', {
        endpoint: this.config.endpoint,
        model: this.config.model,
        messages,
      }),
      35000,
      'LLM chat query',
    );
  }

  async checkHealth(): Promise<boolean> {
    try {
      return await withTimeout(
        invoke<boolean>('check_llm_health', { endpoint: this.config.endpoint }),
        5000,
        'health check',
      );
    } catch {
      return false;
    }
  }
}
