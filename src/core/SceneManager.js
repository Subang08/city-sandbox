import THREE from '../lib/three.js';

export const LAYER = {
  GROUND: 1,
  STATIC: 2,
  DYNAMIC: 3,
  SKY: 4,
};

const SKY_VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(worldPosition.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uHaze;
varying vec3 vWorldDir;

void main() {
  vec3 dir = normalize(vWorldDir);
  float h = clamp(dir.y, -1.0, 1.0);
  float t = pow(clamp(h * 0.5 + 0.5, 0.0, 1.0), 1.15);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.65, t));
  sky = mix(sky, uGround, smoothstep(0.02, -0.22, h));
  float sun = max(dot(dir, normalize(uSunDir)), 0.0);
  sky += uSunColor * pow(sun, 220.0) * 3.2 * uSunIntensity;
  sky += uSunColor * pow(sun, 8.0) * 0.22 * uSunIntensity;
  float glow = pow(max(1.0 - abs(h), 0.0), 6.0) * uHaze;
  sky = mix(sky, uHorizon * 1.08, glow * 0.55);
  // No #include chunks here on purpose: a custom ShaderMaterial does not go
  // through the standard material injection chain, so a chunk include is a
  // driver-dependent compile risk. Output is already in linear space and the
  // dome is toneMapped:false, so the renderer's output pass handles the rest.
  gl_FragColor = vec4(sky, 1.0);
}
`;

/**
 * SceneManager owns the THREE.Scene graph, fog, procedural sky dome and the
 * environment map used for PBR reflections. One place to look for "the world".
 */
export class SceneManager {
  constructor({ renderer = null } = {}) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc3dd);
    this.scene.fog = new THREE.Fog(0xbcd2e0, 60, 240);
    this.root = new THREE.Group();
    this.root.name = 'world';
    this.scene.add(this.root);
    this.staticRoot = new THREE.Group();
    this.staticRoot.name = 'static';
    this.dynamicRoot = new THREE.Group();
    this.dynamicRoot.name = 'dynamic';
    this.helpersRoot = new THREE.Group();
    this.helpersRoot.name = 'helpers';
    this.helpersRoot.visible = false;
    this.root.add(this.staticRoot, this.dynamicRoot, this.helpersRoot);

    this.envScene = new THREE.Scene();
    this.envCamera = new THREE.PerspectiveCamera(90, 1, 0.1, 1200);
    this.envCamera.position.set(0, 34, 0);
    this.envCamera.up.set(0, 1, 0);
    this.envCamera.lookAt(0, 34, -1);
    this.envTexture = new THREE.CanvasTexture(this._makeEnvCanvas());
    this.envTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.envTexture.colorSpace = THREE.SRGBColorSpace;
    this.environment = this.envTexture;
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.85;
    this._envDirty = true;
    this._lastEnvKey = '';
    this._sunColor = new THREE.Color(0xfff2d6);
    this._zenith = new THREE.Color(0x6ea8d8);
    this._horizon = new THREE.Color(0xcfe3ef);
    this._groundTint = new THREE.Color(0x6f7a70);
    this._envCache = new Map();

    this.sky = this._buildSkyDome();
    // Stay on the default layer: a camera only renders layer 0 unless told
    // otherwise, and a sky dome on a private layer silently never draws.
    this.scene.add(this.sky);
    const envSky = this.sky.clone();
    envSky.position.set(0, 0, 0);
    this.envScene.add(envSky);
  }

  _makeEnvCanvas() {
    // Guarded so the whole world can also be built in a headless (node) context.
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    this._envCanvas = canvas;
    return canvas;
  }

  _paintEnv() {
    const canvas = this._envCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    const sunY = ((1 - this._sunDirY) / 2) * canvas.height;
    grad.addColorStop(0, `#${this._zenith.getHexString()}`);
    grad.addColorStop(0.45, `#${this._horizon.getHexString()}`);
    grad.addColorStop(0.52, `#${this._groundTint.getHexString()}`);
    grad.addColorStop(1, '#2b2b28');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this._sunDirY > -0.05) {
      const glow = ctx.createRadialGradient(
        canvas.width * 0.5, sunY, 1,
        canvas.width * 0.5, sunY, canvas.height * 0.5,
      );
      const c = this._sunColor;
      glow.addColorStop(0, `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},0.95)`);
      glow.addColorStop(0.25, 'rgba(255,240,210,0.28)');
      glow.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (this.envTexture) this.envTexture.needsUpdate = true;
  }

  _buildSkyDome() {
    const geometry = new THREE.SphereGeometry(420, 32, 20);
    this.skyUniforms = {
      uZenith: { value: this._zenith.clone() },
      uHorizon: { value: this._horizon.clone() },
      uGround: { value: this._groundTint.clone() },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.2) },
      uSunColor: { value: this._sunColor.clone() },
      uSunIntensity: { value: 1 },
      uHaze: { value: 0.2 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'skyDome';
    mesh.frustumCulled = false;
    // The dome sits far beyond the fog far plane, so with fog enabled it renders
    // as one flat fog colour and the sky palette never shows. opt out of fog and
    // let the palette itself carry the atmospheric look.
    material.fog = false;
    mesh.renderOrder = -1000;
    return mesh;
  }

  /**
   * Update sky/environment. Called by LightingSystem with interpolated palettes.
   * Environment regeneration is quantized so we do not repaint per frame.
   */
  setAtmosphere({
    zenith,
    horizon,
    ground = null,
    sunDir,
    sunColor,
    sunIntensity = 1,
    haze = 0.2,
    fogColor,
    fogNear,
    fogFar,
    background = null,
    environmentIntensity = 0.85,
  }) {
    if (zenith) this._zenith.set(zenith);
    if (horizon) this._horizon.set(horizon);
    if (ground) this._groundTint.set(ground);
    if (sunColor) this._sunColor.set(sunColor);
    this._sunDirY = sunDir ? sunDir.y : 0.5;

    const u = this.skyUniforms;
    u.uZenith.value.copy(this._zenith);
    u.uHorizon.value.copy(this._horizon);
    u.uGround.value.copy(this._groundTint);
    u.uSunColor.value.copy(this._sunColor);
    u.uSunIntensity.value = sunIntensity;
    u.uHaze.value = haze;
    if (sunDir) u.uSunDir.value.copy(sunDir).normalize();

    if (fogColor) this.scene.fog.color.set(fogColor);
    if (fogNear !== undefined) this.scene.fog.near = fogNear;
    if (fogFar !== undefined) this.scene.fog.far = fogFar;
    if (background) this.scene.background.set(background);
    else this.scene.background = null;
    this.scene.environmentIntensity = environmentIntensity;

    const key = `${this._zenith.getHexString()}|${this._horizon.getHexString()}|${this._groundTint.getHexString()}|${Math.round(this._sunDirY * 8)}|${this._sunColor.getHexString()}`;
    if (this.envDisabled) {
      this.environment = null;
      this.scene.environment = null;
      return;
    }
    if (key !== this._lastEnvKey) {
      this._lastEnvKey = key;
      const cached = this._envCache.get(key);
      if (cached) {
        this.environment = cached;
        this.scene.environment = cached;
      } else {
        this._paintEnv();
        if (this.renderer && this.renderer.capabilities) {
          const pmrem = this._getPMREM();
          if (pmrem) {
            const target = pmrem.fromEquirectangular(this.envTexture);
            this.environment = target.texture;
            this.scene.environment = target.texture;
            this._envCache.set(key, target.texture);
            if (this._envCache.size > 12) {
              const first = this._envCache.keys().next().value;
              const tex = this._envCache.get(first);
              this._envCache.delete(first);
              if (tex && tex.dispose) tex.dispose();
            }
          }
        }
      }
    }
    this.sky.position.copy(this._cameraPos || new THREE.Vector3());
  }

  _getPMREM() {
    if (!this.renderer) return null;
    if (!this._pmrem) {
      this._pmrem = new THREE.PMREMGenerator(this.renderer);
      this._pmrem.compileEquirectangularShader();
    }
    return this._pmrem;
  }

  /** Keep the sky dome centred on the camera so it never clips. */
  syncSky(cameraPosition) {
    this._cameraPos = cameraPosition;
    this.sky.position.copy(cameraPosition);
  }

  add(object, { dynamic = false, helper = false } = {}) {
    if (helper) this.helpersRoot.add(object);
    else if (dynamic) this.dynamicRoot.add(object);
    else this.staticRoot.add(object);
    return object;
  }

  setHelpersVisible(visible) {
    this.helpersRoot.visible = visible;
  }

  setShadowsEnabled(enabled) {
    this.scene.traverse((object) => {
      if (object.isMesh && object.userData.shadowCapable) object.castShadow = enabled;
    });
  }
}
