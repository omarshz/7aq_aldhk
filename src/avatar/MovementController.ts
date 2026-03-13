import { getCurrentWindow, currentMonitor, LogicalPosition } from '@tauri-apps/api/window';
import type { AvatarManager } from './AvatarManager';

// ---------------------------------------------------------------------------
// Movement behavior types
// ---------------------------------------------------------------------------

type MovementBehavior = 'wander' | 'edge-sit' | 'peek' | 'pace' | 'curious' | 'roam';

interface Destination {
  x: number;
  y: number;
  speed: number; // pixels per second
  behavior: MovementBehavior;
}

// Easing helpers
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// MovementController
// ---------------------------------------------------------------------------

export class MovementController {
  // Position tracking
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;
  private velocityX = 0;
  private velocityY = 0;

  // Movement state
  private isMoving = false;
  private isSettingPosition = false;
  private paused = false;

  // Timing
  private moveTimer = 0;
  private nextMoveTime = 8;
  private idleTime = 0; // total time spent idle (resets on move)

  // Overshoot / settling
  private isSettling = false;
  private settleTimer = 0;
  private overshootX = 0;
  private overshootY = 0;
  private settleOriginX = 0;
  private settleOriginY = 0;

  // Easing
  private moveProgress = 0; // 0..1 along current path
  private moveStartX = 0;
  private moveStartY = 0;
  private moveDuration = 0; // seconds for current move

  // Mid-move pause
  private midPauseScheduled = false;
  private midPausing = false;
  private midPauseTimer = 0;
  private midPauseDuration = 0;
  private midPauseAt = 0; // progress value to pause at

  // Pacing
  private isPacing = false;
  private paceCount = 0;
  private paceMaxCount = 0;
  private paceOriginX = 0;
  private paceDirection = 1;

  // Peeking
  private isPeeking = false;
  private peekTimer = 0;
  private peekDuration = 0;
  private peekReturnX = 0;
  private peekReturnY = 0;

  // Post-drag dizzy
  private isDizzy = false;
  private dizzyTimer = 0;

  // Personality: preferred zones (weighted)
  private preferredZones: Array<{ x: number; y: number; weight: number }> = [];

  // Cursor tracking
  private lastCursorX = -1;
  private lastCursorY = -1;
  private cursorTrackTimer = 0;

  // Screen bounds
  private monitorWidth = 1920;
  private monitorHeight = 1080;
  private windowWidth = 250;
  private windowHeight = 360;

  // Current behavior
  private currentBehavior: MovementBehavior = 'wander';

  constructor(private avatarManager: AvatarManager) {
    this.initMonitorBounds();
    this.setupCursorTracking();
    this.buildPreferredZones();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  private async initMonitorBounds(): Promise<void> {
    try {
      const monitor = await currentMonitor();
      if (monitor) {
        this.monitorWidth = monitor.size.width / monitor.scaleFactor;
        this.monitorHeight = monitor.size.height / monitor.scaleFactor;
      }
      const appWindow = getCurrentWindow();
      const pos = await appWindow.outerPosition();
      this.currentX = pos.x;
      this.currentY = pos.y;
    } catch {
      // Use defaults
    }
    this.buildPreferredZones();
  }

  private buildPreferredZones(): void {
    const w = this.monitorWidth;
    const h = this.monitorHeight;
    const ww = this.windowWidth;
    const wh = this.windowHeight;

    // Corners and edges are preferred hangout spots
    this.preferredZones = [
      // Bottom corners (taskbar / dock area) -- heavily weighted
      { x: 20, y: h - wh - 10, weight: 3 },
      { x: w - ww - 20, y: h - wh - 10, weight: 3 },
      // Bottom center
      { x: w / 2 - ww / 2, y: h - wh - 10, weight: 2 },
      // Left / right edges, mid-height
      { x: 10, y: h * 0.5, weight: 1.5 },
      { x: w - ww - 10, y: h * 0.5, weight: 1.5 },
      // Center of screen -- occasional visits
      { x: w / 2 - ww / 2, y: h / 2 - wh / 2, weight: 0.5 },
      // Upper corners
      { x: 20, y: 40, weight: 0.8 },
      { x: w - ww - 20, y: 40, weight: 0.8 },
    ];
  }

  private setupCursorTracking(): void {
    // Track cursor globally via document events (these fire even on transparent window)
    document.addEventListener('mousemove', (e) => {
      // Convert from canvas-local to approximate screen coords
      // This gives us relative movement direction at least
      this.lastCursorX = this.currentX + e.clientX;
      this.lastCursorY = this.currentY + e.clientY;
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** Called by main.ts after a drag ends. */
  onDragEnd(): void {
    this.syncPositionFromWindow();
    this.isDizzy = true;
    this.dizzyTimer = 0;
    this.isMoving = false;
    this.isSettling = false;
    this.isPacing = false;
    this.isPeeking = false;
    this.avatarManager.setState('dizzy');
  }

  /** Called when user clicks near the avatar. */
  onClickNear(screenX: number, screenY: number): void {
    // Jump reaction
    this.avatarManager.setReacting();

    // Face toward the click
    const facingLeft = screenX < this.currentX + this.windowWidth / 2;
    this.avatarManager.flipDirection(facingLeft);
  }

  // ---------------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------------

  update(delta: number): void {
    if (this.paused) return;

    const dt = Math.min(delta, 0.1);

    // Post-drag dizzy state
    if (this.isDizzy) {
      this.dizzyTimer += dt;
      if (this.dizzyTimer > 1.5) {
        this.isDizzy = false;
        this.avatarManager.setState('idle');
        this.moveTimer = 0;
        this.nextMoveTime = 2 + Math.random() * 3; // move soon after being dropped
      }
      return;
    }

    // Peeking state
    if (this.isPeeking) {
      this.updatePeeking(dt);
      return;
    }

    // Settling after arriving at destination
    if (this.isSettling) {
      this.updateSettling(dt);
      return;
    }

    // Pacing behavior
    if (this.isPacing) {
      this.updatePacing(dt);
      return;
    }

    // Accumulate idle time
    if (!this.isMoving) {
      this.idleTime += dt;
      this.moveTimer += dt;

      // After being idle a long time, start moving more frequently
      const idleUrgency = Math.min(this.idleTime / 60, 1); // ramp over 60s
      const adjustedNextMove = lerp(this.nextMoveTime, this.nextMoveTime * 0.3, idleUrgency);

      if (this.moveTimer >= adjustedNextMove) {
        this.startNewMovement();
      }
    } else {
      this.updateMovement(dt);
    }

    // Periodically update cursor tracking
    this.cursorTrackTimer += dt;
  }

  // ---------------------------------------------------------------------------
  // Movement initiation
  // ---------------------------------------------------------------------------

  private startNewMovement(): void {
    const dest = this.pickDestination();
    this.targetX = dest.x;
    this.targetY = dest.y;
    this.currentBehavior = dest.behavior;

    // Handle special behaviors
    if (dest.behavior === 'pace') {
      this.startPacing();
      return;
    }
    if (dest.behavior === 'peek') {
      this.startPeeking();
      return;
    }

    this.moveStartX = this.currentX;
    this.moveStartY = this.currentY;

    const dx = this.targetX - this.currentX;
    const dy = this.targetY - this.currentY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    this.moveDuration = dist / dest.speed;
    this.moveProgress = 0;
    this.isMoving = true;
    this.moveTimer = 0;
    this.idleTime = 0;

    // Schedule a mid-move pause (30% chance)
    this.midPauseScheduled = Math.random() < 0.3 && dist > 200;
    this.midPausing = false;
    if (this.midPauseScheduled) {
      this.midPauseAt = 0.3 + Math.random() * 0.3; // pause between 30-60% through
      this.midPauseDuration = 0.5 + Math.random() * 1.5;
    }

    // Flip avatar to face direction
    const facingLeft = this.targetX < this.currentX;
    this.avatarManager.flipDirection(facingLeft);
    this.avatarManager.setWalkSpeed(dest.speed);
    this.avatarManager.setMoving(true);

    // Set next move timing
    this.nextMoveTime = 8 + Math.random() * 20;
  }

  private pickDestination(): Destination {
    const roll = Math.random();

    // Choose behavior based on weighted random + idle time
    let behavior: MovementBehavior;
    const idleFactor = Math.min(this.idleTime / 45, 1);

    if (roll < 0.05) {
      behavior = 'peek';
    } else if (roll < 0.10) {
      behavior = 'pace';
    } else if (roll < 0.15 + idleFactor * 0.2 && this.lastCursorX > 0) {
      behavior = 'curious';
    } else if (idleFactor > 0.5 && roll < 0.4) {
      behavior = 'roam';
    } else if (roll < 0.55) {
      behavior = 'edge-sit';
    } else {
      behavior = 'wander';
    }

    // Pick speed — sometimes saunter, sometimes scurry
    const speedRoll = Math.random();
    let speed: number;
    if (speedRoll < 0.3) {
      speed = 50 + Math.random() * 40; // slow saunter
    } else if (speedRoll < 0.85) {
      speed = 100 + Math.random() * 60; // normal walk
    } else {
      speed = 200 + Math.random() * 100; // quick scurry
    }

    const maxX = this.monitorWidth - this.windowWidth;
    const maxY = this.monitorHeight - this.windowHeight;

    let x: number;
    let y: number;

    switch (behavior) {
      case 'curious': {
        // Move toward last known cursor position with some offset
        const offset = 80 + Math.random() * 120;
        const angle = Math.random() * Math.PI * 2;
        x = clamp(this.lastCursorX + Math.cos(angle) * offset - this.windowWidth / 2, 0, maxX);
        y = clamp(this.lastCursorY + Math.sin(angle) * offset - this.windowHeight / 2, 0, maxY);
        break;
      }

      case 'edge-sit': {
        // Pick a screen edge
        const edge = Math.floor(Math.random() * 4);
        switch (edge) {
          case 0: // bottom
            x = Math.random() * maxX;
            y = maxY;
            break;
          case 1: // left
            x = 0;
            y = this.monitorHeight * 0.3 + Math.random() * (maxY - this.monitorHeight * 0.3);
            break;
          case 2: // right
            x = maxX;
            y = this.monitorHeight * 0.3 + Math.random() * (maxY - this.monitorHeight * 0.3);
            break;
          default: // top
            x = Math.random() * maxX;
            y = 0;
            break;
        }
        break;
      }

      case 'roam': {
        // More active roaming — go somewhere different from current position
        x = Math.random() * maxX;
        y = Math.random() * maxY;
        speed = 140 + Math.random() * 80;
        break;
      }

      case 'peek':
      case 'pace': {
        // These are handled specially, but need a target for the initial move
        x = this.currentX;
        y = this.currentY;
        break;
      }

      case 'wander':
      default: {
        // Weighted random toward preferred zones
        const zone = this.pickWeightedZone();
        // Add some scatter around the chosen zone
        const scatter = 60 + Math.random() * 100;
        const angle = Math.random() * Math.PI * 2;
        x = clamp(zone.x + Math.cos(angle) * scatter, 0, maxX);
        y = clamp(zone.y + Math.sin(angle) * scatter, 0, maxY);
        break;
      }
    }

    return { x, y, speed, behavior };
  }

  private pickWeightedZone(): { x: number; y: number } {
    const totalWeight = this.preferredZones.reduce((s, z) => s + z.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const zone of this.preferredZones) {
      roll -= zone.weight;
      if (roll <= 0) return zone;
    }
    return this.preferredZones[0];
  }

  // ---------------------------------------------------------------------------
  // Movement update with easing
  // ---------------------------------------------------------------------------

  private updateMovement(dt: number): void {
    // Mid-move pause
    if (this.midPausing) {
      this.midPauseTimer += dt;
      if (this.midPauseTimer >= this.midPauseDuration) {
        this.midPausing = false;
        this.avatarManager.setMoving(true);
      }
      return;
    }

    // Check for mid-move pause trigger
    if (this.midPauseScheduled && this.moveProgress >= this.midPauseAt) {
      this.midPauseScheduled = false;
      this.midPausing = true;
      this.midPauseTimer = 0;
      this.avatarManager.setMoving(false);
      // Avatar looks around during pause (idle handles that)
      return;
    }

    // Advance progress
    if (this.moveDuration > 0) {
      this.moveProgress += dt / this.moveDuration;
    } else {
      this.moveProgress = 1;
    }

    if (this.moveProgress >= 1) {
      this.moveProgress = 1;
      this.arriveAtTarget();
      return;
    }

    // Apply ease-in-out curve
    const easedT = easeInOutCubic(this.moveProgress);
    const newX = lerp(this.moveStartX, this.targetX, easedT);
    const newY = lerp(this.moveStartY, this.targetY, easedT);

    this.setWindowPosition(newX, newY);
  }

  // ---------------------------------------------------------------------------
  // Arrival and settling
  // ---------------------------------------------------------------------------

  private arriveAtTarget(): void {
    this.isMoving = false;
    this.avatarManager.setMoving(false);

    // Overshoot + settle animation
    const dx = this.targetX - this.moveStartX;
    const dy = this.targetY - this.moveStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const overshootFactor = clamp(dist / 500, 0.02, 0.12);

    if (dist > 30) {
      this.isSettling = true;
      this.settleTimer = 0;
      this.settleOriginX = this.targetX;
      this.settleOriginY = this.targetY;
      this.overshootX = (dx / dist) * dist * overshootFactor;
      this.overshootY = (dy / dist) * dist * overshootFactor;
      this.avatarManager.setState('settling');
    }
  }

  private updateSettling(dt: number): void {
    this.settleTimer += dt;
    const duration = 0.6;

    if (this.settleTimer >= duration) {
      this.isSettling = false;
      this.avatarManager.setState('idle');
      this.setWindowPosition(this.settleOriginX, this.settleOriginY);
      return;
    }

    // Damped spring: overshoot then settle back
    const t = this.settleTimer / duration;
    const spring = Math.sin(t * Math.PI * 2.5) * Math.exp(-t * 4);
    const x = this.settleOriginX + this.overshootX * spring;
    const y = this.settleOriginY + this.overshootY * spring;

    this.setWindowPosition(x, y);
  }

  // ---------------------------------------------------------------------------
  // Pacing behavior
  // ---------------------------------------------------------------------------

  private startPacing(): void {
    this.isPacing = true;
    this.paceCount = 0;
    this.paceMaxCount = 2 + Math.floor(Math.random() * 4); // 2-5 paces
    this.paceOriginX = this.currentX;
    this.paceDirection = Math.random() < 0.5 ? -1 : 1;
    this.moveTimer = 0;
    this.idleTime = 0;
    this.nextMoveTime = 10 + Math.random() * 15;

    // Start first pace leg
    this.startPaceLeg();
  }

  private startPaceLeg(): void {
    const paceDistance = 60 + Math.random() * 80;
    this.moveStartX = this.currentX;
    this.moveStartY = this.currentY;
    this.targetX = clamp(
      this.paceOriginX + this.paceDirection * paceDistance,
      0,
      this.monitorWidth - this.windowWidth
    );
    this.targetY = this.currentY; // pace horizontally only
    this.moveDuration = Math.abs(this.targetX - this.currentX) / 70; // slow pace
    this.moveProgress = 0;
    this.isMoving = true;

    this.avatarManager.flipDirection(this.paceDirection < 0);
    this.avatarManager.setMoving(true);
  }

  private updatePacing(dt: number): void {
    if (this.isMoving) {
      this.moveProgress += dt / Math.max(this.moveDuration, 0.01);

      if (this.moveProgress >= 1) {
        this.moveProgress = 1;
        this.isMoving = false;
        this.avatarManager.setMoving(false);
        this.paceCount++;

        if (this.paceCount >= this.paceMaxCount) {
          this.isPacing = false;
          this.avatarManager.setState('idle');
          return;
        }

        // Brief pause at turn, then reverse
        this.paceDirection *= -1;
        // Small delay before next leg (handled by a timer)
        this.settleTimer = 0;
        this.isSettling = true; // reuse settle timer for turn pause
        this.avatarManager.setState('settling');
        return;
      }

      const easedT = easeInOutCubic(this.moveProgress);
      const newX = lerp(this.moveStartX, this.targetX, easedT);
      this.setWindowPosition(newX, this.currentY);
    } else if (this.isSettling) {
      // Turn pause
      this.settleTimer += dt;
      if (this.settleTimer > 0.4 + Math.random() * 0.3) {
        this.isSettling = false;
        this.startPaceLeg();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Peeking behavior
  // ---------------------------------------------------------------------------

  private startPeeking(): void {
    this.isPeeking = true;
    this.peekTimer = 0;
    this.peekDuration = 2 + Math.random() * 3;
    this.peekReturnX = this.currentX;
    this.peekReturnY = this.currentY;
    this.moveTimer = 0;
    this.idleTime = 0;
    this.nextMoveTime = 10 + Math.random() * 15;

    // Pick nearest screen edge and move partially off-screen
    const distLeft = this.currentX;
    const distRight = this.monitorWidth - this.currentX - this.windowWidth;
    const distTop = this.currentY;
    const distBottom = this.monitorHeight - this.currentY - this.windowHeight;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    // Move toward the nearest edge, hiding most of the window
    const hideAmount = this.windowWidth * 0.65;

    if (minDist === distLeft) {
      this.targetX = -hideAmount;
      this.targetY = this.currentY;
      this.avatarManager.flipDirection(true);
    } else if (minDist === distRight) {
      this.targetX = this.monitorWidth - this.windowWidth + hideAmount;
      this.targetY = this.currentY;
      this.avatarManager.flipDirection(false);
    } else if (minDist === distTop) {
      this.targetX = this.currentX;
      this.targetY = -this.windowHeight * 0.5;
    } else {
      this.targetX = this.currentX;
      this.targetY = this.monitorHeight - this.windowHeight * 0.35;
    }

    this.moveStartX = this.currentX;
    this.moveStartY = this.currentY;
    const dx = this.targetX - this.currentX;
    const dy = this.targetY - this.currentY;
    this.moveDuration = Math.sqrt(dx * dx + dy * dy) / 150;
    this.moveProgress = 0;
    this.isMoving = true;
    this.avatarManager.setMoving(true);
    this.avatarManager.setState('peeking');
  }

  private updatePeeking(dt: number): void {
    this.peekTimer += dt;

    if (this.isMoving) {
      this.moveProgress += dt / Math.max(this.moveDuration, 0.01);

      if (this.moveProgress >= 1) {
        this.moveProgress = 1;
        this.isMoving = false;
        this.avatarManager.setMoving(false);

        // If we just arrived at peek position, wait, then return
        if (this.peekTimer < this.peekDuration * 0.5) {
          // Arrived at edge — hold peek
        } else {
          // Arrived back — done peeking
          this.isPeeking = false;
          this.avatarManager.setState('idle');
        }
        return;
      }

      const easedT = easeInOutCubic(this.moveProgress);
      const newX = lerp(this.moveStartX, this.targetX, easedT);
      const newY = lerp(this.moveStartY, this.targetY, easedT);
      this.setWindowPosition(newX, newY);
      return;
    }

    // Holding at peek position — after duration, return
    if (this.peekTimer >= this.peekDuration * 0.6 && !this.isMoving) {
      // Start return journey
      this.moveStartX = this.currentX;
      this.moveStartY = this.currentY;
      this.targetX = this.peekReturnX;
      this.targetY = this.peekReturnY;
      const dx = this.targetX - this.currentX;
      const dy = this.targetY - this.currentY;
      this.moveDuration = Math.sqrt(dx * dx + dy * dy) / 120;
      this.moveProgress = 0;
      this.isMoving = true;
      this.avatarManager.setMoving(true);
      this.avatarManager.flipDirection(this.targetX < this.currentX);
    }
  }

  // ---------------------------------------------------------------------------
  // Window position
  // ---------------------------------------------------------------------------

  private async setWindowPosition(x: number, y: number): Promise<void> {
    if (this.isSettingPosition) return;

    this.currentX = x;
    this.currentY = y;
    this.isSettingPosition = true;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.setPosition(
        new LogicalPosition(Math.round(x), Math.round(y))
      );
    } catch {
      // Window move failed
      this.isMoving = false;
      this.avatarManager.setMoving(false);
    } finally {
      this.isSettingPosition = false;
    }
  }

  private async syncPositionFromWindow(): Promise<void> {
    try {
      const appWindow = getCurrentWindow();
      const pos = await appWindow.outerPosition();
      this.currentX = pos.x;
      this.currentY = pos.y;
    } catch {
      // ignore
    }
  }
}
