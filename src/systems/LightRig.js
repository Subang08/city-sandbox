import THREE from '../lib/three.js';
import { InstanceBatch } from '../lib/materials.js';
import { TAU } from '../lib/mathx.js';

/**
 * LightRig - every small emissive glow in the scene (vehicle lights, beacons,
 * lamp heads, warning lights) becomes ONE additive InstancedMesh of billboards.
 * Entities register a slot and write position/color/scale each frame.
 */
export class LightRig {
  constructor({ scene, kits, capacity = 256 }) {
    this.scene = scene;
    this.capacity = capacity;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'light-rig';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.scene.add(this.mesh, { dynamic: true });
    this.slots = [];
    this._matrix = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._color = new THREE.Color();
    this._next = 0;
  }

  allocate(owner, { color = '#ffffff', size = 0.5 } = {}) {
    if (this.slots.length >= this.capacity) return null;
    const slot = {
      index: this.slots.length,
      owner,
      color,
      size,
      intensity: 1,
      offset: new THREE.Vector3(),
      enabled: true,
      pulses: false,
      phase: Math.random() * TAU,
    };
    this.slots.push(slot);
    return slot;
  }

  release(slot) {
    if (!slot) return;
    slot.enabled = false;
  }

  /** Called each frame by the world with the active camera for billboard facing. */
  update(camera, time) {
    const active = this.slots.filter((slot) => slot.enabled);
    this.mesh.count = active.length;
    active.forEach((slot, index) => {
      const owner = slot.owner;
      if (!owner) return;
      const pulse = slot.pulses ? 0.35 + 0.65 * Math.abs(Math.sin(time * 3.2 + slot.phase)) : 1;
      this._pos.copy(owner.position).add(slot.offset);
      const size = slot.size * slot.intensity * pulse;
      this._scale.set(size, size, size);
      if (camera) {
        this._quat.copy(camera.quaternion);
      } else {
        this._quat.identity();
      }
      this._matrix.compose(this._pos, this._quat, this._scale);
      this.mesh.setMatrixAt(index, this._matrix);
      this._color.set(slot.color).multiplyScalar(Math.max(0.05, pulse) * (0.35 + slot.intensity));
      this.mesh.setColorAt(index, this._color);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
void InstanceBatch;
