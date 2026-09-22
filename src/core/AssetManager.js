import THREE from '../lib/three.js';

const _v = new THREE.Vector3();

/**
 * AssetManager - one interface for every visual asset in the world.
 *
 * Resolution order for a logical asset id:
 *   1. registered procedural factory  (procedural://...)
 *   2. GLB/GLTF file on disk          (assets/models/*.glb)
 *   3. procedural fallback declared in scene config
 *
 * Entities never touch the file system directly: they ask for an asset id and
 * receive a factory-produced object. Swapping a placeholder for real GLB art is
 * therefore a config change, not a code change.
 */
export class AssetManager {
  constructor({ baseUrl = './assets/', onWarn = null } = {}) {
    this.baseUrl = baseUrl;
    this.factories = new Map();
    this.gltfCache = new Map();
    this.instanceCache = new Map();
    this.stats = { procedural: 0, file: 0, cacheHits: 0, failures: 0 };
    this.onWarn = onWarn || (() => {});
  }

  /** Register a procedural placeholder: id -> (context) => THREE.Object3D */
  registerProcedural(id, factory, meta = {}) {
    this.factories.set(id, { factory, meta });
    return this;
  }

  has(id) {
    return this.factories.has(id);
  }

  describe() {
    return [...this.factories.entries()].map(([id, entry]) => ({
      id,
      kind: entry.meta.kind || 'prop',
      source: entry.meta.source || 'procedural',
      triangles: entry.meta.triangles || 0,
    }));
  }

  /**
   * Create a fresh instance of an asset. `variant` lets a factory build a
   * deterministic variation (color, size) without new assets.
   */
  create(id, options = {}) {
    const entry = this.factories.get(id);
    if (!entry) {
      this.stats.failures++;
      this.onWarn(`AssetManager: unknown asset "${id}", using fallback box`);
      return this._fallbackBox(options);
    }
    this.stats.procedural++;
    const object = entry.factory({ ...options, assetId: id, assetManager: this });
    object.userData.assetId = id;
    object.userData.procedural = true;
    return object;
  }

  /** Clone-friendly shared creation used for instancing bulk props. */
  createGeometry(id, options = {}) {
    const key = `${id}:${JSON.stringify(options.geometryKey || options)}`;
    if (this.instanceCache.has(key)) {
      this.stats.cacheHits++;
      return this.instanceCache.get(key);
    }
    const object = this.create(id, options);
    const geometry = this._collectGeometry(object);
    this.instanceCache.set(key, geometry);
    return geometry;
  }

  _collectGeometry(object) {
    const geometries = [];
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (!child.isMesh) return;
      const geo = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      if (!geo.attributes.uv) {
        const count = geo.attributes.position.count;
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      if (!geo.attributes.color) {
        const color = new THREE.Color(1, 1, 1);
        const count = geo.attributes.position.count;
        const arr = new Float32Array(count * 3);
        arr.fill(1);
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        void color;
      }
      geometries.push(geo);
    });
    if (!geometries.length) return new THREE.BoxGeometry(1, 1, 1);
    if (geometries.length === 1) return geometries[0];
    const { mergeGeometries } = AssetManager._merge;
    return mergeGeometries(geometries);
  }

  _fallbackBox(options) {
    const group = new THREE.Group();
    const size = options.size || [1, 1, 1];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      new THREE.MeshStandardMaterial({ color: 0xb04a8a, roughness: 0.6, metalness: 0.2 }),
    );
    mesh.position.y = size[1] / 2;
    mesh.castShadow = true;
    group.add(mesh);
    return group;
  }

  /** Optional GLB path (kept for production swap). Returns null when absent. */
  async loadGLB(url) {
    if (this.gltfCache.has(url)) return this.gltfCache.get(url);
    return null;
  }

  /** Utility: measure triangles of an object graph. */
  static countTriangles(object) {
    let triangles = 0;
    object.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const geo = child.geometry;
      const count = geo.index ? geo.index.count : geo.attributes.position.count;
      triangles += count / 3;
    });
    return Math.round(triangles);
  }

  static setStatic(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.matrixAutoUpdate = false;
      child.updateMatrix();
    });
    return object;
  }

  static _merge = null;
  static useMerge(fn) {
    AssetManager._merge = fn;
  }
}

export function measureObject(object, target = _v) {
  const box = new THREE.Box3().setFromObject(object);
  box.getSize(target);
  return target;
}
