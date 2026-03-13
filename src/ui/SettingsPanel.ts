import type { ScreenshotPipeline } from '../pipeline/ScreenshotPipeline';

interface Settings {
  screenshotInterval: number;
  endpoint: string;
  model: string;
  vrmPath: string;
  movementEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  screenshotInterval: 30,
  endpoint: 'http://127.0.0.1:1234',
  model: 'default',
  vrmPath: '',
  movementEnabled: true,
};

export class SettingsPanel {
  private element: HTMLElement;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private onSave: ((settings: Settings) => void) | null = null;

  constructor(elementId: string, pipeline: ScreenshotPipeline) {
    this.element = document.getElementById(elementId)!;
    this.loadSettings();
    this.render(pipeline);
  }

  private render(pipeline: ScreenshotPipeline): void {
    this.element.innerHTML = `
      <h2>Settings</h2>
      <label>Screenshot Interval (seconds)</label>
      <input type="number" id="setting-interval" min="10" max="120"
             value="${this.settings.screenshotInterval}" />
      <label>LM Studio Endpoint</label>
      <input type="text" id="setting-endpoint"
             value="${this.settings.endpoint}" />
      <label>Model Name</label>
      <input type="text" id="setting-model"
             value="${this.settings.model}" placeholder="default" />
      <label>Custom VRM Path</label>
      <input type="text" id="setting-vrm"
             value="${this.settings.vrmPath}" placeholder="Leave empty for default" />
      <label class="checkbox-label">
        <input type="checkbox" id="setting-movement"
               ${this.settings.movementEnabled ? 'checked' : ''} />
        Enable autonomous movement
      </label>
      <div style="margin-top: 16px">
        <button id="settings-save">Save</button>
        <button id="settings-close">Close</button>
      </div>
    `;

    this.element.querySelector('#settings-save')!.addEventListener('click', () => {
      this.settings.screenshotInterval = parseInt(
        (this.element.querySelector('#setting-interval') as HTMLInputElement).value
      );
      this.settings.endpoint = (
        this.element.querySelector('#setting-endpoint') as HTMLInputElement
      ).value;
      this.settings.model = (
        this.element.querySelector('#setting-model') as HTMLInputElement
      ).value;
      this.settings.vrmPath = (
        this.element.querySelector('#setting-vrm') as HTMLInputElement
      ).value;
      this.settings.movementEnabled = (
        this.element.querySelector('#setting-movement') as HTMLInputElement
      ).checked;

      this.saveSettings();

      // Apply settings
      pipeline.setInterval(this.settings.screenshotInterval * 1000);
      pipeline.getLLMClient().updateConfig({
        endpoint: this.settings.endpoint,
        model: this.settings.model,
        screenshotInterval: this.settings.screenshotInterval,
      });

      if (this.onSave) this.onSave(this.settings);
      this.hide();
    });

    this.element.querySelector('#settings-close')!.addEventListener('click', () => {
      this.hide();
    });
  }

  show(): void {
    this.element.classList.remove('hidden');
  }

  hide(): void {
    this.element.classList.add('hidden');
  }

  toggle(): void {
    this.element.classList.toggle('hidden');
  }

  setOnSave(callback: (settings: Settings) => void): void {
    this.onSave = callback;
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  private loadSettings(): void {
    try {
      const stored = localStorage.getItem('dubly-settings');
      if (stored) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // Use defaults
    }
  }

  private saveSettings(): void {
    localStorage.setItem('dubly-settings', JSON.stringify(this.settings));
  }
}
