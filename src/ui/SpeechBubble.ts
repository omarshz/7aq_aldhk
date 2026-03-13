export class SpeechBubble {
  private element: HTMLElement;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private resolveHide: (() => void) | null = null;
  private typewriteRafId: number | null = null;
  private resolveTypewrite: (() => void) | null = null;

  constructor(elementId: string) {
    this.element = document.getElementById(elementId)!;
  }

  async show(text: string): Promise<void> {
    // Cancel any in-flight typewriter from a previous show() call.
    this.cancelTypewrite();

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

    // Truncate long responses so the bubble doesn't cover the avatar
    const maxLen = 120;
    const displayText = text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text;

    this.element.textContent = '';
    this.element.classList.remove('hidden', 'bubble-exit', 'thinking');
    // Force reflow to re-trigger the entrance animation
    void this.element.offsetWidth;

    // Typewriter effect with variable speed
    await this.typewrite(displayText);
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
        this.hideTimeout = null;
        this.animateOut().then(() => {
          if (this.resolveHide) {
            this.resolveHide();
            this.resolveHide = null;
          }
        });
      }, 8000);
    });
  }

  hide(): void {
    this.cancelTypewrite();
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.element.classList.remove('thinking');
    this.element.classList.add('hidden');
    this.element.classList.remove('bubble-exit');
    if (this.resolveHide) {
      this.resolveHide();
      this.resolveHide = null;
    }
  }

  showThinking(): void {
    this.cancelTypewrite();
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.resolveHide) {
      this.resolveHide();
      this.resolveHide = null;
    }

    this.element.textContent = '';
    this.element.classList.remove('hidden', 'bubble-exit');
    this.element.classList.add('thinking');

    // Animated bouncing dots
    const dots = document.createElement('span');
    dots.className = 'thinking-dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dots.appendChild(dot);
    }
    this.element.appendChild(dots);

    // Force reflow for entrance animation
    void this.element.offsetWidth;
  }

  private animateOut(): Promise<void> {
    return new Promise((resolve) => {
      this.element.classList.add('bubble-exit');
      const onEnd = () => {
        this.element.removeEventListener('animationend', onEnd);
        this.element.classList.add('hidden');
        this.element.classList.remove('bubble-exit');
        resolve();
      };
      this.element.addEventListener('animationend', onEnd, { once: true });
      // Fallback in case animationend doesn't fire
      setTimeout(() => {
        this.element.classList.add('hidden');
        this.element.classList.remove('bubble-exit');
        resolve();
      }, 350);
    });
  }

  private cancelTypewrite(): void {
    if (this.typewriteRafId !== null) {
      cancelAnimationFrame(this.typewriteRafId);
      this.typewriteRafId = null;
    }
    if (this.resolveTypewrite) {
      this.resolveTypewrite();
      this.resolveTypewrite = null;
    }
  }

  private typewrite(text: string): Promise<void> {
    return new Promise((resolve) => {
      this.resolveTypewrite = resolve;

      // Split text into words (preserving whitespace after each word)
      const words = text.match(/\S+\s*/g) || [];
      let wordIndex = 0;
      let charIndex = 0;
      let currentWordSpan: HTMLSpanElement | null = null;

      // Create a blinking cursor element
      const cursor = document.createElement('span');
      cursor.className = 'typewriter-cursor';
      this.element.appendChild(cursor);

      const getDelay = (char: string): number => {
        if (char === ' ') return 18;
        if ('.!?'.includes(char)) return 90;
        if (',;:'.includes(char)) return 55;
        return 28 + Math.random() * 12; // slight jitter
      };

      let lastTime = 0;
      let waitUntil = 0;

      const step = (timestamp: number) => {
        if (!lastTime) {
          lastTime = timestamp;
          waitUntil = timestamp;
        }

        if (timestamp < waitUntil) {
          this.typewriteRafId = requestAnimationFrame(step);
          return;
        }

        if (wordIndex >= words.length) {
          // Done typing — remove cursor after a brief pause
          setTimeout(() => {
            cursor.remove();
          }, 500);
          this.typewriteRafId = null;
          this.resolveTypewrite = null;
          resolve();
          return;
        }

        const word = words[wordIndex];

        // Start a new word span
        if (charIndex === 0) {
          currentWordSpan = document.createElement('span');
          currentWordSpan.className = 'typed-word';
          this.element.insertBefore(currentWordSpan, cursor);
        }

        if (currentWordSpan && charIndex < word.length) {
          currentWordSpan.textContent += word[charIndex];
          const delay = getDelay(word[charIndex]);
          charIndex++;
          waitUntil = timestamp + delay;

          if (charIndex >= word.length) {
            wordIndex++;
            charIndex = 0;
            currentWordSpan = null;
          }
        }

        this.typewriteRafId = requestAnimationFrame(step);
      };

      this.typewriteRafId = requestAnimationFrame(step);
    });
  }
}
