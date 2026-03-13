import { getCurrentWindow, currentMonitor, LogicalPosition } from '@tauri-apps/api/window';
import type { AvatarManager } from './AvatarManager';

export class MovementController {
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;
  private isMoving = false;
  private isSettingPosition = false;
  private moveTimer = 0;
  private nextMoveTime = 15;
  private paused = false;
  private monitorWidth = 1920;
  private monitorHeight = 1080;
  private windowWidth = 250;
  private windowHeight = 360;

  constructor(private avatarManager: AvatarManager) {
    this.initMonitorBounds();
  }

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
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  update(delta: number): void {
    if (this.paused) return;

    this.moveTimer += delta;

    if (!this.isMoving && this.moveTimer >= this.nextMoveTime) {
      this.pickNewTarget();
      this.isMoving = true;
      this.moveTimer = 0;
      this.avatarManager.setMoving(true);
    }

    if (this.isMoving) {
      this.moveTowardTarget(delta);
    }
  }

  private pickNewTarget(): void {
    // Stay in bottom half of screen
    const minY = this.monitorHeight * 0.4;
    const maxY = this.monitorHeight - this.windowHeight;
    const maxX = this.monitorWidth - this.windowWidth;

    this.targetX = Math.random() * maxX;
    this.targetY = minY + Math.random() * (maxY - minY);
    this.nextMoveTime = 15 + Math.random() * 30;

    // Flip avatar based on direction
    const facingLeft = this.targetX < this.currentX;
    this.avatarManager.flipDirection(facingLeft);
  }

  private async moveTowardTarget(delta: number): Promise<void> {
    const speed = 120 * delta; // pixels per second
    const dx = this.targetX - this.currentX;
    const dy = this.targetY - this.currentY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 5) {
      this.isMoving = false;
      this.avatarManager.setMoving(false);
      return;
    }

    if (this.isSettingPosition) return;

    this.currentX += (dx / dist) * speed;
    this.currentY += (dy / dist) * speed;
    this.isSettingPosition = true;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.setPosition(
        new LogicalPosition(Math.round(this.currentX), Math.round(this.currentY))
      );
    } catch {
      // Window move failed, stop
      this.isMoving = false;
      this.avatarManager.setMoving(false);
    } finally {
      this.isSettingPosition = false;
    }
  }
}
