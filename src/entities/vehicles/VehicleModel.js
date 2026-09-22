import THREE from '../../lib/three.js';
import { mergeGeometries, paintGeometry } from '../../lib/merge.js';

/**
 * Procedural vehicle models. Each returns:
 *   { geometry, wheels: [{position, radius, steer}], parts: {name: Object3D} }
 * The chassis geometry is merged into a single vertex-colored mesh, animated
 * sub-parts (drum, boom, bed, forks) stay separate so motion is real, not faked.
 */

function box(w, h, d, color, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (rotation[0] || rotation[1] || rotation[2]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
    geo.applyQuaternion(q);
  }
  geo.translate(position[0], position[1], position[2]);
  return paintGeometry(geo, color);
}

function cyl(r, h, color, position = [0, 0, 0], rotation = [0, 0, 0], segments = 12) {
  const geo = new THREE.CylinderGeometry(r, r, h, segments);
  if (rotation[0] || rotation[1] || rotation[2]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
    geo.applyQuaternion(q);
  }
  geo.translate(position[0], position[1], position[2]);
  return paintGeometry(geo, color);
}

function wheelGeo(radius, width) {
  return new THREE.CylinderGeometry(radius, radius, width, 14).rotateZ(Math.PI / 2);
}

export const VEHICLE_PROFILES = {
  mixer: { label: '混凝土搅拌车', length: 8.6, width: 2.5, cabHeight: 2.9, speed: 5.0, color: '#e4e7e6', accent: '#d94f3d' },
  tipper: { label: '自卸卡车', length: 8.0, width: 2.5, cabHeight: 2.9, speed: 5.6, color: '#4d7f3f', accent: '#2f3b4a' },
  forklift: { label: '叉车', length: 3.8, width: 1.7, cabHeight: 2.3, speed: 2.4, color: '#f0b429', accent: '#2f3b4a' },
  excavator: { label: '挖掘机', length: 7.2, width: 2.7, cabHeight: 3.0, speed: 1.8, color: '#e0a92c', accent: '#3b4452' },
  mobileCrane: { label: '汽车吊', length: 9.4, width: 2.6, cabHeight: 3.0, speed: 3.6, color: '#e8e4dc', accent: '#c0392b' },
  pickup: { label: '皮卡', length: 5.2, width: 2.0, cabHeight: 1.9, speed: 7.2, color: '#3a6d9e', accent: '#dfe4e6' },
};

function buildWheels(positions, radius, width, color) {
  const geometry = wheelGeo(radius, width);
  const wheels = positions.map((position) => {
    const group = new THREE.Group();
    group.position.set(position[0], radius, position[2]);
    const mesh = new THREE.Mesh(geometry, null);
    mesh.castShadow = true;
    group.add(mesh);
    void color;
    return { group, mesh, radius, position, spin: 0, steer: 0 };
  });
  return { geometry, wheels };
}

function baseChassis({ length, width, color, chassisY = 0.95, chassisH = 0.5 }) {
  const parts = [];
  parts.push(box(width, chassisH, length * 0.94, '#3c4247', [0, chassisY, 0]));
  parts.push(box(width * 0.96, 0.3, length * 0.9, color, [0, chassisY + chassisH * 0.7, 0]));
  return parts;
}

export function createVehicleModel(kind, kits) {
  switch (kind) {
    case 'mixer':
      return buildMixer(kits);
    case 'tipper':
      return buildTipper(kits);
    case 'forklift':
      return buildForklift(kits);
    case 'excavator':
      return buildExcavator(kits);
    case 'mobileCrane':
      return buildMobileCrane(kits);
    case 'pickup':
    default:
      return buildPickup(kits);
  }
}

function buildMixer(kits) {
  const profile = VEHICLE_PROFILES.mixer;
  const parts = baseChassis({ length: profile.length, width: profile.width, color: profile.color });
  // Cab
  parts.push(box(2.4, 1.9, 2.5, profile.color, [0, 2.0, 2.9]));
  parts.push(box(2.3, 0.9, 0.12, '#7fa8bd', [0, 2.35, 4.1]));
  parts.push(box(2.42, 0.35, 2.4, profile.accent, [0, 1.35, 2.9]));
  parts.push(box(0.3, 0.2, 0.2, '#ffe9b0', [-0.85, 1.6, 4.15]));
  parts.push(box(0.3, 0.2, 0.2, '#ffe9b0', [0.85, 1.6, 4.15]));
  parts.push(box(2.5, 0.25, 0.3, '#2f3438', [0, 1.0, 4.2]));
  // Chute + hopper
  parts.push(box(1.1, 0.5, 1.3, '#8f9598', [0, 2.9, -3.6]));
  parts.push(box(0.5, 1.1, 0.4, '#7d8488', [0.5, 3.3, -2.6], [0.5, 0, 0]));
  // Drum support frame
  parts.push(box(1.6, 0.5, 5.0, '#4a5054', [0, 2.2, -0.6]));
  parts.push(box(1.2, 0.9, 1.0, '#565c60', [0, 2.1, -3.4]));
  parts.push(box(1.1, 0.75, 1.2, profile.accent, [0, 2.15, 3.0]));
  // Ladder
  parts.push(cyl(0.06, 1.4, '#c9ced2', [-1.2, 1.7, 2.2], [0, 0, 0.25], 6));

  const drum = new THREE.Group();
  drum.position.set(0, 3.15, -0.6);
  const drumGeo = mergeGeometries([
    cyl(0.78, 5.0, '#d8a03c', [0, 0, 0], [Math.PI / 2, 0, 0], 16),
    cyl(0.95, 0.6, '#b8862f', [0, 0, -2.4], [Math.PI / 2, 0, 0], 16),
    cyl(0.6, 0.7, '#c9932f', [0, 0, 2.6], [Math.PI / 2, 0, 0], 16),
  ]);
  const drumMesh = new THREE.Mesh(drumGeo, kits.get('metal'));
  drumMesh.castShadow = true;
  drum.add(drumMesh);
  // Spiral blade ribs read as the classic mixer drum.
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2;
    const geo = box(0.12, 0.75, 0.5, '#e8b64c', [Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, -2 + i * 0.3], [0, 0, angle]);
    drumMesh.geometry = mergeGeometries([drumMesh.geometry, geo]);
  }

  const { geometry, wheels } = buildWheels(
    [
      [-1.15, 0, 2.9], [1.15, 0, 2.9],
      [-1.15, 0, -0.9], [1.15, 0, -0.9],
      [-1.15, 0, -2.3], [1.15, 0, -2.3],
    ],
    0.62,
    0.42,
  );
  return {
    profile,
    geometry: mergeGeometries(parts),
    wheels,
    wheelGeometry: geometry,
    parts: { drum },
    lights: { head: [0.85, 1.55, 4.25], tail: [0.9, 1.5, -3.9], beacon: [0, 3.0, 3.1] },
  };
}

function buildTipper(kits) {
  const profile = VEHICLE_PROFILES.tipper;
  const parts = baseChassis({ length: profile.length, width: profile.width, color: profile.color });
  parts.push(box(2.4, 1.9, 2.4, profile.color, [0, 2.0, 2.8]));
  parts.push(box(2.3, 0.9, 0.12, '#7fa8bd', [0, 2.35, 3.95]));
  parts.push(box(2.42, 0.4, 2.3, profile.accent, [0, 1.3, 2.8]));
  parts.push(box(0.3, 0.2, 0.2, '#ffe9b0', [-0.85, 1.55, 4.0]));
  parts.push(box(0.3, 0.2, 0.2, '#ffe9b0', [0.85, 1.55, 4.0]));
  parts.push(box(2.5, 0.28, 0.3, '#3a4045', [0, 0.95, 4.1]));
  parts.push(box(0.9, 1.3, 0.25, '#8f9598', [0, 2.4, 1.5]));
  // Hydraulic ram base
  parts.push(box(0.4, 1.0, 0.4, '#6f7679', [0, 1.8, 0.6]));

  const bed = new THREE.Group();
  bed.position.set(0, 1.7, -1.4);
  const bedGeo = mergeGeometries([
    box(2.45, 0.22, 5.4, '#6b7a63', [0, 0, 0]),
    box(0.14, 1.15, 5.4, '#7a8a70', [-1.18, 0.6, 0]),
    box(0.14, 1.15, 5.4, '#7a8a70', [1.18, 0.6, 0]),
    box(2.45, 1.2, 0.16, '#7a8a70', [0, 0.6, -2.7]),
    box(2.45, 1.45, 0.16, '#6f7f66', [0, 0.72, 2.7]),
    box(2.1, 0.2, 4.6, '#5c5a52', [0, 0.5, -0.2]),
  ]);
  const bedMesh = new THREE.Mesh(bedGeo, kits.get('metalDark'));
  bedMesh.castShadow = true;
  bedMesh.receiveShadow = true;
  bed.add(bedMesh);

  const { geometry, wheels } = buildWheels(
    [
      [-1.2, 0, 2.9], [1.2, 0, 2.9],
      [-1.2, 0, -1.4], [1.2, 0, -1.4],
      [-1.2, 0, -2.7], [1.2, 0, -2.7],
    ],
    0.62,
    0.44,
  );
  return {
    profile,
    geometry: mergeGeometries(parts),
    wheels,
    wheelGeometry: geometry,
    parts: { bed },
    lights: { head: [0.85, 1.5, 4.05], tail: [0.9, 1.4, -4.2], beacon: [0, 2.95, 2.9] },
  };
}

function buildForklift(kits) {
  const profile = VEHICLE_PROFILES.forklift;
  const parts = [];
  parts.push(box(1.5, 0.6, 3.0, '#3c4247', [0, 0.62, 0]));
  parts.push(box(1.45, 0.85, 1.5, profile.color, [0, 1.3, -0.4]));
  parts.push(box(1.1, 1.1, 1.2, '#2f3b4a', [0, 2.15, -0.3]));
  parts.push(box(1.2, 0.9, 0.1, '#7fa8bd', [0, 2.3, 0.28]));
  parts.push(box(0.35, 0.4, 0.35, '#2f3438', [0, 1.15, -1.6]));
  parts.push(box(0.25, 2.6, 0.25, '#4a5054', [-0.55, 2.3, 1.35]));
  parts.push(box(0.25, 2.6, 0.25, '#4a5054', [0.55, 2.3, 1.35]));
  parts.push(box(1.3, 0.2, 0.3, '#4a5054', [0, 3.6, 1.35]));
  parts.push(box(1.3, 0.2, 0.3, '#4a5054', [0, 2.2, 1.35]));
  parts.push(box(0.2, 0.2, 0.2, '#ffe9b0', [-0.5, 1.1, 1.5]));
  parts.push(box(0.2, 0.2, 0.2, '#ffe9b0', [0.5, 1.1, 1.5]));
  parts.push(box(0.3, 0.5, 0.3, '#d94f3d', [0, 3.8, 0.2]));

  const carriage = new THREE.Group();
  carriage.position.set(0, 1.35, 1.6);
  const carriageGeo = mergeGeometries([
    box(1.1, 1.0, 0.12, '#8f9598', [0, 0, 0]),
    box(0.14, 0.14, 1.3, '#6f7679', [-0.42, -0.5, 0.6]),
    box(0.14, 0.14, 1.3, '#6f7679', [0.42, -0.5, 0.6]),
    box(1.0, 0.1, 0.1, '#6f7679', [0, -0.42, 1.2]),
    box(1.0, 0.1, 0.1, '#6f7679', [0, -0.35, 0.8]),
  ]);
  const carriageMesh = new THREE.Mesh(carriageGeo, kits.get('metal'));
  carriageMesh.castShadow = true;
  carriage.add(carriageMesh);

  const { geometry, wheels } = buildWheels(
    [
      [-0.7, 0, 0.85], [0.7, 0, 0.85],
      [-0.7, 0, -0.85], [0.7, 0, -0.85],
    ],
    0.42,
    0.3,
  );
  return {
    profile,
    geometry: mergeGeometries(parts),
    wheels,
    wheelGeometry: geometry,
    parts: { carriage },
    lights: { head: [0.5, 1.0, 1.6], tail: [0.5, 1.0, -1.7], beacon: [0, 4.0, 0.2] },
  };
}

function buildExcavator(kits) {
  const profile = VEHICLE_PROFILES.excavator;
  const parts = [];
  // Tracks
  parts.push(box(0.9, 0.85, 4.4, '#2f3438', [-1.15, 0.45, 0]));
  parts.push(box(0.9, 0.85, 4.4, '#2f3438', [1.15, 0.45, 0]));
  parts.push(box(1.0, 0.25, 3.6, '#6f7679', [-1.15, 0.9, 0]));
  parts.push(box(1.0, 0.25, 3.6, '#6f7679', [1.15, 0.9, 0]));
  // Slew base
  parts.push(box(2.5, 0.4, 3.2, '#8f9598', [0, 1.25, -0.2]));

  const house = new THREE.Group();
  house.position.set(0, 1.45, -0.2);
  const houseGeo = mergeGeometries([
    box(2.4, 1.2, 3.2, profile.color, [0, 0.6, 0]),
    box(1.1, 1.0, 1.1, '#2f3b4a', [0.66, 1.7, -0.5]),
    box(1.0, 0.85, 0.1, '#7fa8bd', [0.66, 1.75, 0.05]),
    box(0.5, 0.5, 2.0, '#3c4247', [-0.8, 0.4, -0.4]),
    box(0.7, 1.1, 0.7, '#4a5054', [-0.75, 1.6, 0.9]),
    box(0.3, 0.3, 0.3, '#d94f3d', [0.9, 2.4, -0.9]),
  ]);
  const houseMesh = new THREE.Mesh(houseGeo, kits.get('metal'));
  houseMesh.castShadow = true;
  house.add(houseMesh);

  const boom = new THREE.Group();
  boom.position.set(-0.2, 1.1, 0.9);
  const boomGeo = mergeGeometries([
    box(0.6, 0.7, 4.2, profile.color, [0, 0.2, 2.0]),
    box(0.5, 0.5, 0.6, '#4a5054', [0, 0.1, 0.1]),
    cyl(0.22, 2.0, '#8f9598', [0, -0.3, 1.0], [Math.PI / 2.6, 0, 0], 10),
  ]);
  const boomMesh = new THREE.Mesh(boomGeo, kits.get('metal'));
  boomMesh.castShadow = true;
  boom.add(boomMesh);

  const arm = new THREE.Group();
  arm.position.set(0, 0.2, 4.1);
  const armGeo = mergeGeometries([
    box(0.45, 0.55, 2.6, profile.color, [0, -0.2, 1.1]),
    box(0.4, 0.4, 0.5, '#4a5054', [0, 0, 0]),
  ]);
  const armMesh = new THREE.Mesh(armGeo, kits.get('metal'));
  armMesh.castShadow = true;
  arm.add(armMesh);

  const bucket = new THREE.Group();
  bucket.position.set(0, -0.5, 2.4);
  const bucketGeo = mergeGeometries([
    box(1.0, 0.9, 0.9, '#8a8f93', [0, -0.1, 0.1]),
    box(0.95, 0.2, 0.7, '#6f7679', [0, -0.5, 0.35]),
    box(0.1, 0.4, 0.5, '#c9ced2', [-0.35, -0.5, 0.5]),
    box(0.1, 0.4, 0.5, '#c9ced2', [0, -0.5, 0.5]),
    box(0.1, 0.4, 0.5, '#c9ced2', [0.35, -0.5, 0.5]),
  ]);
  const bucketMesh = new THREE.Mesh(bucketGeo, kits.get('metal'));
  bucketMesh.castShadow = true;
  bucket.add(bucketMesh);
  arm.add(bucket);
  boom.add(arm);
  house.add(boom);

  const { geometry, wheels } = buildWheels([], 0.4, 0.3);
  return {
    profile,
    geometry: mergeGeometries(parts),
    wheels,
    wheelGeometry: geometry,
    parts: { house, boom, arm, bucket },
    lights: { head: [0.6, 1.9, 1.2], tail: [0.7, 1.9, -1.7], beacon: [0.9, 2.6, -0.9] },
  };
}

function buildMobileCrane(kits) {
  const profile = VEHICLE_PROFILES.mobileCrane;
  const parts = baseChassis({ length: profile.length, width: profile.width, color: profile.color, chassisY: 1.15, chassisH: 0.6 });
  parts.push(box(2.5, 1.9, 2.6, profile.color, [0, 2.2, 3.1]));
  parts.push(box(2.4, 0.95, 0.12, '#7fa8bd', [0, 2.6, 4.35]));
  parts.push(box(2.52, 0.45, 2.5, profile.accent, [0, 1.5, 3.1]));
  parts.push(box(0.3, 0.22, 0.2, '#ffe9b0', [-0.9, 1.7, 4.4]));
  parts.push(box(0.3, 0.22, 0.2, '#ffe9b0', [0.9, 1.7, 4.4]));
  parts.push(box(2.6, 0.3, 0.32, '#3a4045', [0, 1.0, 4.5]));
  // Outriggers
  for (const [x, z] of [[-1.5, 2.0], [1.5, 2.0], [-1.5, -2.6], [1.5, -2.6]]) {
    parts.push(box(1.2, 0.3, 0.35, '#6f7679', [x, 1.1, z]));
    parts.push(box(0.35, 0.5, 0.35, '#4a5054', [x + (x > 0 ? 0.45 : -0.45), 0.6, z]));
  }
  // Turntable + operator cab + ballast
  parts.push(cyl(1.2, 0.5, '#8f9598', [0, 1.75, -1.0], [0, 0, 0], 14));
  parts.push(box(1.8, 1.5, 1.6, '#dfe4e6', [1.1, 2.85, -0.8]));
  parts.push(box(1.7, 0.8, 0.1, '#7fa8bd', [1.1, 3.0, 0.0]));
  parts.push(box(2.0, 1.0, 1.4, '#8a8f93', [0, 2.6, -2.9]));

  const boom = new THREE.Group();
  boom.position.set(0, 2.9, -0.4);
  const segments = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    segments.push(box(0.7 - t * 0.25, 0.7 - t * 0.25, 1.4, i % 2 ? '#e8e4dc' : '#c0392b', [0, 0, i * 1.35]));
    segments.push(box(0.1, 0.75 - t * 0.25, 0.1, '#8a8f93', [0.36 - t * 0.12, -0.35, i * 1.35]));
    segments.push(box(0.1, 0.75 - t * 0.25, 0.1, '#8a8f93', [-0.36 + t * 0.12, -0.35, i * 1.35]));
  }
  const boomMesh = new THREE.Mesh(mergeGeometries(segments), kits.get('metal'));
  boomMesh.castShadow = true;
  boom.add(boomMesh);

  const hook = new THREE.Group();
  hook.position.set(0, -0.4, 7.4);
  const hookGeo = mergeGeometries([
    cyl(0.03, 2.2, '#c9ced2', [0, -1.1, 0], [0, 0, 0], 6),
    box(0.4, 0.5, 0.4, '#6f7679', [0, -2.4, 0]),
    box(0.5, 0.15, 0.5, '#d94f3d', [0, -2.7, 0]),
  ]);
  const hookMesh = new THREE.Mesh(hookGeo, kits.get('metal'));
  hookMesh.castShadow = true;
  hook.add(hookMesh);
  boom.add(hook);

  const { geometry, wheels } = buildWheels(
    [
      [-1.3, 0, 3.2], [1.3, 0, 3.2],
      [-1.3, 0, -1.6], [1.3, 0, -1.6],
      [-1.3, 0, -3.0], [1.3, 0, -3.0],
    ],
    0.68,
    0.46,
  );
  return {
    profile,
    geometry: mergeGeometries(parts),
    wheels,
    wheelGeometry: geometry,
    parts: { boom, hook },
    lights: { head: [0.9, 1.7, 4.5], tail: [0.95, 1.6, -4.4], beacon: [1.1, 3.7, -0.8] },
  };
}

function buildPickup(kits) {
  const profile = VEHICLE_PROFILES.pickup;
  const parts = [];
  parts.push(box(1.9, 0.5, 4.9, '#3c4247', [0, 0.72, 0]));
  parts.push(box(1.94, 0.85, 2.2, profile.color, [0, 1.4, 0.6]));
  parts.push(box(1.86, 0.85, 1.2, profile.color, [0, 1.45, -1.6]));
  parts.push(box(1.8, 0.6, 0.1, '#7fa8bd', [0, 1.65, 1.7]));
  parts.push(box(1.8, 0.55, 0.1, '#7fa8bd', [0, 1.62, -0.45]));
  parts.push(box(1.9, 0.5, 1.9, '#2f3b4a', [0, 1.28, -1.75]));
  parts.push(box(1.5, 0.12, 1.8, '#4a5054', [0, 1.5, -1.75]));
  parts.push(box(1.96, 0.3, 0.3, '#8a8f93', [0, 0.8, 2.3]));
  parts.push(box(1.96, 0.3, 0.3, '#8a8f93', [0, 0.8, -2.4]));
  parts.push(box(0.35, 0.22, 0.2, '#ffe9b0', [-0.65, 1.2, 2.35]));
  parts.push(box(0.35, 0.22, 0.2, '#ffe9b0', [0.65, 1.2, 2.35]));
  parts.push(box(0.3, 0.25, 0.2, '#c0392b', [-0.7, 1.15, -2.45]));
  parts.push(box(0.3, 0.25, 0.2, '#c0392b', [0.7, 1.15, -2.45]));
  parts.push(box(0.4, 0.35, 0.4, '#e0a92c', [0, 1.95, -0.6]));

  const { geometry, wheels } = buildWheels(
    [
      [-0.95, 0, 1.6], [0.95, 0, 1.6],
      [-0.95, 0, -1.7], [0.95, 0, -1.7],
    ],
    0.42,
    0.32,
  );
  return {
    profile,
    geometry: mergeGeometries(parts),
    wheels,
    wheelGeometry: geometry,
    parts: {},
    lights: { head: [0.65, 1.2, 2.45], tail: [0.7, 1.15, -2.5], beacon: [0, 2.05, -0.6] },
  };
}

/** Small attachment used as crane/vehicle payloads. */
export function createPayloadModel(kind, kits) {
  const group = new THREE.Group();
  let geometry;
  if (kind === 'rebar') {
    geometry = mergeGeometries([
      cyl(0.05, 4.0, '#8a5a34', [-0.16, 0, 0], [0, 0, Math.PI / 2], 6),
      cyl(0.05, 4.0, '#9c6a3c', [0.16, 0, 0.1], [0, 0, Math.PI / 2], 6),
      cyl(0.05, 4.0, '#8a5a34', [0, 0.16, -0.1], [0, 0, Math.PI / 2], 6),
      box(0.6, 0.1, 0.4, '#3d4a54', [0, 0, 0]),
      box(0.06, 0.1, 0.06, '#6f7679', [0, 0.3, 0]),
    ]);
  } else if (kind === 'bucket') {
    geometry = mergeGeometries([
      cyl(0.55, 0.8, '#8f9598', [0, 0, 0], [0, 0, 0], 14),
      cyl(0.6, 0.12, '#6f7679', [0, 0.45, 0], [0, 0, 0], 14),
      box(0.9, 0.12, 0.12, '#6f7679', [0, 0.55, 0]),
      box(0.12, 0.1, 0.12, '#6f7679', [-0.42, 0.5, 0]),
      box(0.12, 0.1, 0.12, '#6f7679', [0.42, 0.5, 0]),
    ]);
  } else if (kind === 'pallet') {
    geometry = mergeGeometries([
      box(1.4, 0.16, 1.0, '#a97b45', [0, 0, 0]),
      box(0.9, 0.5, 0.7, '#b9b2a4', [0, 0.33, 0]),
      box(0.85, 0.4, 0.65, '#c6bfb0', [0, 0.75, 0]),
    ]);
  } else {
    geometry = mergeGeometries([
      cyl(0.45, 1.6, '#8a8f93', [0, 0, 0], [0, 0, Math.PI / 2], 10),
      box(0.4, 0.3, 0.4, '#6f7679', [0, 0.25, 0]),
    ]);
  }
  const mesh = new THREE.Mesh(geometry, kits.get(kind === 'rebar' ? 'metal' : 'metalDark'));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
