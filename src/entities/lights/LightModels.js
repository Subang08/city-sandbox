import THREE from '../../lib/three.js';
import { mergeGeometries, paintGeometry } from '../../lib/merge.js';

function box(w, h, d, color, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (rotation[0] || rotation[1] || rotation[2]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
    geo.applyQuaternion(q);
  }
  geo.translate(position[0], position[1], position[2]);
  return paintGeometry(geo, color);
}

function cyl(r, h, color, position = [0, 0, 0], rotation = [0, 0, 0], segments = 10) {
  const geo = new THREE.CylinderGeometry(r, r, h, segments);
  if (rotation[0] || rotation[1] || rotation[2]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
    geo.applyQuaternion(q);
  }
  geo.translate(position[0], position[1], position[2]);
  return paintGeometry(geo, color);
}

/**
 * Street / site light models. The head is a separate mesh so the LightingSystem
 * can register an emissive material + a real PointLight when it matters.
 */
export function createStreetLightModel({ height = 7.6, arm = 1.5 } = {}) {
  const pole = mergeGeometries([
    box(0.6, 0.3, 0.6, '#6f7679', [0, 0.15, 0]),
    cyl(0.12, height, '#7d8488', [0, height / 2 + 0.3, 0], [0, 0, 0], 8),
    box(0.18, 0.18, arm, '#7d8488', [0, height + 0.25, arm / 2]),
    cyl(0.16, 0.4, '#6f7679', [0, height + 0.05, 0], [0, 0, 0], 8),
  ]);
  const head = mergeGeometries([
    box(0.56, 0.18, 1.0, '#959c9f', [0, height + 0.1, arm]),
    box(0.46, 0.12, 0.86, '#fff0c8', [0, height - 0.02, arm]),
  ]);
  return { pole, head, height, arm };
}

export function createWorkLampModel() {
  const body = mergeGeometries([
    box(0.9, 0.16, 0.9, '#4a5054', [0, 0.08, 0]),
    box(0.16, 4.6, 0.16, '#5c6165', [0, 2.3, 0]),
    box(0.12, 0.12, 1.1, '#5c6165', [0, 4.5, 0.5]),
    box(0.12, 1.2, 0.12, '#5c6165', [0, 5.0, 1.0]),
    box(1.5, 0.9, 0.35, '#c9a227', [0, 4.9, 1.0], [-0.5, 0, 0]),
  ]);
  const head = mergeGeometries([
    box(1.34, 0.72, 0.12, '#fff3cf', [0, 4.9, 1.16], [-0.5, 0, 0]),
  ]);
  return { body, head, height: 5.6, aim: new THREE.Vector3(0, 4.9, 1.16) };
}

export { box, cyl };
