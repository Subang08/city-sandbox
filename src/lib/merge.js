import THREE from './three.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * Merge an array of BufferGeometry (indexed or not, with mandatory uv+normal)
 * into a single non-indexed geometry. Attributes are unified so that every
 * source contributes position/normal/uv/color.
 */
export function mergeGeometries(geometries) {
  if (!geometries.length) throw new Error('mergeGeometries: empty list');
  const prepared = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of prepared) total += g.attributes.position.count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);
  let offset = 0;

  for (const g of prepared) {
    const count = g.attributes.position.count;
    position.set(g.attributes.position.array, offset * 3);
    // Never leave a zero-filled attribute behind: a missing normal renders as
    // pure black under lighting, and a missing color renders as black under a
    // vertexColors material. Fall back to sensible values instead.
    if (g.attributes.normal) normal.set(g.attributes.normal.array, offset * 3);
    else normal.fill(0, offset * 3, offset * 3 + count * 3);
    for (let i = offset; i < offset + count; i++) normal[i * 3 + 1] = 1;
    if (g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
    if (g.attributes.color) color.set(g.attributes.color.array, offset * 3);
    else color.fill(1, offset * 3, offset * 3 + count * 3);
    offset += count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
const UNIT_CYL_HI = new THREE.CylinderGeometry(1, 1, 1, 20, 1, false);
const UNIT_CONE = new THREE.ConeGeometry(1, 1, 12, 1);
const UNIT_SPHERE = new THREE.SphereGeometry(1, 12, 8);
const UNIT_CIRCLE = new THREE.CircleGeometry(1, 20);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * A display list of primitive shapes. Shapes are accumulated with a material key
 * and later compiled to geometry + material groups (or to instancing batches).
 */
export class ProcBuilder {
  constructor(seed = 'proc') {
    this.parts = [];
    this._palette = null;
    this._key = 'default';
  }

  get length() {
    return this.parts.length;
  }

  useMaterial(key) {
    this._key = key;
    return this;
  }

  clear() {
    this.parts.length = 0;
    return this;
  }

  _push(geometry, opts, shape) {
    const key = opts.material || this._key;
    this.parts.push({
      kind: 'geom',
      material: key,
      geometry,
      shape,
      position: opts.position || null,
      rotation: opts.rotation || null,
      scale: opts.scale || null,
      color: opts.color === undefined ? '#cccccc' : opts.color,
      pivot: opts.pivot || null,
      name: opts.name || null,
    });
    return this;
  }

  /** Box. `size` = [w,h,d]; `opts.pos` = [x,y,z] (center by default, or ground-anchored with `anchor:'bottom'`). */
  box(size, opts = {}) {
    const s = opts.scale || null;
    return this._push(UNIT_BOX, { ...opts, scale: s || size }, { type: 'box', size });
  }

  cyl(radius, height, opts = {}) {
    const radial = opts.radialSegments || 12;
    const geo = radial > 12 ? UNIT_CYL_HI : UNIT_CYL;
    return this._push(
      geo,
      { ...opts, scale: [radius, height, opts.depth === undefined ? radius : opts.depth] },
      { type: 'cyl', radius, height },
    );
  }

  tube(radius, height, opts = {}) {
    return this.cyl(radius, height, opts);
  }

  cone(radius, height, opts = {}) {
    return this._push(UNIT_CONE, { ...opts, scale: [radius, height, radius] }, { type: 'cone' });
  }

  sphere(radius, opts = {}) {
    return this._push(UNIT_SPHERE, { ...opts, scale: [radius, radius, radius] }, { type: 'sphere' });
  }

  plate(size, opts = {}) {
    return this._push(UNIT_PLANE, { ...opts, scale: size }, { type: 'plane', size });
  }

  disc(radius, opts = {}) {
    return this._push(UNIT_CIRCLE, { ...opts, scale: [radius, radius, radius] }, { type: 'disc' });
  }

  /** Free-form: raw BufferGeometry merged through the same pipeline. */
  raw(geometry, opts = {}) {
    return this._push(geometry, opts, { type: 'raw' });
  }
}

function applyPartGeometry(part) {
  const geo = part.geometry.clone();
  const shape = part.shape;
  if (part.scale) geo.scale(part.scale[0], part.scale[1], part.scale[2]);
  else if (shape && shape.size) geo.scale(shape.size[0], shape.size[1], shape.size[2]);

  if (part.pivot) geo.translate(-part.pivot[0], -part.pivot[1], -part.pivot[2]);
  if (part.rotation) {
    _e.set(part.rotation[0], part.rotation[1], part.rotation[2]);
    _q.setFromEuler(_e);
    geo.applyQuaternion(_q);
  }
  if (part.position) {
    const p = part.position;
    let ox = p[0];
    let oy = p[1];
    let oz = p[2];
    if (part.anchor === 'bottom') oy += (part.scale ? part.scale[1] : 0) / 2;
    geo.translate(ox, oy, oz);
  }
  return geo;
}

/** Apply per-vertex color to a geometry (creates the attribute when missing). */
export function paintGeometry(geometry, color) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/**
 * Compile a ProcBuilder into a single geometry with groups, one group per material key.
 * Returns { geometry, groups: [{material, start, count}], order }.
 */
export function compileParts(builder) {
  const byKey = new Map();
  for (const part of builder.parts) {
    if (!byKey.has(part.material)) byKey.set(part.material, []);
    byKey.get(part.material).push(part);
  }
  const merged = [];
  const groups = [];
  let cursor = 0;
  for (const [key, parts] of byKey) {
    const geos = parts.map((part) => paintGeometry(applyPartGeometry(part), part.color));
    const geo = mergeGeometries(geos);
    const count = geo.attributes.position.count;
    merged.push(geo);
    groups.push({ material: key, start: cursor, count });
    cursor += count;
  }
  const geometry = mergeWithGroups(merged, groups.map((g) => [g.start, g.count]));
  return { geometry, groups };
}

/**
 * Merge geometries and attach groups. `ranges` is a list of [start, count] pairs,
 * or a list of {start,count} objects (already resolved).
 */
export function mergeWithGroups(geometries, ranges) {
  const merged = mergeGeometries(geometries);
  const resolved = [];
  if (ranges.length && typeof ranges[0] === 'object' && ranges[0] !== null) {
    let sum = 0;
    for (const g of geometries) {
      const count = g.attributes.position.count;
      resolved.push([sum, count]);
      sum += count;
    }
  } else {
    for (const r of ranges) resolved.push(r);
  }
  merged.clearGroups();
  for (const [start, count] of resolved) merged.addGroup(start, count, 0);
  return merged;
}

/** Convenience: geometry from parts with an array of materials in group order. */
export function buildMesh(builder, materials, opts = {}) {
  const { geometry, groups } = compileParts(builder);
  const mats = groups.map((g) => {
    const m = materials[g.material];
    if (!m) throw new Error(`buildMesh: missing material "${g.material}"`);
    return m;
  });
  const mesh = new THREE.Mesh(geometry, mats);
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  return mesh;
}

/**
 * A single merged geometry from a builder where every material collapses into one
 * (vertex-colored) draw call. Parts still declare a material key, which selects the
 * group order but shares one material instance at the end.
 */
export function buildVertexColorGeometry(builder) {
  const { geometry, groups } = compileParts(builder);
  return { geometry, materialKeys: groups.map((g) => g.material) };
}

export function bakeObjectGeometry(object3D) {
  const geos = [];
  object3D.updateMatrixWorld(true);
  object3D.traverse((child) => {
    if (!child.isMesh) return;
    const geo = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone());
    geo.applyMatrix4(child.matrixWorld);
    if (!geo.attributes.color) {
      const base = Array.isArray(child.material) ? child.material[0] : child.material;
      paintGeometry(geo, base && base.color ? base.color : '#cccccc');
    }
    geos.push(geo);
  });
  return mergeGeometries(geos);
}

export const CUBE_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
