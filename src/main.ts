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
  const chatInput = new ChatInput(avatarManager, speechBubble, pipeline.getLLMClient(), pipeline);

  // ---------------------------------------------------------------------------
  // Avatar interaction: click = toggle chat, drag = move window.
  //
  // No setIgnoreCursorEvents needed. On macOS with Tauri v2 transparent:true
  // and macOSPrivateApi:true, transparent pixels already pass through clicks
  // natively at the OS level. The canvas has pointer-events:none in CSS and
  // UI elements have pointer-events:auto, so only interactive elements receive
  // mouse events.
  // ---------------------------------------------------------------------------
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

  // LLM connection status indicator
  const statusDot = document.getElementById('llm-status')!;
  const llmClient = pipeline.getLLMClient();

  async function pollHealth() {
    const healthy = await llmClient.checkHealth();
    statusDot.classList.toggle('connected', healthy);
    statusDot.classList.toggle('disconnected', !healthy);
    statusDot.title = healthy ? 'LM Studio: connected' : 'LM Studio: disconnected';
  }
  pollHealth();
  setInterval(pollHealth, 30000);

  console.log('Dubly initialized!');
}

// ---------------------------------------------------------------------------
// Avatar click: click = toggle chat, click-and-drag = move window.
//
// mousedown on document -> hitTest the avatar via raycasting.
// If hit and no drag -> toggle chat.
// If hit and drag (>4px movement) -> start window dragging.
// Clicks on UI elements are ignored (they handle their own events).
// ---------------------------------------------------------------------------
function setupAvatarClick(
  appWindow: ReturnType<typeof getCurrentWindow>,
  avatarManager: AvatarManager,
  chatInput: ChatInput
) {
  const DRAG_THRESHOLD = 4; // pixels of movement before it becomes a drag
  let downPos: { x: number; y: number } | null = null;
  let dragging = false;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.chat-input-container, .settings-panel, .llm-status')) return;

    const hitsAvatar = avatarManager.hitTest(e.clientX, e.clientY);
    if (!hitsAvatar) return;

    downPos = { x: e.clientX, y: e.clientY };
    dragging = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (!downPos || dragging) return;

    const dx = e.clientX - downPos.x;
    const dy = e.clientY - downPos.y;
    if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
      dragging = true;
      appWindow.startDragging().catch(() => {});
    }
  });

  document.addEventListener('mouseup', () => {
    if (downPos && !dragging) {
      // Click without drag -- toggle chat
      chatInput.toggle();
    }
    downPos = null;
    dragging = false;
  });
}

main().catch(console.error);
