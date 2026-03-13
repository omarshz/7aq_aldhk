import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import { AnimationController } from './AnimationController';
import { ExpressionController } from './ExpressionController';
import type { AvatarConfig } from '../types/avatar';
import type { Mood } from '../types/avatar';

export class AvatarManager {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private vrm: VRM | null = null;
  private animationController!: AnimationController;
  private expressionController!: ExpressionController;
  private canvas: HTMLCanvasElement;
  private frameId: number = 0;

  constructor(private config: AvatarConfig) {
    this.canvas = document.getElementById(config.canvasId) as HTMLCanvasElement;
  }

  async init(): Promise<void> {
    // Scene
    this.scene = new THREE.Scene();

    // Camera -- FOV and position will be adjusted after the model loads
    this.camera = new THREE.PerspectiveCamera(
      35,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      100
    );

    // Renderer with transparency
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Lighting
    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(1, 2, 3);
    this.scene.add(directional);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // Load VRM
    await this.loadVRM(this.config.modelPath);

    // Handle resize
    window.addEventListener('resize', () => this.onResize());

    // Start render loop
    this.animate();
  }

  private async loadVRM(path: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      loader.load(
        path,
        (gltf) => {
          const vrm = gltf.userData.vrm as VRM;
          if (!vrm) {
            reject(new Error('No VRM data found in GLTF'));
            return;
          }

          // Only remove unnecessary joints (safe), skip vertex removal
          // as it can strip hands/feet on some models
          VRMUtils.removeUnnecessaryJoints(gltf.scene);

          // VRM models face +Z, rotate to face camera (-Z direction)
          vrm.scene.rotation.y = Math.PI;

          this.vrm = vrm;
          this.scene.add(vrm.scene);

          // Force a world-matrix update so bounding box is accurate
          vrm.scene.updateWorldMatrix(true, true);

          // Auto-frame the camera to fit the entire model
          this.frameCameraToModel(vrm);

          this.expressionController = new ExpressionController(vrm);
          this.animationController = new AnimationController(
            vrm,
            this.expressionController
          );

          resolve();
        },
        undefined,
        (error) => reject(error)
      );
    });
  }

  /**
   * Compute the world-space bounding box of the loaded VRM model and
   * position the camera so the full avatar (head to feet, arms included)
   * fits inside the viewport with padding for animation headroom.
   */
  private frameCameraToModel(vrm: VRM): void {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Expand the bounding box by a padding factor so animations that
    // swing arms or shift the body still stay in frame.
    const paddingFactor = 1.15;
    const paddedHeight = size.y * paddingFactor;
    const paddedWidth = size.x * paddingFactor;

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);

    // Distance needed so the padded height fits in the vertical FOV
    const distForHeight = (paddedHeight / 2) / Math.tan(fovRad / 2);

    // Distance needed so the padded width fits in the horizontal FOV
    const hFov = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
    const distForWidth = (paddedWidth / 2) / Math.tan(hFov / 2);

    // Use the larger distance so both dimensions fit
    const distance = Math.max(distForHeight, distForWidth);

    this.camera.position.set(center.x, center.y, center.z + distance);
    this.camera.lookAt(center.x, center.y, center.z);

    // Store the center for lookAt consistency during resize
    this.camera.userData.lookAtTarget = { x: center.x, y: center.y, z: center.z };
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();

    if (this.vrm) {
      this.animationController?.update(delta);
      this.expressionController?.update(delta);
      this.vrm.update(delta);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    // Re-frame when the window is resized so the model still fits
    if (this.vrm) {
      this.frameCameraToModel(this.vrm);
    }
  }

  setMood(mood: Mood): void {
    this.expressionController?.setMood(mood);
    this.animationController?.setMood(mood);
  }

  setTalking(talking: boolean): void {
    if (talking) {
      this.animationController?.setState('talking');
    } else {
      this.animationController?.setState('idle');
    }
  }

  setReacting(): void {
    this.animationController?.setState('reacting');
  }

  setMoving(moving: boolean): void {
    if (moving) {
      this.animationController?.setState('moving');
    } else {
      this.animationController?.setState('idle');
    }
  }

  flipDirection(facingLeft: boolean): void {
    if (this.vrm) {
      this.vrm.scene.rotation.y = facingLeft ? Math.PI - 0.3 : Math.PI + 0.3;
    }
  }

  // Check if a screen point hits the avatar mesh
  hitTest(x: number, y: number): boolean {
    if (!this.vrm) return false;

    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObject(this.vrm.scene, true);
    return intersects.length > 0;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.renderer.dispose();
  }
}
