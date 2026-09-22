import THREE from './lib/three.js';
import { Engine } from './core/Engine.js';
import { World } from './World.js';
import { CameraSystem } from './systems/CameraSystem.js';
import { UISystem } from './ui/UISystem.js';

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`无法加载配置 ${path} (HTTP ${response.status})`);
  return response.json();
}

/**
 * App - boots the diorama: config -> world -> engine -> UI, then runs the loop.
 * URL parameters (used by the automated verification runs):
 *   ?day=9&minute=1110&weather=rain&speed=6&camera=tower&autoplay=1&ui=0&debug=1
 */
class App {
  constructor() {
    this.bootSteps = [];
    this.startTime = performance.now();
  }

  _boot(message) {
    this.bootSteps.push(message);
    const node = document.getElementById('boot-steps');
    if (!node) return;
    const step = document.createElement('div');
    step.className = 'boot-step is-active';
    const previous = node.querySelector('.boot-step.is-active');
    if (previous) previous.className = 'boot-step is-done';
    step.textContent = `> ${message}`;
    node.append(step);
    const bar = document.querySelector('#boot .boot-bar span');
    if (bar) bar.style.width = `${Math.min(96, this.bootSteps.length * 13)}%`;
  }

  async run() {
    this._boot('读取场景配置');
    const [config, weatherPresets, lightingPalettes] = await Promise.all([
      loadJSON('./config/scene.json'),
      loadJSON('./config/weather.json'),
      loadJSON('./config/lighting.json'),
    ]);
    this.config = config;

    const canvas = document.getElementById('viewport');
    this._boot('初始化渲染引擎');
    this.engine = new Engine({
      canvas,
      config,
      onFrame: (dt) => this._tick(dt),
      onStats: (stats) => {
        this.renderStats = stats;
      },
    });
    this._installShaderDiagnostics();

    // Honest GPU reporting: this is what an unexplained black canvas on an
    // unknown machine needs, and it is visible in the Debug panel.
    const gl = this.engine.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuInfo = {
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      webgl2: this.engine.renderer.capabilities.isWebGL2,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxTextures: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxVertexUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
      maxFragmentUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    };
    console.info('[diorama] GPU:', JSON.stringify(this.gpuInfo));

    this._boot('构建沙盘世界');
    this.world = new World({ config, weatherPresets, lightingPalettes, renderer: this.engine.renderer });
    this.engine.onFrame.scene = this.world.scene.scene;

    this._boot('装配镜头系统');
    this.camera = new CameraSystem({
      camera: this.engine.camera,
      renderer: this.engine.renderer,
      bus: this.world.bus,
      config,
      scene: this.world.scene,
    });
    this.world.attachCamera(this.camera);
    this.world.systems.camera = this.camera;

    const weatherOrder = config.weather.presets;
    this._boot('搭建控制界面');
    this.ui = new UISystem({
      bus: this.world.bus,
      systems: {
        time: this.world.time,
        weather: this.world.weather,
        construction: this.world.construction,
        lighting: this.world.lighting,
        audio: this.world.audio,
        camera: this.camera,
        world: this.world,
        app: this,
        weatherOrder,
      },
      weatherOrder,
    });

    // Startup work (PMREM, shadow targets, render targets) can leave a stale GL
    // error behind; drain it so the per-frame monitor only reports real failures.
    while (gl.getError() !== 0) {
      /* drain */
    }

    this._wireEvents();
    this._applyUrlOverrides();
    this.engine.start();
    this.world.setQuality({ pixelRatio: this.engine.quality.pixelRatio, shadows: true, aa: true });

    const boot = document.getElementById('boot');
    if (boot) {
      boot.classList.add('is-done');
      setTimeout(() => boot.remove(), 900);
    }
    window.__CITY__ = this;
    this.world.bus.emit('app:ready', { ms: performance.now() - this.startTime });
    return this;
  }

  /**
   * Surfaces shader compilation failures instead of letting them turn the canvas
   * black silently.
   */
  _installShaderDiagnostics() {
    const failures = [];
    this.shaderFailures = failures;
    const originalError = console.error.bind(console);
    console.error = (...args) => {
      const text = args
        .map((value) => (typeof value === 'string' ? value : value && value.message ? value.message : ''))
        .join(' ');
      if (/shader|program|compil|link/i.test(text)) {
        failures.push(text.slice(0, 2000));
        this._showShaderWarning(text);
      }
      originalError(...args);
    };
  }

  _showShaderWarning(text) {
    if (this._shaderWarningShown) return;
    this._shaderWarningShown = true;
    const box = document.createElement('div');
    box.className = 'shader-warning';
    const title = document.createElement('strong');
    title.textContent = '着色器编译失败（画面可能变黑）';
    const body = document.createElement('pre');
    body.textContent = `${text}\n\nGPU: ${JSON.stringify(this.gpuInfo || {})}`;
    box.append(title, body);
    const root = document.getElementById('ui-root');
    if (root) root.append(box);
    window.__SHADER_FAILURE__ = text;
  }

  /** Single simulation tick: world first, then presentation systems. */
  _tick(dt) {
    this.world.update(dt);
    const stats = this.renderStats || { fps: 60, drawCalls: 0, triangles: 0 };
    this.ui.update(dt, {
      fps: this.engine.fps,
      drawCalls: stats.drawCalls || 0,
      triangles: stats.triangles || 0,
      debugText: this.world.debugEnabled ? this.world.buildDebugText(this.world.getStats(stats)) : '',
    });
  }

  _wireEvents() {
    const bus = this.world.bus;
    bus.on('ui:cinematic', ({ enabled }) => {
      if (enabled) {
        this._preCinematic = this.camera.mode;
        this.engine.setAdaptive(false);
      } else {
        this.camera.setMode(this._preCinematic || 'diorama');
      }
    });
    this.engine.setAdaptive(true);
  }

  _params() {
    return new URLSearchParams(window.location.search);
  }

  _applyUrlOverrides() {
    const params = this._params();
    const time = this.world.time;
    if (params.has('minute')) time.setMinuteOfDay(Number(params.get('minute')));
    if (params.has('day')) this.world.scrubTo(Number(params.get('day')));
    if (params.has('speed')) time.setSpeed(Number(params.get('speed')));
    if (params.has('weather')) this.world.weather.set(params.get('weather'), { instant: true });
    // Preset first, explicit orbit pose second: otherwise a preset silently
    // overrides the requested theta/phi/radius.
    if (params.has('camera')) this.camera.applyPreset(params.get('camera'), { instant: true });
    if (params.get('autoplay') === '1') time.setPaused(false);
    if (params.get('paused') === '1') time.setPaused(true);
    if (params.get('ui') === '0') this.ui.toggleUi(true);
    if (params.get('debug') === '1') this.ui.toggleDebug(true);
    if (params.get('cinematic') === '1') this.ui.toggleCinematic(true);
    if (params.has('fov')) {
      this.engine.camera.fov = Number(params.get('fov'));
      this.engine.camera.updateProjectionMatrix();
    }
    if (params.has('radius') || params.has('theta') || params.has('phi')) {
      this.camera.controls.setPose(
        {
          radius: params.has('radius') ? Number(params.get('radius')) : undefined,
          theta: params.has('theta') ? Number(params.get('theta')) : undefined,
          phi: params.has('phi') ? Number(params.get('phi')) : undefined,
        },
        true,
      );
      this.camera.setMode('diorama');
    }
    if (params.get('adaptive') === '0') this.engine.setAdaptive(false);

    // Diagnostic bypasses, used to isolate driver-specific rendering failures.
    if (params.get('shadows') === '0') {
      this.engine.renderer.shadowMap.enabled = false;
      this.engine.renderer.shadowMap.needsUpdate = true;
    }
    if (params.has('shadowbias')) this.world.lighting.sun.shadow.bias = Number(params.get('shadowbias'));
    if (params.has('normalbias')) this.world.lighting.sun.shadow.normalBias = Number(params.get('normalbias'));
    if (params.get('env') === '0') {
      this.world.scene.envDisabled = true;
      this.world.scene.scene.environment = null;
      this.world.scene.environment = null;
    }
    if (params.get('tonemap') === 'none') {
      this.engine.renderer.toneMapping = THREE.NoToneMapping;
    }
    if (params.get('sky') === '0') {
      const sky = this.world.scene.sky;
      if (sky) sky.material = new THREE.MeshBasicMaterial({ color: 0x88bbee, side: THREE.BackSide, fog: false });
    }
    if (params.get('sky') === 'off') {
      if (this.world.scene.sky) this.world.scene.sky.visible = false;
      this.world.scene.scene.background = new THREE.Color(0x6ea8d8);
    }
    if (params.get('shadowcast') === '0') {
      this.world.scene.scene.traverse((object) => {
        if (object.isMesh) object.castShadow = false;
      });
      this.engine.renderer.shadowMap.needsUpdate = true;
    }
  }

  /** Test hook: step the same fixed timestep the engine uses, headlessly. */
  advance(seconds, step = 1 / 60) {
    const steps = Math.max(1, Math.round(seconds / step));
    for (let i = 0; i < steps; i++) this.world.update(step);
    return this;
  }

  snapshot() {
    const stats = this.renderStats || {};
    return this.world.getStats(stats);
  }
}

export default App;

const boot = async () => {
  // Opening index.html by double-click loads it over file://, where the browser
  // blocks ES modules (origin "null") and no part of the app can run. Say so
  // plainly instead of showing a silent black canvas.
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    const card = document.querySelector('#boot .boot-card');
    if (card) {
      const errorNode = document.createElement('div');
      errorNode.className = 'boot-error';
      errorNode.textContent = [
        '检测到以 file:// 打开本页面，浏览器会以 CORS 策略阻止 ES 模块加载，应用无法启动。',
        '',
        '请改用本地服务器运行，任选一种：',
        '  1) 在 VS Code 中右键 index.html → Open with Live Server',
        '  2) 在 VS Code 右下角点击 Go Live',
        '  3) 命令行执行  npm start  然后访问 http://127.0.0.1:5173/',
        '  4) 双击项目根目录的  start-server.cmd',
      ].join('\n');
      card.append(errorNode);
    }
    console.error('[diorama] file:// is not supported; run a local server (npm start / Live Server).');
    return;
  }

  const app = new App();
  const bootCard = document.getElementById('boot');
  try {
    await app.run();
  } catch (error) {
    console.error(error);
    if (bootCard) {
      bootCard.classList.remove('is-done');
      const errorNode = document.createElement('div');
      errorNode.className = 'boot-error';
      errorNode.textContent = `启动失败: ${error && error.message ? error.message : error}\n${error && error.stack ? error.stack : ''}`;
      const card = bootCard.querySelector('.boot-card');
      if (card) card.append(errorNode);
    }
  }
};

if (typeof window !== 'undefined' && !window.__CITY_SKIP_BOOT__) {
  boot();
}
