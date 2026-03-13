export class SpeechBubble {
  private element: HTMLElement;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private resolveHide: (() => void) | null = null;
  private typewriteInterval: ReturnType<typeof setInterval> | null = null;
  private resolveTypewrite: (() => void) | null = null;

  constructor(elementId: string) {
    this.element = document.getElementById(elementId)!;
  }

  async show(text: string): Promise<void> {
    // Cancel any in-flight typewriter from a previous show() call.
    if (this.typewriteInterval !== null) {
      clearInterval(this.typewriteInterval);
      this.typewriteInterval = null;
      if (this.resolveTypewrite) {
        this.resolveTypewrite();
        this.resolveTypewrite = null;
      }
    }

    // Cancel any pending auto-hide and resolve its promise so the previous
    // caller of waitForHide() is not left hanging forever.
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.resolveHide) {
      this.resolveHide();
      this.resolveHide = null;
    }

    this.element.textContent = '';
    this.element.classList.remove('hidden');

    // Typewriter effect
    await this.typewrite(text, 30);
  }

  waitForHide(): Promise<void> {
    return new Promise((resolve) => {
      // If a previous waitForHide is still pending, resolve it immediately
      // so its caller is unblocked.
      if (this.resolveHide) {
        this.resolveHide();
      }

      this.resolveHide = resolve;

      this.hideTimeout = setTimeout(() => {
        this.element.classList.add('hidden');
        this.hideTimeout = null;
        if (this.resolveHide) {
          this.resolveHide();
          this.resolveHide = null;
        }
      }, 8000);
    });
  }

  hide(): void {
    if (this.typewriteInterval !== null) {
      clearInterval(this.typewriteInterval);
      this.typewriteInterval = null;
      if (this.resolveTypewrite) {
        this.resolveTypewrite();
        this.resolveTypewrite = null;
      }
    }
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.element.classList.add('hidden');
    if (this.resolveHide) {
      this.resolveHide();
      this.resolveHide = null;
    }
  }

  showThinking(): void {
    if (this.typewriteInterval !== null) {
      clearInterval(this.typewriteInterval);
      this.typewriteInterval = null;
      if (this.resolveTypewrite) {
        this.resolveTypewrite();
        this.resolveTypewrite = null;
      }
    }
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.resolveHide) {
      this.resolveHide();
      this.resolveHide = null;
    }

    this.element.textContent = '';
    const dots = document.createElement('span');
    dots.className = 'thinking-dots';
    dots.textContent = '...';
    this.element.appendChild(dots);
    this.element.classList.remove('hidden');
  }

  private typewrite(text: string, delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.resolveTypewrite = resolve;
      let i = 0;
      this.typewriteInterval = setInterval(() => {
        if (i < text.length) {
          this.element.textContent += text[i];
          i++;
        } else {
          clearInterval(this.typewriteInterval!);
          this.typewriteInterval = null;
          this.resolveTypewrite = null;
          resolve();
        }
      }, delayMs);
    });
  }
}
