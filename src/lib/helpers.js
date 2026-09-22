import THREE from './three.js';

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

/** Debug visuals: line paths, waypoint graphs, target crosses, bounding boxes. */
export class DebugDraw {
  constructor(sceneManager) {
    this.scene = sceneManager;
    this.group = new THREE.Group();
    this.group.name = 'debug';
    sceneManager.add(this.group, { helper: true });
    this.lines = new Map();
    this.boxes = new Map();
    this.visible = false;
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
    return visible;
  }

  _material(color, opacity = 0.85) {
    return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true });
  }

  /** Create or replace a named LineSegments / Line. */
  setLine(name, positions, { color = 0x66e0ff, mode = 'segments', opacity = 0.85 } = {}) {
    let entry = this.lines.get(name);
    if (!entry) {
      const geometry = new THREE.BufferGeometry();
      const material = this._material(color, opacity);
      const object =
        mode === 'segments' ? new THREE.LineSegments(geometry, material) : new THREE.Line(geometry, material);
      object.frustumCulled = false;
      this.group.add(object);
      entry = { object, geometry, material };
      this.lines.set(name, entry);
    }
    entry.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    entry.geometry.computeBoundingSphere();
    entry.object.visible = true;
    return entry.object;
  }

  setCurve(name, curve, { color = 0x66e0ff, divisions = 200, offsetY = 0.2 } = {}) {
    const points = curve.getSpacedPoints(divisions);
    const positions = [];
    for (let i = 0; i < points.length - 1; i++) {
      positions.push(points[i].x, offsetY, points[i].z, points[i + 1].x, offsetY, points[i + 1].z);
    }
    return this.setLine(name, positions, { color, mode: 'segments' });
  }

  /** Crosshair + circle marker for an entity target. */
  setMarker(name, position, { color = 0xffd166, radius = 0.9 } = {}) {
    const positions = [];
    positions.push(position.x - radius, position.y + 0.05, position.z, position.x + radius, position.y + 0.05, position.z);
    positions.push(position.x, position.y + 0.05, position.z - radius, position.x, position.y + 0.05, position.z + radius);
    const segments = 20;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      positions.push(
        position.x + Math.cos(a) * radius, position.y + 0.05, position.z + Math.sin(a) * radius,
        position.x + Math.cos(b) * radius, position.y + 0.05, position.z + Math.sin(b) * radius,
      );
    }
    return this.setLine(name, positions, { color });
  }

  /** Dynamic per-entity box helper (created on demand, reused). */
  setBox(id, object3d, { color = 0x7ee08a } = {}) {
    let entry = this.boxes.get(id);
    if (!entry) {
      const helper = new THREE.Box3Helper(new THREE.Box3(), color);
      helper.material.transparent = true;
      helper.material.opacity = 0.7;
      this.group.add(helper);
      entry = { helper };
      this.boxes.set(id, entry);
    }
    _box.setFromObject(object3d);
    if (!Number.isFinite(_box.min.x)) return null;
    entry.helper.box.copy(_box);
    return entry.helper;
  }

  centerOf(object3d, target = _center) {
    _box.setFromObject(object3d);
    _box.getCenter(target);
    return target;
  }

  sizeOf(object3d, target = _size) {
    _box.setFromObject(object3d);
    _box.getSize(target);
    return target;
  }

  clearBoxes() {
    for (const entry of this.boxes.values()) this.group.remove(entry.helper);
    this.boxes.clear();
  }

  beginFrame() {
    for (const entry of this.lines.values()) entry.object.visible = false;
    for (const entry of this.boxes.values()) entry.helper.visible = false;
  }
}
