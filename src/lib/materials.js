import THREE from './three.js';
import { mergeGeometries } from './merge.js';

/**
 * MaterialKit - a small library of shared, vertex-colored PBR materials.
 * Every kit material enables vertexColors so a whole "batch" of different
 * colored objects renders in ONE draw call. Kits own their materials and
 * expose a global night/day response for emissive materials.
 */
export class MaterialKit {
  constructor({ textures = null } = {}) {
    this.materials = new Map();
    this.emissiveMaterials = new Set();
    this.textures = textures;
    this._nightFactor = 0;
    this._register();
    if (this.textures) this._applyTextures();
  }

  /**
   * Procedural texture pass. Kept separate from material creation so the kit still
   * works headlessly (TextureKit returns null without a DOM).
   */
  _applyTextures() {
    const t = this.textures;
    const apply = (key, { map = null, roughnessMap = null, emissiveMap = null, normalScale = null } = {}) => {
      const material = this.materials.get(key);
      if (!material) return;
      if (map) material.map = map;
      if (roughnessMap) material.roughnessMap = roughnessMap;
      if (emissiveMap) {
        material.emissiveMap = emissiveMap;
        material.emissiveIntensity = Math.max(material.emissiveIntensity, 1);
      }
      if (normalScale) material.normalScale = normalScale;
      material.needsUpdate = true;
    };

    apply('concrete', {
      map: t.concrete([1, 1], { seams: 4, stains: 0.4 }),
      roughnessMap: t.roughness([1, 1], 0.86, 0.14),
    });
    apply('concreteRaw', {
      map: t.concrete([1, 1], { seams: 2, stains: 0.6, base: [206, 201, 191] }),
      roughnessMap: t.roughness([1, 1], 0.94, 0.1),
    });
    apply('asphalt', {
      map: t.asphalt([1, 1]),
      roughnessMap: t.roughness([1, 1], 0.8, 0.2),
    });
    apply('dirt', {
      map: t.dirt([1, 1]),
      roughnessMap: t.roughness([1, 1], 0.97, 0.06),
    });
    apply('site', {
      // The working platform reads as a light concrete apron, not bare soil: bare
      // dirt at this scale just muddies the whole diorama.
      map: t.concrete([1, 1], { seams: 1, stains: 0.22, base: [236, 231, 222] }),
      roughnessMap: t.roughness([1, 1], 0.94, 0.08),
    });
    apply('sand', { map: t.aggregate([1, 1], true) });
    apply('brick', { map: t.aggregate([1, 1], false) });
    apply('metal', { roughnessMap: t.roughness([1, 1], 0.45, 0.25) });
    apply('metalDark', { roughnessMap: t.roughness([1, 1], 0.55, 0.2) });
    // Glass keeps a mullion rhythm; the lit-window look stays driven by per-instance
    // emissive colours so it can still vary floor by floor.
    apply('glass', { map: t.glass([1, 1]), roughnessMap: t.roughness([1, 1], 0.08, 0.06) });
    apply('plastic', { map: t.fencePanel([1, 1]) });
  }

  _make(key, params) {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.0,
      ...params,
    });
    material.name = key;
    this.materials.set(key, material);
    if (params && params.emissive) this.emissiveMaterials.add(material);
    return material;
  }

  _register() {
    // Structural / site
    this._make('site', { roughness: 0.95, metalness: 0.0 });
    this._make('concrete', { roughness: 0.9, metalness: 0.02 });
    this._make('concreteRaw', { roughness: 1.0, metalness: 0.0 });
    this._make('asphalt', { roughness: 0.78, metalness: 0.05 });
    this._make('dirt', { roughness: 1.0, metalness: 0.0 });
    this._make('sand', { roughness: 1.0 });
    this._make('metal', { roughness: 0.42, metalness: 0.72 });
    this._make('metalDark', { roughness: 0.5, metalness: 0.6 });
    this._make('rubber', { roughness: 0.95, metalness: 0.0 });
    this._make('plastic', { roughness: 0.55, metalness: 0.0 });
    this._make('paint', { roughness: 0.4, metalness: 0.1 });
    this._make('wood', { roughness: 0.92, metalness: 0.0 });
    this._make('brick', { roughness: 0.95 });
    this._make('foliage', { roughness: 1.0, metalness: 0.0 });
    this._make('skin', { roughness: 0.75 });
    this._make('fabric', { roughness: 1.0 });
    this._make('glassFrame', { roughness: 0.45, metalness: 0.5 });
    this._make('emissive', {
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.0,
      roughness: 0.5,
      metalness: 0.0,
    });
    this._make('lightGlass', {
      color: 0xfdf6dd,
      emissive: 0xfff2c4,
      emissiveIntensity: 0.15,
      roughness: 0.3,
    });

    // Transparent
    this._make('glass', {
      color: 0xbfe0ea,
      roughness: 0.08,
      metalness: 0.25,
      transparent: true,
      opacity: 0.42,
      envMapIntensity: 0.8,
      side: THREE.DoubleSide,
    });
    this._make('net', {
      color: 0x3f8f52,
      roughness: 0.9,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this._make('tarp', {
      color: 0x2a4d8f,
      roughness: 0.85,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });
    this._make('water', {
      color: 0x2c3a44,
      roughness: 0.06,
      metalness: 0.35,
      transparent: true,
      opacity: 0.85,
      envMapIntensity: 1.4,
    });
    this._make('snow', {
      color: 0xffffff,
      roughness: 0.72,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
  }

  get(key) {
    const m = this.materials.get(key);
    if (!m) throw new Error(`MaterialKit: unknown material "${key}"`);
    return m;
  }

  has(key) {
    return this.materials.has(key);
  }

  register(key, params) {
    return this._make(key, params);
  }

  /** Register an emissive-capable material used for lit windows / lamps. */
  registerEmissive(key, params) {
    return this._make(key, {
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.0,
      ...params,
    });
  }

  /**
   * Clones the surfaces of a kit material onto a new material and re-scales the
   * textures. The building instances plain unit boxes, so its UVs are 0..1 per
   * face and need a different tiling than the merged static world.
   */
  cloneSurfaced(key, { repeat = 1, overrides = {} } = {}) {
    const source = this.get(key);
    const material = new THREE.MeshStandardMaterial({
      color: source.color.clone(),
      roughness: source.roughness,
      metalness: source.metalness,
      vertexColors: false,
      side: source.side,
      transparent: source.transparent,
      opacity: source.opacity,
      depthWrite: source.depthWrite,
      ...overrides,
    });
    if (source.emissive) {
      material.emissive.copy(source.emissive);
      material.emissiveIntensity = source.emissiveIntensity;
    }
    for (const slot of ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap']) {
      const texture = source[slot];
      if (!texture) continue;
      const clone = texture.clone();
      clone.needsUpdate = true;
      clone.wrapS = THREE.RepeatWrapping;
      clone.wrapT = THREE.RepeatWrapping;
      clone.repeat.set(texture.repeat.x * repeat, texture.repeat.y * repeat);
      material[slot] = clone;
    }
    return material;
  }

  get nightFactor() {
    return this._nightFactor;
  }

  /**
   * Drives every emissive material from the sun elevation.
   * `factor` 0 = full day (lights off), 1 = deep night (lights on).
   */
  setNightFactor(factor, lampsOn = true) {
    this._nightFactor = factor;
    const lamp = lampsOn ? factor : 0;
    for (const material of this.emissiveMaterials) {
      const matLamp = material.userData.lampFactor === undefined ? 1 : material.userData.lampFactor;
      material.emissiveIntensity = lamp * matLamp;
    }
    const lightGlass = this.materials.get('lightGlass');
    if (lightGlass) lightGlass.emissiveIntensity = 0.15 + lamp * 1.5;
  }

  setWetness(value) {
    const ground = ['site', 'asphalt', 'concrete', 'dirt', 'sand'];
    for (const key of ground) {
      const m = this.materials.get(key);
      if (!m) continue;
      m.userData.dryRoughness = m.userData.dryRoughness === undefined ? m.roughness : m.userData.dryRoughness;
      m.roughness = m.userData.dryRoughness * (1 - 0.55 * value);
      m.metalness = 0.03 + 0.35 * value;
      m.envMapIntensity = 0.35 + 0.9 * value;
    }
  }

  dispose() {
    for (const m of this.materials.values()) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
        if (m[key] && m[key].dispose) m[key].dispose();
      }
      m.dispose();
    }
  }
}

/**
 * InstanceBatch - accumulates identical-primitive instances that share one
 * material, then emits a single InstancedMesh. Per-instance color is baked as
 * an instanceColor attribute so a whole prop family is one draw call.
 */
export class InstanceBatch {
  constructor(geometry, material, { castShadow = true, receiveShadow = true, name = 'batch' } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.name = name;
    this.items = [];
  }

  add({ position, rotation = [0, 0, 0], scale = [1, 1, 1], color = '#ffffff' }) {
    this.items.push({ position, rotation, scale, color });
    return this.items.length - 1;
  }

  get count() {
    return this.items.length;
  }

  build() {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, this.items.length));
    mesh.name = this.name;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.count = this.items.length;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const color = new THREE.Color();
    this.items.forEach((item, index) => {
      euler.set(item.rotation[0], item.rotation[1], item.rotation[2]);
      quat.setFromEuler(euler);
      pos.set(item.position[0], item.position[1], item.position[2]);
      scl.set(item.scale[0], item.scale[1], item.scale[2]);
      matrix.compose(pos, quat, scl);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.set(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  dispose() {
    this.geometry.dispose();
  }
}

/**
 * GeometryBatch - accumulates *different* primitive shapes that share a single
 * material and compiles them into one merged vertex-colored geometry.
 * This is how whole static structures (buildings, desks, ramps) become one draw call.
 */
export class GeometryBatch {
  constructor(material, { castShadow = true, receiveShadow = true, name = 'geometry-batch', texelScale = 0.25 } = {}) {
    this.material = material;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.name = name;
    this.texelScale = texelScale;
    this.entries = [];
    this._unitBox = new THREE.BoxGeometry(1, 1, 1);
  }

  /** Box anchored at its bottom center by default (world y = ground). */
  box(size, { position = [0, 0, 0], rotation = [0, 0, 0], color = '#ffffff', anchor = 'bottom' } = {}) {
    const y = anchor === 'bottom' ? position[1] + size[1] / 2 : anchor === 'top' ? position[1] - size[1] / 2 : position[1];
    this.entries.push({ geometry: this._unitBox, size, position: [position[0], y, position[2]], rotation, color });
    return this;
  }

  raw(geometry, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], color = '#ffffff' } = {}) {
    this.entries.push({ geometry, size: scale, position, rotation, color, raw: true });
    return this;
  }

  get count() {
    return this.entries.length;
  }

  build() {
    const geos = [];
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const entry of this.entries) {
      const geo = entry.raw ? entry.geometry.clone() : entry.geometry.clone();
      euler.set(entry.rotation[0], entry.rotation[1], entry.rotation[2]);
      quat.setFromEuler(euler);
      pos.set(entry.position[0], entry.position[1], entry.position[2]);
      scl.set(entry.size[0], entry.size[1], entry.size[2]);
      matrix.compose(pos, quat, scl);
      geo.applyMatrix4(matrix);
      const count = geo.attributes.position.count;
      const c = new THREE.Color(entry.color);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // Planar world-space UV projection. Box UVs are per-face 0..1 and do not
      // scale with size, so a merged batch of different-sized boxes stretches any
      // texture unpredictably. Picking the projection plane per face normal gives
      // a consistent texel density across the whole structure.
      const uv = new Float32Array(count * 2);
      const positions = geo.attributes.position.array;
      const normals = geo.attributes.normal ? geo.attributes.normal.array : null;
      for (let i = 0; i < count; i++) {
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        const nx = normals ? Math.abs(normals[i * 3]) : 0;
        const ny = normals ? Math.abs(normals[i * 3 + 1]) : 1;
        const nz = normals ? Math.abs(normals[i * 3 + 2]) : 0;
        let u;
        let v;
        if (ny >= nx && ny >= nz) {
          u = px;
          v = pz;
        } else if (nx >= nz) {
          u = pz;
          v = py;
        } else {
          u = px;
          v = py;
        }
        uv[i * 2] = u * this.texelScale;
        uv[i * 2 + 1] = v * this.texelScale;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geos.push(geo);
    }
    const geometry = mergeGeometries(geos);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = this.name;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    return mesh;
  }
}
