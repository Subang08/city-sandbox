import THREE from './three.js';

/**
 * Minimal orbit controller (no addon dependency): rotate / pan / dolly with
 * damping, polar limits and an optional target that can be driven externally.
 */
export class Orbit {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 6, 0);
    this.spherical = new THREE.Spherical(70, Math.PI * 0.32, 0);
    this.sphericalTarget = this.spherical.clone();
    this.minDistance = 8;
    this.maxDistance = 190;
    this.minPolar = 0.12;
    this.maxPolar = Math.PI * 0.495;
    this.rotateSpeed = 0.85;
    this.zoomSpeed = 0.9;
    this.panSpeed = 0.0016;
    this.damping = 7.5;
    this.enabled = true;
    this.enablePan = true;
    this.userRotating = false;
    this.userInteracting = false;
    this._pointers = new Map();
    this._lastPinch = 0;
    this._idle = 0;
    this._bind();
    this.update(0.016, true);
  }

  _bind() {
    const dom = this.dom;
    this._onDown = (e) => {
      if (!this.enabled) return;
      dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      this.userInteracting = true;
      this._idle = 0;
      if (e.button === 0) this.userRotating = true;
    };
    this._onMove = (e) => {
      const prev = this._pointers.get(e.pointerId);
      if (!prev || !this.enabled) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      this._idle = 0;
      if (this._pointers.size >= 2) {
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._lastPinch) this.dolly(Math.pow(1.02, this._lastPinch - dist));
        this._lastPinch = dist;
        this._pan(dx * 0.5, dy * 0.5);
        return;
      }
      if (prev.button === 2 || e.shiftKey) this._pan(dx, dy);
      else this._rotate(dx, dy);
    };
    this._onUp = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size === 0) {
        this.userRotating = false;
        this.userInteracting = false;
        this._lastPinch = 0;
      }
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this._idle = 0;
      const factor = Math.exp((e.deltaY > 0 ? 1 : -1) * this.zoomSpeed * 0.12);
      this.dolly(factor);
    };
    this._onContext = (e) => e.preventDefault();

    dom.addEventListener('pointerdown', this._onDown);
    dom.addEventListener('pointermove', this._onMove);
    dom.addEventListener('pointerup', this._onUp);
    dom.addEventListener('pointercancel', this._onUp);
    dom.addEventListener('pointerleave', this._onUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
    dom.addEventListener('contextmenu', this._onContext);
    this._dispose = () => {
      dom.removeEventListener('pointerdown', this._onDown);
      dom.removeEventListener('pointermove', this._onMove);
      dom.removeEventListener('pointerup', this._onUp);
      dom.removeEventListener('pointercancel', this._onUp);
      dom.removeEventListener('pointerleave', this._onUp);
      dom.removeEventListener('wheel', this._onWheel);
      dom.removeEventListener('contextmenu', this._onContext);
    };
  }

  _rotate(dx, dy) {
    this.sphericalTarget.theta -= (dx / this.dom.clientHeight) * Math.PI * 2 * this.rotateSpeed;
    this.sphericalTarget.phi -= (dy / this.dom.clientHeight) * Math.PI * this.rotateSpeed;
    this.sphericalTarget.phi = Math.max(this.minPolar, Math.min(this.maxPolar, this.sphericalTarget.phi));
  }

  _pan(dx, dy) {
    if (!this.enablePan) return;
    const scale = (this.spherical.radius * this.panSpeed * this.camera.fov) / 45;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(up, dy * scale);
    const limit = 90;
    this.target.x = Math.max(-limit, Math.min(limit, this.target.x));
    this.target.z = Math.max(-limit, Math.min(limit, this.target.z));
    this.target.y = Math.max(0, Math.min(45, this.target.y));
  }

  dolly(factor) {
    this.sphericalTarget.radius = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.sphericalTarget.radius * factor),
    );
  }

  /** Programmatic move used by camera presets / auto orbit. */
  setPose({ target, radius, phi, theta }, instant = false) {
    if (target) this.target.copy(target);
    if (radius !== undefined) this.sphericalTarget.radius = radius;
    if (phi !== undefined) this.sphericalTarget.phi = Math.max(this.minPolar, Math.min(this.maxPolar, phi));
    if (theta !== undefined) this.sphericalTarget.theta = theta;
    if (instant) {
      this.spherical.copy(this.sphericalTarget);
      this.syncCamera();
    }
  }

  get idleTime() {
    return this._idle;
  }

  syncCamera() {
    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  update(dt) {
    this._idle += dt;
    const k = 1 - Math.exp(-this.damping * dt);
    this.spherical.theta += (this.sphericalTarget.theta - this.spherical.theta) * k;
    this.spherical.phi += (this.sphericalTarget.phi - this.spherical.phi) * k;
    this.spherical.radius += (this.sphericalTarget.radius - this.spherical.radius) * k;
    this.syncCamera();
  }

  dispose() {
    this._dispose();
  }
}
