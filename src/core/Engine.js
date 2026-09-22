import THREE from '../lib/three.js';
import { clamp, damp } from '../lib/mathx.js';

/**
 * Engine - WebGL renderer, camera, frame loop with a fixed simulation timestep,
 * and adaptive resolution to hold the frame-time target.
 */
export class Engine {
  constructor({ canvas, config, onFrame, onStats = null }) {
    this.canvas = canvas;
    this.config = config;
    this.onFrame = onFrame;
    this.onStats = onStats;
    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.fixedStep = 1 / 60;
    this.maxSubSteps = 5;
    this.maxDelta = 0.1;
    this.fps = 60;
    this.smoothedFrameTime = 16.7;
    this.frame = 0;
    this.statsTimer = 0;
    this.quality = { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), shadows: true, targetFrameMs: 20 };

    const cameraConfig = config.world.camera;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(
      cameraConfig.fov,
      window.innerWidth / window.innerHeight,
      cameraConfig.near,
      cameraConfig.far,
    );
    this.camera.position.set(60, 50, 70);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.clock = new THREE.Clock();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this._tick = (now) => {
      if (!this.running) return;
      requestAnimationFrame(this._tick);
      this.step(now);
    };
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  step(now) {
    const frameTime = Math.min(this.maxDelta * 1000, now - this.lastTime);
    this.lastTime = now;
    const dt = frameTime / 1000;

    this.smoothedFrameTime = damp(this.smoothedFrameTime, frameTime, 2.2, dt);
    this.fps = 1000 / Math.max(1, this.smoothedFrameTime);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxSubSteps) {
      this.onFrame(this.fixedStep, this.accumulator);
      this.accumulator -= this.fixedStep;
      steps++;
    }
    if (steps === this.maxSubSteps) this.accumulator = 0;

    this.renderer.info.reset();
    this.renderer.render(this.onFrame.scene || this.scene, this.camera);
    this.frame++;
    this._adaptQuality(dt);

    // Track GL errors produced by rendering (startup errors are cleared once).
    const gl = this.renderer.getContext();
    const error = gl.getError();
    if (error !== 0) {
      this.lastGlError = error;
      this.glErrorCount = (this.glErrorCount || 0) + 1;
    } else if (this.glErrorCount === undefined) {
      this.glErrorCount = 0;
    }

    if (this.onStats) {
      this.statsTimer += dt;
      if (this.statsTimer > 0.25) {
        this.statsTimer = 0;
        const info = this.renderer.info;
        this.onStats({
          fps: this.fps,
          frameTime: this.smoothedFrameTime,
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          programs: info.programs ? info.programs.length : 0,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          pixelRatio: this.renderer.getPixelRatio(),
        });
      }
    }
  }

  /** Keep desktop 60 / laptop 45 by trading resolution for frame time. */
  _adaptQuality(dt) {
    if (!this.adaptive) return;
    const target = this.quality.targetFrameMs;
    const ratio = this.renderer.getPixelRatio();
    if (this.smoothedFrameTime > target * 1.35 && ratio > 0.7) {
      this._adaptCooldown = (this._adaptCooldown || 0) + dt;
      if (this._adaptCooldown > 1.5) {
        this._adaptCooldown = 0;
        this.renderer.setPixelRatio(clamp(ratio - 0.15, 0.7, 2));
      }
    } else if (this.smoothedFrameTime < target * 0.75) {
      this._adaptCooldown = 0;
    }
  }

  setAdaptive(enabled) {
    this.adaptive = enabled;
  }

  getInfo() {
    return {
      fps: this.fps,
      frameTime: this.smoothedFrameTime,
      pixelRatio: this.renderer.getPixelRatio(),
      webglVersion: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      maxTextures: this.renderer.capabilities.maxTextures,
    };
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
