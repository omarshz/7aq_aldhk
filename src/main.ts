import { getCurrentWindow } from '@tauri-apps/api/window';
import { AvatarManager } from './avatar/AvatarManager';
import { MovementController } from './avatar/MovementController';
import { ScreenshotPipeline } from './pipeline/ScreenshotPipeline';
import { SettingsPanel } from './ui/SettingsPanel';
import { ChatInput } from './ui/ChatInput';
import { SpeechBubble } from './ui/SpeechBubble';

async function main() {
  const appWindow = getCurrentWindow();

  // Initialize avatar
  const avatarManager = new AvatarManager({
    modelPath: '/models/avatar.vrm',
    canvasId: 'avatar-canvas',
  });

  await avatarManager.init();

  // Initialize movement
  const movementController = new MovementController(avatarManager);

  // Start movement update loop
  let lastTime = performance.now();
  function updateMovement() {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;
    movementController.update(delta);
    requestAnimationFrame(updateMovement);
  }
  requestAnimationFrame(updateMovement);

  // Single shared SpeechBubble -- both the pipeline and chat use the same
  // DOM element, so there must be exactly one SpeechBubble instance.
  const speechBubble = new SpeechBubble('speech-bubble');

  // Initialize pipeline -- pass the shared speechBubble in
  const pipeline = new ScreenshotPipeline(avatarManager, movementController, speechBubble);

  // Initialize settings panel
  const settingsPanel = new SettingsPanel('settings-panel', pipeline);
  settingsPanel.setOnSave((settings) => {
    if (!settings.movementEnabled) {
      movementController.pause();
    } else {
      movementController.resume();
    }
  });

  // Chat input -- uses the same shared speechBubble
  const chatInput = new ChatInput(avatarManager, speechBubble, pipeline.getLLMClient());

  // Click-through logic
  setupClickThrough(appWindow, avatarManager, chatInput);

  // Click avatar to toggle chat (single click) or drag (double click)
  setupAvatarClick(appWindow, avatarManager, chatInput);

  // Listen for tray pause toggle
  let isPaused = false;
  appWindow.listen('toggle-pause', () => {
    isPaused = !isPaused;
    if (isPaused) {
      pipeline.pause();
      movementController.pause();
    } else {
      pipeline.resume();
      movementController.resume();
    }
  });

  // Start the pipeline
  pipeline.start();

  console.log('Dubly initialized!');
}

// ---------------------------------------------------------------------------
// Click-through: transparent areas pass events to the desktop, but UI
// elements and the avatar remain interactive.
//
// Key problems solved here:
//   1. setIgnoreCursorEvents is async. Rapid mousemoves can cause
//      out-of-order resolution, e.g. a stale "ignore=true" landing after a
//      newer "ignore=false". We guard against this with a monotonic sequence
//      counter -- only the latest call is allowed to write.
//   2. When the chat input is focused the user must be able to type and
//      select text. We must never flip to ignore=true while a UI element is
//      under the cursor or while the chat input is focused.
//   3. On macOS/Tauri the webview continues to receive mousemove events
//      even when ignoring cursor events, which lets us un-ignore as soon as
//      the cursor re-enters an interactive area.
// ---------------------------------------------------------------------------
function setupClickThrough(
  appWindow: ReturnType<typeof getCurrentWindow>,
  avatarManager: AvatarManager,
  chatInput: ChatInput
) {
  let currentlyIgnoring = false;
  let seq = 0; // monotonic counter to prevent out-of-order async writes

  async function setIgnore(ignore: boolean) {
    if (ignore === currentlyIgnoring) return;

    const mySeq = ++seq;
    try {
      await appWindow.setIgnoreCursorEvents(ignore);

      // Only commit the state if no newer call has been issued while we
      // were awaiting.
      if (mySeq === seq) {
        currentlyIgnoring = ignore;
      }
    } catch {
      // Ignore errors from rapid cursor events during window transitions
    }
  }

  function isOverUIElement(e: MouseEvent): boolean {
    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    if (!elementUnder) return false;

    const speechBubbleEl = document.getElementById('speech-bubble');
    const settingsPanelEl = document.getElementById('settings-panel');
    const chatInputEl = document.getElementById('chat-input');

    if (speechBubbleEl?.contains(elementUnder)) return true;
    if (settingsPanelEl?.contains(elementUnder)) return true;
    if (chatInputEl?.contains(elementUnder)) return true;

    return false;
  }

  document.addEventListener('mousemove', (e) => {
    // If the chat input is focused, never ignore -- the user is typing.
    if (chatInput.isFocused()) {
      setIgnore(false);
      return;
    }

    // Over a UI element -- keep interactive
    if (isOverUIElement(e)) {
      setIgnore(false);
      return;
    }

    // Over the avatar -- keep interactive
    const hitsAvatar = avatarManager.hitTest(e.clientX, e.clientY);
    setIgnore(!hitsAvatar);
  });
}

// ---------------------------------------------------------------------------
// Avatar click: single-click toggles chat, double-click starts drag.
//
// Problem solved: the original code used the `click` event for both, but a
// double-click fires two `click` events first, causing the chat to toggle
// twice (open then immediately close). We use a short timer to distinguish
// single from double clicks.
//
// We also use `mousedown` to detect the hit on the avatar -- this fires
// before `click` and is not blocked by the async setIgnoreCursorEvents race.
// ---------------------------------------------------------------------------
function setupAvatarClick(
  appWindow: ReturnType<typeof getCurrentWindow>,
  avatarManager: AvatarManager,
  chatInput: ChatInput
) {
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingClickTarget: { x: number; y: number } | null = null;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    const hitsAvatar = avatarManager.hitTest(e.clientX, e.clientY);
    if (!hitsAvatar) return;

    // If we already have a pending single-click, this is the second press
    // of a double-click -- cancel the single-click action and start drag.
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
      pendingClickTarget = null;
      appWindow.startDragging().catch(() => {});
      return;
    }

    // Record this as a potential single click. Wait a short interval to see
    // if a second mousedown arrives (double-click).
    pendingClickTarget = { x: e.clientX, y: e.clientY };
    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (pendingClickTarget) {
        // Confirmed single click -- toggle chat
        chatInput.toggle();
        pendingClickTarget = null;
      }
    }, 250); // 250 ms is the standard OS double-click threshold
  });
}

main().catch(console.error);
