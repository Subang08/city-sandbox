import THREE from '../lib/three.js';
import { createStreetLightModel, createWorkLampModel } from './lights/LightModels.js';

/**
 * LightEntity - street lamps and construction flood lamps.
 * Geometry + emissive head always exist; only a few carry a real PointLight
 * (kept in a budget), the rest rely on emissive material + LightRig glow.
 */
export class LightEntity {
  constructor(spec, ctx) {
    this.id = spec.id;
    this.type = 'light';
    this.spec = spec;
    this.kits = ctx.kits;
    this.lightRig = ctx.lightRig;
    this.lighting = ctx.lighting;
    this.kind = spec.type === 'work' ? 'work' : 'street';
    this.nightFactor = 0;
    this.on = false;
    this.flicker = Math.random() * 10;

    this.object3d = new THREE.Group();
    this.object3d.name = this.id;
    this.object3d.position.set(spec.position[0], 1.06, spec.position[2] !== undefined ? spec.position[2] : spec.position[1]);
    this.object3d.rotation.y = spec.rotation || 0;

    if (this.kind === 'work') this._buildWorkLamp();
    else this._buildStreetLight();
  }

  _buildStreetLight() {
    const model = createStreetLightModel({ height: this.spec.height || 7.6, arm: this.spec.arm || 1.5 });
    const poleMesh = new THREE.Mesh(model.pole, this.kits.get('metal'));
    poleMesh.castShadow = true;
    poleMesh.receiveShadow = true;
    this.object3d.add(poleMesh);

    const headMaterial = this.kits.registerEmissive(`lampHead:${this.id}`, { color: 0xfdf3d0, emissive: 0xffd79a });
    headMaterial.userData.lampFactor = 2.4;
    this.headMaterial = headMaterial;
    const headMesh = new THREE.Mesh(model.head, headMaterial);
    headMesh.castShadow = false;
    this.object3d.add(headMesh);

    const glowAnchor = new THREE.Object3D();
    glowAnchor.position.set(0, model.height, model.arm);
    this.object3d.add(glowAnchor);
    this.glow = this.lightRig ? this.lightRig.allocate(glowAnchor, { color: '#ffce85', size: 2.4 }) : null;

    if (this.spec.pointLight) {
      const light = new THREE.PointLight(0xffca7a, this.spec.intensity || 26, this.spec.distance || 30, 2);
      light.position.set(0, model.height - 0.3, model.arm);
      light.castShadow = false;
      this.object3d.add(light);
      this.light = light;
      if (this.lighting) this.lighting.registerPointLight(light);
    }
  }

  _buildWorkLamp() {
    const model = createWorkLampModel();
    const bodyMesh = new THREE.Mesh(model.body, this.kits.get('metal'));
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.object3d.add(bodyMesh);

    const headMaterial = this.kits.registerEmissive(`workLamp:${this.id}`, { color: 0xfff6dd, emissive: 0xffe0a8 });
    headMaterial.userData.lampFactor = 3.0;
    this.headMaterial = headMaterial;
    const headMesh = new THREE.Mesh(model.head, headMaterial);
    this.object3d.add(headMesh);

    const glowAnchor = new THREE.Object3D();
    glowAnchor.position.copy(model.aim);
    this.object3d.add(glowAnchor);
    this.glow = this.lightRig ? this.lightRig.allocate(glowAnchor, { color: '#ffe0a8', size: 3.4 }) : null;

    if (this.spec.pointLight) {
      const light = new THREE.PointLight(0xffd79a, this.spec.intensity || 42, this.spec.distance || 26, 2);
      light.position.copy(model.aim);
      light.castShadow = false;
      this.object3d.add(light);
      this.light = light;
      if (this.lighting) this.lighting.registerWorkLamp(light, { head: headMesh });
    }
  }

  update(dt, ctx) {
    this.flicker += dt;
    const nightFactor = ctx && ctx.lighting ? ctx.lighting.nightFactor : this.nightFactor;
    this.nightFactor = nightFactor;
    const target = nightFactor > 0.12 ? 1 : 0;
    this.on = target > 0.5;
    if (this.glow) {
      this.glow.intensity = this.on ? 0.85 + Math.sin(this.flicker * 1.7) * 0.08 : 0;
    }
    if (this.headMaterial) {
      const base = this.kind === 'work' ? 3.0 : 2.4;
      this.headMaterial.emissiveIntensity = this.on ? base * (0.94 + Math.sin(this.flicker * 2.3) * 0.06) : 0.0;
    }
  }

  getDebugInfo() {
    return {
      id: this.id,
      kind: this.kind,
      on: this.on,
      hasPointLight: Boolean(this.light),
      intensity: this.light ? Number(this.light.intensity.toFixed(1)) : 0,
    };
  }

  debugLabel() {
    return `${this.kind === 'work' ? '施工灯' : '路灯'}·${this.on ? 'ON' : 'OFF'}`;
  }
}

/**
 * PropEntity - interactive site props that need per-frame logic (blinking
 * barricade lights, generator boxes emitting smoke, etc).
 */
export class PropEntity {
  constructor(spec, ctx) {
    this.id = spec.id;
    this.type = 'prop';
    this.spec = spec;
    this.kits = ctx.kits;
    this.lightRig = ctx.lightRig;
    this.kind = spec.kind || 'blinker';
    this.time = Math.random() * 10;

    this.object3d = new THREE.Group();
    this.object3d.name = this.id;
    this.object3d.position.set(spec.position[0], 1.06, spec.position[2] !== undefined ? spec.position[2] : spec.position[1]);

    if (this.kind === 'blinker') {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 1.3, 0.1),
        this.kits.get('metal'),
      );
      post.position.y = 0.65;
      post.castShadow = true;
      this.object3d.add(post);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.3, 0.26),
        this.kits.get('plastic'),
      );
      head.position.y = 1.45;
      this.object3d.add(head);
      const anchor = new THREE.Object3D();
      anchor.position.y = 1.45;
      this.object3d.add(anchor);
      this.glow = this.lightRig ? this.lightRig.allocate(anchor, { color: '#ff8a3c', size: 0.8 }) : null;
      if (this.glow) {
        this.glow.pulses = true;
        this.glow.phase = Math.random() * 6;
      }
    }
  }

  update(dt, ctx) {
    this.time += dt;
    void ctx;
    if (this.glow) this.glow.intensity = 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2.2));
  }

  getDebugInfo() {
    return { id: this.id, kind: this.kind };
  }

  debugLabel() {
    return this.kind;
  }
}
