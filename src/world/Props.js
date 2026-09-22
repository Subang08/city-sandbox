import THREE from '../lib/three.js';
import { ProcBuilder, mergeGeometries, paintGeometry } from '../lib/merge.js';
import { Rng } from '../lib/rng.js';

/**
 * Procedural prop library. Every builder returns a single merged, vertex-colored
 * geometry that the world instantiates hundreds of times in one draw call.
 * These are the placeholders behind AssetManager ids: swap the factory for a GLB
 * loader later without touching world code.
 */

function compile(builder) {
  const merged = mergeGeometries(
    builder.parts.map((part) => {
      const geo = part.geometry.clone();
      if (part.scale) geo.scale(part.scale[0], part.scale[1], part.scale[2]);
      else if (part.shape && part.shape.size) geo.scale(part.shape.size[0], part.shape.size[1], part.shape.size[2]);
      if (part.rotation) {
        const e = new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]);
        const q = new THREE.Quaternion().setFromEuler(e);
        geo.applyQuaternion(q);
      }
      if (part.position) {
        const p = part.position;
        const y = part.anchor === 'bottom' ? p[1] + (part.scale ? part.scale[1] : 0) / 2 : p[1];
        geo.translate(p[0], y, p[2]);
      }
      return paintGeometry(geo, part.color);
    }),
  );
  // Normalize so the geometry's origin sits at its footprint centre (y = ground).
  const box = new THREE.Box3().setFromBufferAttribute(merged.attributes.position);
  const center = new THREE.Vector3();
  box.getCenter(center);
  merged.translate(-center.x, -box.min.y, -center.z);
  merged.computeBoundingSphere();
  return merged;
}

function b() {
  return new ProcBuilder();
}

export const PropGeometries = {
  cone() {
    const builder = b();
    const color = '#ff6a1f';
    builder
      .box([0.42, 0.05, 0.42], { position: [0, 0.025, 0], color })
      .cone(0.115, 0.62, { position: [0, 0.34, 0], color })
      .box([0.24, 0.1, 0.024], { position: [0, 0.42, 0.1], color: '#f4f7f8' });
    return compile(builder);
  },

  barrier() {
    const builder = b();
    builder
      .box([0.06, 0.95, 0.06], { position: [-0.78, 0, 0], anchor: 'bottom', color: '#c9ccd0' })
      .box([0.06, 0.95, 0.06], { position: [0.78, 0, 0], anchor: 'bottom', color: '#c9ccd0' })
      .box([1.7, 0.26, 0.05], { position: [0, 0.62, 0], color: '#e8e3d8' })
      .box([1.7, 0.26, 0.05], { position: [0, 0.28, 0], color: '#e8e3d8' })
      .box([1.7, 0.14, 0.05], { position: [0, 0.95, 0], color: '#e8e3d8' })
      .box([0.34, 0.26, 0.052], { position: [-0.5, 0.62, 0.002], color: '#d8402f' })
      .box([0.34, 0.26, 0.052], { position: [0.1, 0.62, 0.002], color: '#d8402f' })
      .box([0.34, 0.26, 0.052], { position: [-0.18, 0.28, 0.002], color: '#d8402f' })
      .box([0.34, 0.26, 0.052], { position: [0.44, 0.28, 0.002], color: '#d8402f' });
    return compile(builder);
  },

  rebarBundle() {
    const builder = b();
    for (let i = 0; i < 7; i++) {
      const x = -0.16 + (i % 4) * 0.11;
      const z = -0.1 + Math.floor(i / 4) * 0.11;
      builder.cyl(0.045, 3.6, { position: [x, 0.05, z], rotation: [Math.PI / 2, 0, 0], color: i % 2 ? '#8a5a34' : '#9c6a3c', radialSegments: 6 });
    }
    builder.box([0.5, 0.08, 0.34], { position: [0, 0, 0], anchor: 'bottom', color: '#3d4a54' });
    return compile(builder);
  },

  cementPallet() {
    const builder = b();
    builder
      .box([1.2, 0.14, 1.0], { position: [0, 0.07, 0], color: '#a1743d' })
      .box([1.18, 0.1, 0.08], { position: [0, 0.0, -0.42], color: '#8a6234' })
      .box([1.18, 0.1, 0.08], { position: [0, 0.0, 0.42], color: '#8a6234' });
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < 5; i++) {
        builder.box([0.21, 0.12, 0.62], {
          position: [-0.44 + i * 0.22, 0.14 + layer * 0.13, layer % 2 ? 0 : 0.03],
          color: layer % 2 ? '#b9b2a4' : '#c6bfb0',
        });
      }
    }
    return compile(builder);
  },

  pallet() {
    const builder = b();
    builder.box([1.2, 0.14, 0.8], { position: [0, 0.07, 0], color: '#a97b45' });
    for (let i = 0; i < 5; i++) {
      builder.box([1.16, 0.05, 0.12], { position: [0, 0.17, -0.3 + i * 0.15], color: i % 2 ? '#b98a52' : '#a97b45' });
    }
    return compile(builder);
  },

  brickPallet() {
    const builder = b();
    builder.box([1.1, 0.12, 0.9], { position: [0, 0.06, 0], color: '#a1743d' });
    const rng = new Rng('brick');
    for (let layer = 0; layer < 4; layer++) {
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          builder.box([0.24, 0.11, 0.4], {
            position: [-0.36 + col * 0.24 + (layer % 2 ? 0.06 : 0), 0.12 + layer * 0.12, -0.28 + row * 0.28],
            color: rng.chance(0.5) ? '#b5623c' : '#a9573a',
          });
        }
      }
    }
    return compile(builder);
  },

  container() {
    const builder = b();
    const color = '#3f6e86';
    builder.box([6.05, 2.6, 2.44], { position: [0, 1.3, 0], color });
    for (let i = 0; i < 13; i++) {
      builder.box([0.1, 2.35, 2.46], { position: [-2.75 + i * 0.46, 1.3, 0], color: i % 2 ? '#376276' : '#457a94' });
    }
    builder.box([6.15, 0.16, 2.54], { position: [0, 2.66, 0], color: '#2e5566' });
    builder.box([0.14, 2.5, 2.5], { position: [3.0, 1.3, 0], color: '#2a4d5c' });
    builder.box([1.1, 0.1, 0.16], { position: [3.06, 1.5, 0.7], color: '#9aa5ac' });
    builder.box([1.1, 0.1, 0.16], { position: [3.06, 1.5, -0.7], color: '#9aa5ac' });
    return compile(builder);
  },

  powerBox() {
    const builder = b();
    builder
      .box([1.3, 0.35, 0.9], { position: [0, 0.17, 0], color: '#8d9296' })
      .box([1.1, 1.5, 0.72], { position: [0, 1.0, 0], color: '#d8c14a' })
      .box([1.06, 0.7, 0.06], { position: [0, 1.15, 0.38], color: '#b9a53c' })
      .box([0.9, 0.1, 0.08], { position: [0, 1.55, 0.36], color: '#6a6f73' })
      .box([0.14, 0.42, 0.12], { position: [-0.35, 0.72, 0.36], color: '#2f3438' })
      .box([0.14, 0.42, 0.12], { position: [0.35, 0.72, 0.36], color: '#2f3438' })
      .box([1.1, 0.1, 0.8], { position: [0, 1.78, 0], color: '#7d8286' })
      .box([0.3, 0.2, 0.06], { position: [0, 1.05, 0.4], color: '#e34b3f' });
    return compile(builder);
  },

  floodlight() {
    const builder = b();
    builder
      .box([0.6, 0.12, 0.6], { position: [0, 0.06, 0], color: '#4a4f53' })
      .box([0.12, 1.9, 0.12], { position: [0, 1.0, 0], color: '#5c6165' })
      .box([0.9, 0.55, 0.22], { position: [0, 2.0, 0], rotation: [-0.42, 0, 0], color: '#c9a227' })
      .box([0.78, 0.42, 0.05], { position: [0, 2.0, 0.14], rotation: [-0.42, 0, 0], color: '#fff3cf' })
      .box([0.06, 0.9, 0.06], { position: [0.3, 2.1, -0.12], color: '#5c6165' });
    return compile(builder);
  },

  portacabin() {
    const builder = b();
    builder
      .box([6.0, 0.25, 2.9], { position: [0, 0.12, 0], color: '#6e7377' })
      .box([5.9, 2.5, 2.8], { position: [0, 1.5, 0], color: '#e2e6e6' })
      .box([5.96, 0.16, 2.86], { position: [0, 2.78, 0], color: '#c3c8c9' })
      .box([5.5, 0.06, 2.4], { position: [0, 2.9, 0], color: '#8f9598' })
      .box([1.5, 1.05, 0.06], { position: [-1.6, 1.8, 1.42], color: '#7fb3cc' })
      .box([1.5, 1.05, 0.06], { position: [0.4, 1.8, 1.42], color: '#7fb3cc' })
      .box([0.9, 2.0, 0.08], { position: [1.9, 1.15, 1.42], color: '#5f8ea8' })
      .box([0.1, 0.1, 0.1], { position: [2.5, 1.05, 1.44], color: '#3f4448' })
      .box([1.2, 0.5, 1.2], { position: [-2.0, 2.9, 0], color: '#b7bcbe' });
    return compile(builder);
  },

  dumpster() {
    const builder = b();
    builder
      .box([2.4, 1.2, 1.3], { position: [0, 0.6, 0], color: '#8a4b3a' })
      .box([2.44, 0.1, 1.34], { position: [0, 1.22, 0], color: '#6f3a2c' })
      .box([0.2, 0.3, 0.2], { position: [-0.9, 0.15, 0.6], color: '#3a3f42' })
      .box([0.2, 0.3, 0.2], { position: [0.9, 0.15, 0.6], color: '#3a3f42' })
      .box([0.2, 0.3, 0.2], { position: [-0.9, 0.15, -0.6], color: '#3a3f42' })
      .box([0.2, 0.3, 0.2], { position: [0.9, 0.15, -0.6], color: '#3a3f42' })
      .box([2.3, 0.08, 0.3], { position: [0, 1.3, 0.4], color: '#9c5a45' });
    return compile(builder);
  },

  wheelStop() {
    const builder = b();
    builder.box([1.6, 0.16, 0.22], { position: [0, 0.08, 0], color: '#d8d2c4' });
    builder.box([1.6, 0.06, 0.26], { position: [0, 0.19, 0], color: '#c2bcae' });
    return compile(builder);
  },

  pipeRack() {
    const builder = b();
    builder
      .box([2.6, 0.16, 1.3], { position: [0, 0.08, 0], color: '#8f6f3f' })
      .box([0.16, 0.5, 1.3], { position: [-1.2, 0.41, 0], color: '#8f6f3f' })
      .box([0.16, 0.5, 1.3], { position: [1.2, 0.41, 0], color: '#8f6f3f' });
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 4; i++) {
        builder.cyl(0.22, 2.8, {
          position: [-0.42 + (i % 2) * 0.84, 0.38 + row * 0.46, -0.34 + Math.floor(i / 2) * 0.68],
          rotation: [0, 0, Math.PI / 2],
          color: row % 2 ? '#9aa3a8' : '#7f878c',
          radialSegments: 10,
        });
      }
    }
    return compile(builder);
  },

  ladder() {
    const builder = b();
    for (let i = 0; i < 7; i++) {
      builder.box([0.9, 0.06, 0.06], { position: [0, 0.35 + i * 0.34, 0], color: '#b0b6ba' });
    }
    builder.box([0.07, 2.5, 0.07], { position: [-0.45, 1.25, 0], color: '#9aa1a6' });
    builder.box([0.07, 2.5, 0.07], { position: [0.45, 1.25, 0], color: '#9aa1a6' });
    return compile(builder);
  },

  sign() {
    const builder = b();
    builder
      .box([0.08, 1.6, 0.08], { position: [-0.5, 0.8, 0], color: '#9aa1a6' })
      .box([0.08, 1.6, 0.08], { position: [0.5, 0.8, 0], color: '#9aa1a6' })
      .box([1.4, 0.9, 0.06], { position: [0, 1.55, 0], color: '#2f6f8f' })
      .box([1.2, 0.16, 0.08], { position: [0, 1.72, 0.02], color: '#eef3f5' })
      .box([0.9, 0.16, 0.08], { position: [-0.1, 1.5, 0.02], color: '#eef3f5' })
      .box([0.5, 0.16, 0.08], { position: [-0.3, 1.28, 0.02], color: '#ffd166' });
    return compile(builder);
  },

  streetLight() {
    const builder = b();
    builder
      .box([0.55, 0.3, 0.55], { position: [0, 0.15, 0], color: '#6f7679' })
      .cyl(0.11, 7.6, { position: [0, 3.9, 0], color: '#7d8488', radialSegments: 8 })
      .box([0.16, 0.16, 1.5], { position: [0, 7.6, 0.75], color: '#7d8488' })
      .box([0.5, 0.16, 0.9], { position: [0, 7.5, 1.5], color: '#959c9f' })
      .box([0.42, 0.1, 0.78], { position: [0, 7.4, 1.5], color: '#fff0c8' });
    return compile(builder);
  },

  tree() {
    const builder = b();
    const rng = new Rng('tree');
    builder.cyl(0.16, 2.4, { position: [0, 1.2, 0], color: '#6b503a', radialSegments: 7 });
    const blobs = [
      [0, 3.0, 0, 1.35],
      [0.55, 2.7, 0.3, 0.9],
      [-0.5, 2.8, -0.25, 0.94],
      [0.15, 3.7, -0.35, 0.8],
    ];
    for (const [x, y, z, r] of blobs) {
      builder.sphere(r, { position: [x, y, z], color: rng.chance(0.5) ? '#4f7a3c' : '#5d8a45' });
    }
    return compile(builder);
  },

  hedge() {
    const builder = b();
    builder.box([3.4, 0.9, 1.1], { position: [0, 0.45, 0], color: '#4a7438' });
    builder.box([3.2, 0.3, 1.0], { position: [0, 0.9, 0], color: '#558141' });
    return compile(builder);
  },

  car() {
    const builder = b();
    builder
      .box([4.2, 0.75, 1.85], { position: [0, 0.72, 0], color: '#2f5d8c' })
      .box([2.3, 0.72, 1.7], { position: [-0.25, 1.4, 0], color: '#3a6d9e' })
      .box([2.1, 0.5, 1.72], { position: [-0.25, 1.45, 0], color: '#8fb6cf' })
      .box([0.4, 0.18, 0.42], { position: [2.0, 0.75, 0.6], color: '#ffe9b0' })
      .box([0.4, 0.18, 0.42], { position: [2.0, 0.75, -0.6], color: '#ffe9b0' })
      .box([0.3, 0.2, 0.4], { position: [-2.05, 0.8, 0.6], color: '#c0392b' })
      .box([0.3, 0.2, 0.4], { position: [-2.05, 0.8, -0.6], color: '#c0392b' });
    for (const [x, z] of [[1.4, 0.95], [1.4, -0.95], [-1.4, 0.95], [-1.4, -0.95]]) {
      builder.cyl(0.36, 0.24, { position: [x, 0.36, z], rotation: [Math.PI / 2, 0, 0], color: '#26292c', radialSegments: 10 });
    }
    return compile(builder);
  },

  puddle() {
    const geometry = new THREE.CircleGeometry(1, 16);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  },

  deskMug() {
    const builder = b();
    builder
      .cyl(0.42, 0.6, { position: [0, 0.3, 0], color: '#e8e4dc', radialSegments: 14 })
      .cyl(0.34, 0.06, { position: [0, 0.58, 0], color: '#3a2a22', radialSegments: 14 })
      .raw(new THREE.TorusGeometry(0.2, 0.05, 6, 12), { position: [0.44, 0.35, 0], rotation: [0, Math.PI / 2, 0], color: '#e8e4dc' });
    return compile(builder);
  },

  deskPencil() {
    const builder = b();
    builder
      .cyl(0.055, 1.5, { position: [0, 0.055, 0], rotation: [0, 0, Math.PI / 2], color: '#e0a63c', radialSegments: 8 })
      .cone(0.055, 0.18, { position: [0.83, 0.055, 0], rotation: [0, 0, -Math.PI / 2], color: '#e8d3ae' })
      .cyl(0.055, 0.12, { position: [-0.8, 0.055, 0], rotation: [0, 0, Math.PI / 2], color: '#d9738a', radialSegments: 8 });
    return compile(builder);
  },

  deskRuler() {
    const builder = b();
    builder
      .box([3.2, 0.05, 0.42], { position: [0, 0.025, 0], color: '#d9c9a3' })
      .box([3.0, 0.02, 0.05], { position: [0, 0.05, -0.14], color: '#8a7a5c' });
    for (let i = 0; i < 8; i++) {
      builder.box([0.02, 0.02, 0.12], { position: [-1.4 + i * 0.4, 0.05, 0.08], color: '#6f6248' });
    }
    return compile(builder);
  },

  deskNotebook() {
    const builder = b();
    builder
      .box([2.6, 0.09, 3.6], { position: [0, 0.05, 0], color: '#f1ede2' })
      .box([2.66, 0.05, 3.66], { position: [0, 0.02, 0], color: '#c8c2b4' })
      .box([2.4, 0.02, 0.06], { position: [0, 0.1, -1.2], color: '#9aa4ad' })
      .box([2.0, 0.02, 0.06], { position: [-0.2, 0.1, -0.6], color: '#9aa4ad' })
      .box([1.6, 0.02, 0.06], { position: [-0.4, 0.1, 0.0], color: '#9aa4ad' });
    return compile(builder);
  },

  deskPlant() {
    const builder = b();
    builder
      .cyl(0.5, 0.55, { position: [0, 0.28, 0], color: '#a8674a', radialSegments: 12 })
      .cyl(0.45, 0.08, { position: [0, 0.58, 0], color: '#3f2f26', radialSegments: 12 });
    const rng = new Rng('plant');
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2;
      builder.box([0.1, 1.2, 0.3], {
        position: [Math.cos(angle) * 0.18, 1.1, Math.sin(angle) * 0.18],
        rotation: [Math.cos(angle) * 0.5, angle, Math.sin(angle) * 0.5],
        color: rng.chance(0.5) ? '#3f7038' : '#4d8340',
      });
    }
    return compile(builder);
  },
};

export function buildPropGeometry(name) {
  const factory = PropGeometries[name];
  if (!factory) throw new Error(`PropGeometries: unknown prop "${name}"`);
  return factory();
}
