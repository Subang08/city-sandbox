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

const STEEL = '#e8b23c';
const STEEL_DARK = '#b8862f';
const CONCRETE = '#b3aea4';

/**
 * Tower crane model: concrete ballast block, lattice mast, slewing unit with
 * operator cab, lattice jib + counter-jib, trolley, hook block and ropes.
 * Animated parts are returned separately: { slewGroup, trolley, hookBlock,
 * ropeA, ropeB, hookRope, payloadAnchor }.
 */
export function createCraneModel(spec, kits) {
  const mastHeight = spec.mastHeight || 40;
  const jibLength = spec.jibLength || 28;
  const counterJib = spec.counterJib || 9;
  const baseHeight = spec.baseHeight || 1.5;
  const halfMast = 0.95;

  // ---------- static base (does not slew) ----------
  const baseParts = [];
  baseParts.push(box(4.6, 0.6, 4.6, CONCRETE, [0, 0.3, 0]));
  baseParts.push(box(3.4, baseHeight, 3.4, CONCRETE, [0, baseHeight / 2 + 0.6, 0]));
  baseParts.push(box(4.0, 0.3, 4.0, '#9c968c', [0, baseHeight + 0.75, 0]));
  // Lattice mast: corner posts + bracing every 3 m.
  const lifts = Math.max(2, Math.round(mastHeight / 3));
  const liftHeight = mastHeight / lifts;
  for (const [x, z] of [[-halfMast, -halfMast], [halfMast, -halfMast], [-halfMast, halfMast], [halfMast, halfMast]]) {
    baseParts.push(box(0.16, mastHeight, 0.16, STEEL, [x, baseHeight + 1 + mastHeight / 2, z]));
  }
  for (let i = 0; i <= lifts; i++) {
    const y = baseHeight + 1 + i * liftHeight;
    baseParts.push(box(halfMast * 2, 0.12, 0.12, STEEL_DARK, [0, y, -halfMast]));
    baseParts.push(box(halfMast * 2, 0.12, 0.12, STEEL_DARK, [0, y, halfMast]));
    baseParts.push(box(0.12, 0.12, halfMast * 2, STEEL_DARK, [-halfMast, y, 0]));
    baseParts.push(box(0.12, 0.12, halfMast * 2, STEEL_DARK, [halfMast, y, 0]));
    if (i < lifts) {
      const diag = liftHeight / Math.cos(Math.atan2(halfMast * 2, liftHeight));
      const angle = Math.atan2(halfMast * 2, liftHeight);
      baseParts.push(box(0.1, diag, 0.1, STEEL_DARK, [0, y + liftHeight / 2, -halfMast], [0, 0, angle]));
      baseParts.push(box(0.1, diag, 0.1, STEEL_DARK, [0, y + liftHeight / 2, halfMast], [0, 0, -angle]));
      baseParts.push(box(0.1, diag, 0.1, STEEL_DARK, [-halfMast, y + liftHeight / 2, 0], [-angle, 0, 0]));
      baseParts.push(box(0.1, diag, 0.1, STEEL_DARK, [halfMast, y + liftHeight / 2, 0], [angle, 0, 0]));
    }
  }
  // Base jacking frame + power box at the foot
  baseParts.push(box(2.6, 0.9, 1.4, '#8f9598', [1.6, 1.0, 1.6]));
  baseParts.push(box(0.3, 1.0, 0.3, '#e8b23c', [-1.4, 0.9, 1.4]));

  // ---------- slewing assembly ----------
  const topY = baseHeight + 1 + mastHeight;
  const slewParts = [];
  slewParts.push(box(2.0, 0.5, 2.0, STEEL_DARK, [0, topY + 0.25, 0]));
  slewParts.push(box(1.7, 1.1, 1.7, STEEL, [0, topY + 0.9, 0]));
  // Operator cab offset from the mast
  slewParts.push(box(1.5, 1.6, 1.7, '#dfe4e6', [1.7, topY + 1.4, -1.4]));
  slewParts.push(box(1.4, 0.8, 0.1, '#7fa8bd', [1.7, topY + 1.6, -0.5]));
  slewParts.push(box(1.6, 0.12, 1.8, STEEL_DARK, [1.7, topY + 2.3, -1.4]));
  // Counter-jib with ballast
  slewParts.push(box(0.9, 0.5, 0.9, STEEL, [0, topY + 0.7, -1.2]));
  for (let i = 0; i < 5; i++) {
    const z = -2.0 - i * (counterJib / 5);
    slewParts.push(box(0.16, 0.16, 0.16, STEEL, [-0.6, topY + 1.5, z]));
    slewParts.push(box(0.16, 0.16, 0.16, STEEL, [0.6, topY + 1.5, z]));
    slewParts.push(box(1.3, 0.1, 0.1, STEEL_DARK, [0, topY + 1.5, z]));
    if (i < 4) {
      const seg = counterJib / 5;
      const diag = Math.hypot(1.2, seg);
      const angle = Math.atan2(1.2, seg);
      slewParts.push(box(0.08, diag, 0.08, STEEL_DARK, [0, topY + 1.9, z - seg / 2], [angle, 0, 0]));
    }
  }
  slewParts.push(box(2.6, 1.5, 2.2, '#6f7679', [0, topY + 1.0, -counterJib - 0.8]));
  slewParts.push(box(2.8, 0.3, 2.4, '#5c6266', [0, topY + 1.85, -counterJib - 0.8]));
  // A-frame + pendant ropes over the jib
  slewParts.push(box(0.18, 3.4, 0.18, STEEL, [0, topY + 3.6, 0], [0.25, 0, 0]));
  slewParts.push(box(0.18, 3.4, 0.18, STEEL, [0, topY + 3.6, 0], [-0.25, 0, 0]));
  slewParts.push(box(0.12, 0.12, 3.6, STEEL_DARK, [0, topY + 5.2, -1.7]));

  // Jib: two chords + web members, tapering slightly.
  const jibSegments = Math.max(4, Math.round(jibLength / 2.5));
  const jibSeg = jibLength / jibSegments;
  for (let i = 0; i < jibSegments; i++) {
    const z = 1.0 + i * jibSeg + jibSeg / 2;
    const t = i / jibSegments;
    const width = 1.25 - t * 0.35;
    slewParts.push(box(0.14, 0.14, jibSeg, STEEL, [-width / 2, topY + 1.5, z]));
    slewParts.push(box(0.14, 0.14, jibSeg, STEEL, [width / 2, topY + 1.5, z]));
    slewParts.push(box(0.1, 0.1, jibSeg, STEEL_DARK, [0, topY + 2.1, z]));
    const diag = Math.hypot(width, jibSeg);
    slewParts.push(box(0.07, diag, 0.07, STEEL_DARK, [0, topY + 1.8, z], [0, 0, Math.atan2(jibSeg, width)]));
    slewParts.push(box(0.07, diag, 0.07, STEEL_DARK, [0, topY + 1.8, z], [0, 0, -Math.atan2(jibSeg, width)]));
  }
  // Jib tip + pendant
  slewParts.push(box(0.3, 0.3, 0.6, STEEL_DARK, [0, topY + 1.5, jibLength + 1.0]));
  slewParts.push(box(0.09, 0.09, jibLength * 1.1, STEEL_DARK, [0, topY + 3.4, jibLength / 2 + 1], [0.06, 0, 0]));

  const geometry = mergeGeometries(baseParts);
  const slewGeometry = mergeGeometries(slewParts);

  const root = new THREE.Group();
  const baseMesh = new THREE.Mesh(geometry, kits.get('metal'));
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);

  const slewGroup = new THREE.Group();
  slewGroup.position.y = 0;
  const slewMesh = new THREE.Mesh(slewGeometry, kits.get('metal'));
  slewMesh.castShadow = true;
  slewMesh.receiveShadow = true;
  slewGroup.add(slewMesh);
  root.add(slewGroup);

  // ---------- trolley / hook / ropes ----------
  const trolley = new THREE.Group();
  trolley.position.set(0, topY + 1.36, 1.5);
  const trolleyGeo = mergeGeometries([
    box(1.5, 0.36, 1.1, '#6f7679', [0, 0, 0]),
    box(0.24, 0.24, 0.24, '#4a5054', [-0.62, 0.22, -0.4]),
    box(0.24, 0.24, 0.24, '#4a5054', [0.62, 0.22, -0.4]),
    cyl(0.16, 0.3, '#8f9598', [-0.5, 0.28, 0.35], [0, 0, Math.PI / 2], 8),
    cyl(0.16, 0.3, '#8f9598', [0.5, 0.28, 0.35], [0, 0, Math.PI / 2], 8),
  ]);
  const trolleyMesh = new THREE.Mesh(trolleyGeo, kits.get('metal'));
  trolleyMesh.castShadow = true;
  trolley.add(trolleyMesh);
  slewGroup.add(trolley);

  const hookBlock = new THREE.Group();
  hookBlock.position.set(0, topY - 3, 1.5);
  const hookGeo = mergeGeometries([
    box(0.6, 0.5, 0.6, '#6f7679', [0, 0, 0]),
    box(0.75, 0.18, 0.75, '#4a5054', [0, 0.32, 0]),
    cyl(0.09, 0.5, '#c9ced2', [0, -0.35, 0], [0, 0, 0], 8),
    box(0.5, 0.14, 0.14, '#c9ced2', [0, -0.6, 0]),
    box(0.14, 0.4, 0.14, '#c9ced2', [0.18, -0.78, 0]),
    box(0.14, 0.4, 0.14, '#c9ced2', [-0.18, -0.78, 0]),
  ]);
  const hookMesh = new THREE.Mesh(hookGeo, kits.get('metal'));
  hookMesh.castShadow = true;
  hookBlock.add(hookMesh);
  slewGroup.add(hookBlock);

  const payloadAnchor = new THREE.Group();
  payloadAnchor.position.set(0, -0.9, 0);
  hookBlock.add(payloadAnchor);

  const ropeMaterial = kits.get('metalDark');
  const ropeA = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), ropeMaterial);
  const ropeB = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), ropeMaterial);
  ropeA.castShadow = false;
  ropeB.castShadow = false;
  slewGroup.add(ropeA, ropeB);

  const hookRope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), ropeMaterial);
  hookRope.castShadow = false;
  hookBlock.add(hookRope);

  return {
    root,
    slewGroup,
    trolley,
    hookBlock,
    payloadAnchor,
    ropeA,
    ropeB,
    hookRope,
    mastTop: topY,
    jibLength,
    counterJib,
    baseHeight,
    /** Jib reach used to place loads on the building. */
    tipReach: jibLength,
  };
}

/** Material bundle that hangs under the hook. */
export function createCraneLoad(kind, kits) {
  let geometry;
  const steel = kits.get('metal');
  if (kind === 'rebar') {
    geometry = mergeGeometries([
      cyl(0.06, 4.6, '#8a5a34', [-0.18, 0, 0], [0, 0, Math.PI / 2], 6),
      cyl(0.06, 4.6, '#9c6a3c', [0.18, 0, 0.12], [0, 0, Math.PI / 2], 6),
      cyl(0.06, 4.6, '#8a5a34', [0, 0.18, -0.12], [0, 0, Math.PI / 2], 6),
      box(0.7, 0.14, 0.5, '#3d4a54', [0, 0, 0]),
      box(0.1, 0.5, 0.1, '#6f7679', [0, 0.3, 0]),
      box(0.5, 0.08, 0.08, '#6f7679', [0, 0.55, 0]),
    ]);
  } else if (kind === 'concrete') {
    geometry = mergeGeometries([
      cyl(0.62, 0.9, '#8f9598', [0, 0, 0], [0, 0, 0], 14),
      cyl(0.68, 0.14, '#6f7679', [0, 0.5, 0], [0, 0, 0], 14),
      box(1.0, 0.12, 0.12, '#6f7679', [0, 0.62, 0]),
      box(0.1, 0.3, 0.1, '#6f7679', [-0.46, 0.75, 0]),
      box(0.1, 0.3, 0.1, '#6f7679', [0.46, 0.75, 0]),
      box(0.1, 0.3, 0.1, '#6f7679', [0, 0.62, 0]),
    ]);
  } else if (kind === 'pipes') {
    const pipes = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        pipes.push(cyl(0.24, 4.2, i % 2 ? '#9aa3a8' : '#7f878c', [-0.3 + i * 0.3, j * 0.5, 0], [0, 0, Math.PI / 2], 10));
      }
    }
    pipes.push(box(1.4, 0.1, 1.2, '#6f7679', [0, -0.3, 0]));
    geometry = mergeGeometries(pipes);
  } else {
    geometry = mergeGeometries([
      box(1.6, 0.18, 1.2, '#a97b45', [0, 0, 0]),
      box(1.0, 0.6, 0.8, '#b9b2a4', [0, 0.4, 0]),
      box(0.9, 0.5, 0.7, '#c6bfb0', [0, 0.95, 0]),
    ]);
  }
  const mesh = new THREE.Mesh(geometry, steel);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
