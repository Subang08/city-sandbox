import THREE from '../../lib/three.js';
import { Rng } from '../../lib/rng.js';
import { mergeGeometries, paintGeometry } from '../../lib/merge.js';

/**
 * Procedural humanoid rig. Parts are unit geometry merged into ONE vertex-colored
 * geometry per limb, so a worker costs ~10 draw calls and can be animated by
 * rotating Group pivots (no skinning needed for a miniature).
 * Swapping in a skinned GLB later only requires replacing `createCharacterParts`.
 */

const GEOM = {
  torso: new THREE.BoxGeometry(1, 1, 1),
  hips: new THREE.BoxGeometry(1, 1, 1),
  head: new THREE.BoxGeometry(1, 1, 1),
  helmet: new THREE.SphereGeometry(0.62, 10, 6),
  arm: new THREE.BoxGeometry(1, 1, 1),
  leg: new THREE.BoxGeometry(1, 1, 1),
  boot: new THREE.BoxGeometry(1, 1, 1),
  hand: new THREE.BoxGeometry(1, 1, 1),
};

function limb(width, height, depth, color, extra = []) {
  const geometry = GEOM.torso.clone();
  geometry.scale(width, height, depth);
  const parts = [paintGeometry(geometry, color)];
  for (const part of extra) {
    const geo = part.geometry.clone();
    if (part.scale) geo.scale(part.scale[0], part.scale[1], part.scale[2]);
    if (part.position) geo.translate(part.position[0], part.position[1], part.position[2]);
    parts.push(paintGeometry(geo, part.color));
  }
  return mergeGeometries(parts);
}

export const ROLES = {
  foreman: { vest: '#f2c94c', shirt: '#2f3b4a', pants: '#3b4452', helmet: '#f2f4f5', accent: '#e8853c', label: '工长' },
  mason: { vest: '#e8853c', shirt: '#4b5563', pants: '#37404c', helmet: '#e0b23c', accent: '#cfd6da', label: '瓦工' },
  rebar: { vest: '#d94f3d', shirt: '#3f4756', pants: '#2f3641', helmet: '#4a90c2', accent: '#8a5a34', label: '钢筋工' },
  craneSignal: { vest: '#4ec27a', shirt: '#2c3440', pants: '#333b47', helmet: '#f04e3e', accent: '#ffe066', label: '信号工' },
  driver: { vest: '#4a90c2', shirt: '#3a4250', pants: '#2b323c', helmet: '#e8e4dc', accent: '#cfd6da', label: '司机' },
  surveyor: { vest: '#b06fd8', shirt: '#3d4553', pants: '#333a45', helmet: '#f2f4f5', accent: '#4fd2e8', label: '测量员' },
  electrician: { vest: '#e0b23c', shirt: '#414a58', pants: '#2f3641', helmet: '#f2c94c', accent: '#d8c14a', label: '电工' },
};

const SKIN = ['#e8b98f', '#d8a074', '#c08858', '#a9714a', '#8a5a3a'];

export class CharacterModel {
  constructor({ role = 'mason', seed = 'worker', assetId = 'character.worker' } = {}) {
    this.rng = new Rng(`${seed}:${role}`);
    this.role = ROLES[role] ? role : 'mason';
    this.palette = ROLES[this.role];
    this.skin = this.rng.pick(SKIN);
    this.assetId = assetId;
    this.root = new THREE.Group();
    this.root.name = `character:${seed}`;
    this._build();
  }

  _build() {
    const pal = this.palette;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.02,
    });
    this.material = material;

    const mk = (geometry) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    this.hips = new THREE.Group();
    this.hips.position.y = 1.0;
    this.root.add(this.hips);
    const hipGeo = limb(0.42, 0.26, 0.28, pal.pants);
    this.hips.add(mk(hipGeo));

    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const torsoGeo = mergeGeometries([
      paintGeometry(GEOM.torso.clone().scale(0.46, 0.56, 0.3).translate(0, 0.28, 0), pal.shirt),
      paintGeometry(GEOM.torso.clone().scale(0.5, 0.4, 0.34).translate(0, 0.26, 0), pal.vest),
      paintGeometry(GEOM.torso.clone().scale(0.16, 0.34, 0.36).translate(-0.19, 0.3, 0), '#e8e4dc'),
      paintGeometry(GEOM.torso.clone().scale(0.16, 0.34, 0.36).translate(0.19, 0.3, 0), '#e8e4dc'),
    ]);
    this.torso.add(mk(torsoGeo));

    // Neck + head + helmet
    const headGroup = new THREE.Group();
    headGroup.position.y = 0.62;
    this.torso.add(headGroup);
    this.head = headGroup;
    const headGeo = mergeGeometries([
      paintGeometry(GEOM.torso.clone().scale(0.1, 0.1, 0.1).translate(0, 0.03, 0), this.skin),
      paintGeometry(GEOM.torso.clone().scale(0.24, 0.26, 0.24).translate(0, 0.2, 0), this.skin),
      paintGeometry(GEOM.helmet.clone().scale(0.2, 0.16, 0.22).translate(0, 0.31, 0.01), pal.helmet),
      paintGeometry(GEOM.torso.clone().scale(0.3, 0.04, 0.3).translate(0, 0.24, 0.08), pal.helmet),
    ]);
    headGroup.add(mk(headGeo));

    // Arms: shoulder pivot at torso top
    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(-0.3, 0.52, 0);
    this.armR.position.set(0.3, 0.52, 0);
    this.torso.add(this.armL, this.armR);
    const armGeo = (side) =>
      mergeGeometries([
        paintGeometry(GEOM.arm.clone().scale(0.13, 0.44, 0.14).translate(0, -0.22, 0), pal.shirt),
        paintGeometry(GEOM.arm.clone().scale(0.11, 0.34, 0.12).translate(0, -0.6, 0), side === 'L' ? pal.shirt : pal.accent),
        paintGeometry(GEOM.hand.clone().scale(0.12, 0.14, 0.12).translate(0, -0.84, 0), this.skin),
      ]);
    this.armL.add(mk(armGeo('L')));
    this.armR.add(mk(armGeo('R')));

    // Legs
    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-0.13, -0.05, 0);
    this.legR.position.set(0.13, -0.05, 0);
    this.hips.add(this.legL, this.legR);
    const legGeo = () =>
      mergeGeometries([
        paintGeometry(GEOM.leg.clone().scale(0.16, 0.5, 0.17).translate(0, -0.25, 0), pal.pants),
        paintGeometry(GEOM.leg.clone().scale(0.14, 0.42, 0.15).translate(0, -0.7, 0), pal.pants),
        paintGeometry(GEOM.boot.clone().scale(0.17, 0.12, 0.28).translate(0, -0.94, 0.05), '#2b2f33'),
      ]);
    this.legL.add(mk(legGeo()));
    this.legR.add(mk(legGeo()));

    // Carried item socket (in front of the chest, animated by CARRY state)
    this.carrySocket = new THREE.Group();
    this.carrySocket.position.set(0, 0.35, 0.34);
    this.torso.add(this.carrySocket);

    // Vest reflective stripes
    this.root.traverse((child) => {
      if (child.isMesh) {
        child.userData.character = true;
      }
    });
  }

  setCarry(object3d) {
    this.carrySocket.clear();
    if (object3d) {
      object3d.position.set(0, 0, 0);
      this.carrySocket.add(object3d);
    }
  }

  dispose() {
    this.root.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
    this.material.dispose();
  }
}

/** Small carried-item geometries (placeholder assets with the same interface). */
export function createCarryItem(kind, kits) {
  const group = new THREE.Group();
  const material = kits.get(kind === 'pipe' ? 'metal' : kind === 'bag' ? 'fabric' : 'wood');
  if (kind === 'rebar') {
    const geo = mergeGeometries([
      paintGeometry(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6).rotateZ(Math.PI / 2).translate(0, 0.05, -0.1), '#8a5a34'),
      paintGeometry(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6).rotateZ(Math.PI / 2).translate(0, -0.03, 0.1), '#9c6a3c'),
      paintGeometry(new THREE.BoxGeometry(0.5, 0.06, 0.3).translate(0, 0, 0), '#3d4a54'),
    ]);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    group.add(mesh);
  } else if (kind === 'bag') {
    const geo = mergeGeometries([
      paintGeometry(new THREE.BoxGeometry(0.42, 0.16, 0.28).translate(0, 0, 0), '#c6bfb0'),
    ]);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    group.add(mesh);
  } else if (kind === 'tool') {
    const geo = mergeGeometries([
      paintGeometry(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), '#8a6234'),
      paintGeometry(new THREE.BoxGeometry(0.16, 0.12, 0.12).translate(0, 0.5, 0), '#7d8488'),
    ]);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    group.add(mesh);
  } else if (kind === 'bucket') {
    const geo = mergeGeometries([
      paintGeometry(new THREE.CylinderGeometry(0.22, 0.18, 0.34, 10), '#8f9598'),
      paintGeometry(new THREE.TorusGeometry(0.2, 0.02, 4, 10).rotateX(Math.PI / 2).translate(0, 0.17, 0), '#6f7679'),
    ]);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    group.add(mesh);
  } else {
    const geo = mergeGeometries([
      paintGeometry(new THREE.BoxGeometry(0.5, 0.16, 0.4), '#a97b45'),
    ]);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}
