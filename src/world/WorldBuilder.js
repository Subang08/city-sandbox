import THREE from '../lib/three.js';
import { GeometryBatch, InstanceBatch } from '../lib/materials.js';
import { PropGeometries } from './Props.js';
import { Rng } from '../lib/rng.js';
import { TAU, lerp } from '../lib/mathx.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * WorldBuilder - converts scene.json into static geometry and instanced prop
 * batches. Everything static lives in a handful of draw calls; every prop family
 * becomes exactly one InstancedMesh.
 */
export class WorldBuilder {
  constructor({ scene, kits, config, bus, rng }) {
    this.scene = scene;
    this.kits = kits;
    this.config = config;
    this.bus = bus;
    this.rng = rng || new Rng(config.seed || 'world');
    this.batches = [];
    this.groups = {};
    this.stats = { instances: 0, staticTriangles: 0, meshes: 0 };
  }

  _batch(materialKey, name) {
    return new GeometryBatch(this.kits.get(materialKey), { name });
  }

  _instance(geometry, materialKey, name, castShadow = true, receiveShadow = true) {
    const batch = new InstanceBatch(geometry, this.kits.get(materialKey), { name, castShadow, receiveShadow });
    this.batches.push(batch);
    return batch;
  }

  build() {
    this.group = new THREE.Group();
    this.group.name = 'static-world';
    this.scene.add(this.group);
    this._buildDesk();
    this._buildBlueprint();
    this._buildSite();
    this._buildRoads();
    this._buildFence();
    this._buildParking();
    this._buildStockpiles();
    this._buildProps();
    this._buildVegetation();
    this._buildDeskProps();
    this._flush();
    return this.group;
  }

  _flush() {
    for (const batch of this.batches) {
      const mesh = batch.build();
      if (!mesh.count) continue;
      this.group.add(mesh);
      const geometry = mesh.geometry;
      const triangles = ((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3) * mesh.count;
      this.stats.staticTriangles += triangles;
      this.stats.meshes++;
      this.stats.instances += mesh.count;
    }
  }

  /** Wooden studio desk + blueprint mat: the miniature sits on a real table. */
  _buildDesk() {
    const table = this.config.world.table;
    const desk = this._batch('wood', 'desk');
    const halfW = table.width / 2;
    const halfD = table.depth / 2;
    const topY = -0.85;
    desk.box([table.width, table.thickness, table.depth], { position: [0, topY - table.thickness / 2, 0], color: '#6d4c30' });
    desk.box([table.width - 1.4, 0.1, table.depth - 1.4], { position: [0, topY - 0.04, 0], color: '#7c5738' });
    desk.box([table.width, 0.22, 0.5], { position: [0, topY - 0.16, halfD - 0.25], color: '#5b3f28' });
    desk.box([table.width, 0.22, 0.5], { position: [0, topY - 0.16, -halfD + 0.25], color: '#5b3f28' });
    desk.box([0.5, 0.22, table.depth], { position: [halfW - 0.25, topY - 0.16, 0], color: '#5b3f28' });
    desk.box([0.5, 0.22, table.depth], { position: [-halfW + 0.25, topY - 0.16, 0], color: '#5b3f28' });
    // Grain strips keep the surface from reading as flat paint.
    const rng = this.rng.fork('desk-grain');
    for (let i = 0; i < 26; i++) {
      const z = -halfD + 4 + rng.range(0, table.depth - 8);
      desk.box([table.width - 3, 0.014, rng.range(0.35, 1.4)], {
        position: [0, topY + 0.02, z],
        color: rng.chance(0.5) ? '#734f32' : '#654529',
      });
    }
    this.group.add(desk.build());
  }

  /** Blueprint sheet under the site: grid + annotation marks. */
  _buildBlueprint() {
    const blueprint = this.config.world.blueprint;
    const batch = this._batch('plastic', 'blueprint');
    const halfW = blueprint.width / 2;
    const halfD = blueprint.depth / 2;
    batch.box([blueprint.width, 0.22, blueprint.depth], { position: [0, -0.85 + 0.11, 0], color: '#22496b' });
    batch.box([blueprint.width - 0.6, 0.1, blueprint.depth - 0.6], { position: [0, -0.68, 0], color: '#2a5578' });
    // Cyanotype grid drawn just above the sheet.
    for (let x = -halfW + 4; x <= halfW - 4; x += 4) {
      batch.box([0.06, 0.02, blueprint.depth - 3], { position: [x, -0.6, 0], color: '#4f86ad' });
    }
    for (let z = -halfD + 4; z <= halfD - 4; z += 4) {
      batch.box([blueprint.width - 3, 0.02, 0.06], { position: [0, -0.6, z], color: '#4f86ad' });
    }
    batch.box([blueprint.width - 1.2, 0.03, 0.2], { position: [0, -0.59, halfD - 0.9], color: '#8fc4e0' });
    batch.box([blueprint.width - 1.2, 0.03, 0.2], { position: [0, -0.59, -halfD + 0.9], color: '#8fc4e0' });
    batch.box([0.2, 0.03, blueprint.depth - 1.8], { position: [halfW - 0.9, -0.59, 0], color: '#8fc4e0' });
    batch.box([0.2, 0.03, blueprint.depth - 1.8], { position: [-halfW + 0.9, -0.59, 0], color: '#8fc4e0' });
    // Title block / drawing annotation area.
    batch.box([16, 0.04, 6], { position: [halfW - 10, -0.58, halfD - 5], color: '#1b3d55' });
    for (let i = 0; i < 5; i++) {
      batch.box([14, 0.02, 0.16], { position: [halfW - 10, -0.55, halfD - 7.4 + i * 1.0], color: '#9ecfe6' });
    }
    this.group.add(batch.build());
  }

  /** Site platform: soil slab, excavation pit, sand/gravel stockpiles. */
  _buildSite() {
    const slab = this.config.site.slab;
    const width = slab.maxX - slab.minX;
    const depth = slab.maxZ - slab.minZ;
    const site = this._batch('site', 'site-slab');
    site.box([width, 0.9, depth], { position: [0, 0.45, 0], color: '#b3a68d' });
    site.box([width - 0.7, 0.24, depth - 0.7], { position: [0, 0.9, 0], color: '#cdc4b2' });
    const rng = this.rng.fork('site');
    for (let i = 0; i < 90; i++) {
      const x = rng.range(slab.minX + 2, slab.maxX - 2);
      const z = rng.range(slab.minZ + 2, slab.maxZ - 2);
      site.box([rng.range(1.2, 3.4), 0.03, rng.range(1.2, 3.4)], {
        position: [x, 1.03, z],
        color: rng.chance(0.4) ? '#c6bda9' : '#bdb39e',
      });
    }
    // Concrete apron around the tower footprint.
    site.box([46, 0.12, 34], { position: [0, 1.02, -2], color: '#c9c4b8' });
    site.box([44, 0.06, 32], { position: [0, 1.1, -2], color: '#d2cdc1' });
    // Hardstand strips for cranes and laydown
    site.box([16, 0.1, 10], { position: [-16.5, 1.06, -14.5], color: '#c2bcae' });
    site.box([14, 0.1, 12], { position: [19.5, 1.06, 12.5], color: '#c2bcae' });
    this.group.add(site.build());

    const pit = this.config.site.excavation;
    const dig = this._batch('dirt', 'excavation');
    const halfW = pit.size[0] / 2;
    const halfD = pit.size[1] / 2;
    const cx = pit.center[0];
    const cz = pit.center[1];
    dig.box([pit.size[0], 0.9, pit.size[1]], { position: [cx, -0.35, cz], color: '#4b3f30' });
    const wall = 0.6;
    dig.box([pit.size[0] + 1.2, pit.depth, wall], { position: [cx, 0.2, cz + halfD + wall / 2], color: '#5c4c39' });
    dig.box([pit.size[0] + 1.2, pit.depth, wall], { position: [cx, 0.2, cz - halfD - wall / 2], color: '#5c4c39' });
    dig.box([wall, pit.depth, pit.size[1] + 1.2], { position: [cx + halfW + wall / 2, 0.2, cz], color: '#5c4c39' });
    dig.box([wall, pit.depth, pit.size[1] + 1.2], { position: [cx - halfW - wall / 2, 0.2, cz], color: '#5c4c39' });
    for (let i = 0; i < 26; i++) {
      const x = cx + rng.range(-halfW + 1, halfW - 1);
      const z = cz + rng.range(-halfD + 1, halfD - 1);
      dig.box([rng.range(0.8, 2.6), 0.12, rng.range(0.8, 2.6)], { position: [x, -0.72, z], color: '#3f3428' });
    }
    this.group.add(dig.build());
  }

  _roadCurve(spec) {
    const points = spec.points.map((p) => new THREE.Vector3(p[0], 0, p[1]));
    return new THREE.CatmullRomCurve3(points, Boolean(spec.closed), 'catmullrom', 0.4);
  }

  /** Ring road + gate approach: ribbon surface, kerbs, dashed centre line. */
  _buildRoads() {
    this.roadCurves = {};
    const roadBatch = this._batch('asphalt', 'roads');
    const kerbBatch = this._batch('concrete', 'kerbs');
    const paintBatch = this._batch('paint', 'road-paint');
    const rng = this.rng.fork('roads');

    for (const spec of this.config.roads) {
      const curve = this._roadCurve(spec);
      curve.arcLengthDivisions = 600;
      this.roadCurves[spec.id] = { curve, spec };

      const divisions = Math.max(40, Math.round(curve.getLength() / 2.2));
      const width = spec.width;
      const up = UP;
      for (let i = 0; i < divisions; i++) {
        const t = i / divisions;
        const t2 = (i + 1) / divisions;
        if (!spec.closed && t2 > 1) break;
        const p1 = curve.getPointAt(Math.min(t, 0.999));
        const p2 = curve.getPointAt(Math.min(t2, 1));
        const tangent = new THREE.Vector3().subVectors(p2, p1);
        const length = tangent.length();
        if (length < 1e-4) continue;
        const angle = Math.atan2(tangent.x, tangent.z);
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const segmentLength = length * 1.06;
        roadBatch.box([width, 0.12, segmentLength], { position: [mid.x, 0.98, mid.z], rotation: [0, angle, 0], color: rng.chance(0.5) ? '#3b3f45' : '#3f444a' });
        kerbBatch.box([width + 0.9, 0.26, segmentLength], { position: [mid.x, 0.9, mid.z], rotation: [0, angle, 0], color: '#b3aea2' });
        // Dashed centre line
        if (i % 2 === 0) {
          paintBatch.box([0.16, 0.03, segmentLength * 0.55], { position: [mid.x, 1.05, mid.z], rotation: [0, angle, 0], color: '#e8e2cf' });
        }
        // Sidewalk kerb markings
        if (i % 3 === 0) {
          const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)).multiplyScalar(width / 2 + 0.62);
          kerbBatch.box([0.5, 0.1, segmentLength], {
            position: [mid.x + right.x, 1.02, mid.z + right.z],
            rotation: [0, angle, 0],
            color: '#c9c4b8',
          });
          kerbBatch.box([0.5, 0.1, segmentLength], {
            position: [mid.x - right.x, 1.02, mid.z - right.z],
            rotation: [0, angle, 0],
            color: '#c9c4b8',
          });
        }
      }
    }
    this.group.add(roadBatch.build(), kerbBatch.build(), paintBatch.build());
  }

  /** Perimeter hoarding with gates, warning stripes and site signage. */
  _buildFence() {
    const fence = this.config.enclosure.fence;
    const { minX, maxX, minZ, maxZ } = fence.rect;
    const batch = this._batch('metal', 'fence');
    const panelBatch = this._batch('plastic', 'fence-panels');
    const colors = fence.colors;
    const height = fence.height;
    const panel = fence.panel;
    const gate = fence.gate;
    const rng = this.rng.fork('fence');
    const gateHalf = gate.width / 2;

    const addPanel = (x, z, rotationY, colorIndex) => {
      panelBatch.box([panel * 0.94, height * 0.82, 0.08], {
        position: [x, height * 0.55, z],
        rotation: [0, rotationY, 0],
        color: colors[colorIndex % colors.length],
      });
      batch.box([0.1, height, 0.1], { position: [x, height / 2, z], color: '#9aa1a6' });
    };

    let index = 0;
    const gapHalf = gateHalf;
    const onGateWall = (z) => Math.abs(z - gate.center[1]) < 4;
    for (let x = minX; x < maxX; x += panel) {
      addPanel(x + panel / 2, minZ, 0, index++);
      if (!onGateWall(minZ) || Math.abs(x + panel / 2) > gapHalf) addPanel(x + panel / 2, maxZ, 0, index++);
    }
    for (let z = minZ; z < maxZ; z += panel) {
      addPanel(minX, z + panel / 2, Math.PI / 2, index++);
      addPanel(maxX, z + panel / 2, Math.PI / 2, index++);
    }

    // Top rail + warning stripes near the gate
    batch.box([maxX - minX, 0.12, 0.16], { position: [0, height + 0.05, minZ], color: '#aeb4b8' });
    batch.box([maxX - minX, 0.12, 0.16], { position: [0, height + 0.05, maxZ], color: '#aeb4b8' });
    batch.box([0.16, 0.12, maxZ - minZ], { position: [minX, height + 0.05, 0], color: '#aeb4b8' });
    batch.box([0.16, 0.12, maxZ - minZ], { position: [maxX, height + 0.05, 0], color: '#aeb4b8' });

    // Gate leaves (open) + guard post + site board
    const gateZ = gate.center[1];
    for (const side of [-1, 1]) {
      panelBatch.box([gateHalf * 0.9, height, 0.1], {
        position: [side * (gateHalf + gateHalf * 0.45), height / 2, gateZ],
        rotation: [0, side * 0.5, 0],
        color: '#c9ccd0',
      });
    }
    batch.box([0.6, 2.9, 0.6], { position: [gateHalf + 1.2, 1.45, gateZ + 0.4], color: '#e8e3d8' });
    batch.box([0.66, 0.18, 0.66], { position: [gateHalf + 1.2, 2.95, gateZ + 0.4], color: '#d8402f' });
    batch.box([0.66, 0.18, 0.66], { position: [gateHalf + 1.2, 0.55, gateZ + 0.4], color: '#d8402f' });

    // Site information boards along the hoarding
    for (const [x, z, ry] of [[-14, maxZ - 0.06, 0], [16, maxZ - 0.06, 0], [maxX - 0.06, -6, Math.PI / 2]]) {
      batch.box([3.6, 2.0, 0.1], { position: [x, 3.4, z], rotation: [0, ry, 0], color: '#2f6f8f' });
      batch.box([3.2, 0.5, 0.12], { position: [x, 3.95, z + (ry ? 0 : 0.02)], rotation: [0, ry, 0], color: '#eef3f5' });
      batch.box([2.4, 0.3, 0.12], { position: [x - 0.3, 3.3, z + (ry ? 0 : 0.02)], rotation: [0, ry, 0], color: '#d8e6ec' });
      batch.box([1.6, 0.3, 0.12], { position: [x - 0.6, 2.95, z + (ry ? 0 : 0.02)], rotation: [0, ry, 0], color: '#d8e6ec' });
    }
    this.group.add(batch.build(), panelBatch.build());
  }

  _buildParking() {
    const parking = this.config.parking;
    const batch = this._batch('concrete', 'parking');
    const paint = this._batch('paint', 'parking-lines');
    const [cx, cz] = parking.lot.center;
    const [w, d] = parking.lot.size;
    batch.box([w + 1.2, 0.16, d + 1.2], { position: [cx, 0.96, cz], color: '#8f8b83' });
    batch.box([w, 0.1, d], { position: [cx, 1.04, cz], color: '#7f7c76' });
    const stallWidth = w / parking.stalls;
    for (let i = 0; i <= parking.stalls; i++) {
      paint.box([0.14, 0.03, d * 0.72], { position: [cx - w / 2 + i * stallWidth, 1.11, cz], color: '#ded8c8' });
    }
    paint.box([w, 0.03, 0.14], { position: [cx, 1.11, cz - d * 0.36], color: '#ded8c8' });
    this.group.add(batch.build(), paint.build());

    const carBatch = this._instance(PropGeometries.car(), 'paint', 'cars', true, true);
    const rng = this.rng.fork('cars');
    const colors = ['#2f5d8c', '#8c3b3b', '#d8d3c6', '#3f6b4a', '#6b6f78'];
    for (let i = 0; i < parking.cars; i++) {
      carBatch.add({
        position: [cx - w / 2 + stallWidth * (i + 0.5), 1.1, cz + rng.range(-0.4, 0.4)],
        rotation: [0, rng.chance(0.5) ? 0.02 : -0.02, 0],
        color: colors[i % colors.length],
      });
    }
  }

  _buildStockpiles() {
    const batch = this._batch('sand', 'stockpiles');
    const rng = this.rng.fork('stock');
    for (const pile of this.config.site.stockpiles) {
      const [sx, sy, sz] = pile.size;
      const layers = 5;
      for (let layer = 0; layer < layers; layer++) {
        const t = layer / layers;
        batch.box([sx * (1 - t * 0.72), sy / layers + 0.02, sz * (1 - t * 0.72)], {
          position: [
            pile.position[0] + rng.range(-0.12, 0.12),
            layer * (sy / layers),
            pile.position[1] + rng.range(-0.12, 0.12),
          ],
          rotation: [0, pile.rotation + rng.range(-0.06, 0.06), 0],
          color: pile.type === 'sand' ? lerp(0, 1, t) > 0.5 ? '#c2ab7c' : '#b79f70' : '#8d8b86',
        });
      }
    }
    this.group.add(batch.build());
  }

  /** All the small stuff that makes a site feel inhabited. */
  _buildProps() {
    const props = this.config.props;
    const rng = this.rng.fork('props');
    const layout = this.layout || {};
    const addMany = (geometry, material, name, placements = [], castShadow = true) => {
      const batch = this._instance(geometry, material, name, castShadow, true);
      for (const placement of placements) batch.add(placement);
      return batch;
    };

    // Traffic cones line the gate, crane bases and walkways.
    const conePlaces = [];
    for (let i = 0; i < props.cones; i++) {
      const t = i / props.cones;
      if (i < 8) {
        conePlaces.push({ position: [-6 + i * 1.7, 1.06, 19 - (i % 2) * 0.6], rotation: [0, rng.range(0, TAU), 0], color: i % 3 ? '#ff6a1f' : '#ffd166' });
      } else if (i < 14) {
        const angle = t * TAU;
        conePlaces.push({ position: [-16.5 + Math.cos(angle) * 3.4, 1.14, -14.5 + Math.sin(angle) * 3.4], rotation: [0, rng.range(0, TAU), 0], color: '#ff6a1f' });
      } else {
        conePlaces.push({ position: [rng.range(-34, 34), 1.06, rng.range(-24, 24)], rotation: [0, rng.range(0, TAU), 0], color: rng.chance(0.25) ? '#ffd166' : '#ff6a1f' });
      }
    }
    addMany(PropGeometries.cone(), 'plastic', 'cones', conePlaces);

    const barrierPlaces = [];
    for (let i = 0; i < props.barriers; i++) {
      if (i < 3) barrierPlaces.push({ position: [-8 + i * 1.8, 1.06, 16.5], rotation: [0, 0, 0], color: '#e8e3d8' });
      else if (i < 6) barrierPlaces.push({ position: [12.5, 1.14, -20 + (i - 3) * 2.0], rotation: [0, Math.PI / 2, 0], color: '#e8e3d8' });
      else barrierPlaces.push({ position: [rng.range(-30, 30), 1.06, rng.range(-22, 22)], rotation: [0, rng.range(0, TAU), 0], color: '#e8e3d8' });
    }
    addMany(PropGeometries.barrier(), 'plastic', 'barriers', barrierPlaces);

    // Rebar yard: bundles on timber dunnage.
    const rebarYard = this.config.laydown.rebarYard;
    const rebarPlaces = [];
    for (let i = 0; i < props.rebarBundles; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      rebarPlaces.push({
        position: [rebarYard.center[0] - 4.2 + col * 2.4, 1.16 + (i % 7 === 0 ? 0.2 : 0), rebarYard.center[1] - 3.6 + row * 2.2],
        rotation: [0, row % 2 ? 0.06 : -0.05, 0],
        color: i % 3 === 0 ? '#9c6a3c' : '#8a5a34',
      });
    }
    addMany(PropGeometries.rebarBundle(), 'metal', 'rebar', rebarPlaces);

    const cementPlaces = [];
    for (let i = 0; i < props.cementPallets; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      cementPlaces.push({
        position: [-30 + col * 1.5, 1.06 + (i > 5 ? 0.42 : 0), -12 + row * 1.4],
        rotation: [0, rng.range(-0.1, 0.1), 0],
        color: '#c6bfb0',
      });
    }
    addMany(PropGeometries.cementPallet(), 'fabric', 'cement', cementPlaces);

    const palletPlaces = [];
    for (let i = 0; i < props.pallets; i++) {
      palletPlaces.push({
        position: [rng.range(-34, 34), 1.06 + (i % 4 === 0 ? 0.18 : 0), rng.range(-24, 22)],
        rotation: [0, rng.range(0, TAU), 0],
        color: '#a97b45',
      });
    }
    addMany(PropGeometries.pallet(), 'wood', 'pallets', palletPlaces);

    const brickPlaces = [];
    for (let i = 0; i < props.brickPallets; i++) {
      brickPlaces.push({
        position: [-33 + (i % 3) * 1.4, 1.06, -20 + Math.floor(i / 3) * 1.6],
        rotation: [0, rng.range(-0.08, 0.08), 0],
        color: '#b5623c',
      });
    }
    addMany(PropGeometries.brickPallet(), 'brick', 'bricks', brickPlaces);

    // Site offices / welfare cabins.
    const cabinPlaces = [
      { position: [-27, 1.06, 18], rotation: [0, 0, 0], color: '#e2e6e6' },
      { position: [-20.5, 1.06, 18], rotation: [0, 0, 0], color: '#dfe4e4' },
      { position: [-27, 1.06, 22.6], rotation: [0, 0, 0], color: '#e6e9e8' },
    ];
    addMany(PropGeometries.portacabin(), 'paint', 'cabins', cabinPlaces);
    this.layout = this.layout || {};
    this.layout.cabin = cabinPlaces[0].position;
    this.layout.cabin2 = cabinPlaces[1].position;
    this.layout.cabin3 = cabinPlaces[2].position;

    const containerPlaces = [
      { position: [30, 1.06, -18], rotation: [0, 0, 0], color: '#3f6e86' },
      { position: [30, 1.06, -20.6], rotation: [0, 0, 0], color: '#7a5a3a' },
      { position: [24, 1.06, -20.6], rotation: [0, 0, 0], color: '#4a6b52' },
      { position: [-33, 1.06, 2], rotation: [0, Math.PI / 2, 0], color: '#8a4b3a' },
      { position: [34, 1.06, 6], rotation: [0, Math.PI / 2, 0], color: '#46617a' },
    ];
    addMany(PropGeometries.container(), 'metalDark', 'containers', containerPlaces.slice(0, props.containers));

    const powerPlaces = [
      { position: [12.8, 1.06, 13.2], rotation: [0, -0.4, 0], color: '#d8c14a' },
      { position: [-12, 1.06, 18.5], rotation: [0, 0.3, 0], color: '#d8c14a' },
      { position: [21, 1.06, 15], rotation: [0, 1.1, 0], color: '#d8c14a' },
      { position: [-17, 1.06, -21], rotation: [0, 2.2, 0], color: '#d8c14a' },
    ];
    addMany(PropGeometries.powerBox(), 'metal', 'power-boxes', powerPlaces.slice(0, props.powerBoxes));
    this.layout.powerBox = powerPlaces[0].position;

    const floodPlaces = [
      { position: [-12, 1.06, -20], rotation: [0, 0.5, 0], color: '#c9a227' },
      { position: [10, 1.06, -20.5], rotation: [0, -0.6, 0], color: '#c9a227' },
      { position: [22, 1.06, 6], rotation: [0, -1.4, 0], color: '#c9a227' },
      { position: [-22, 1.06, 6], rotation: [0, 1.6, 0], color: '#c9a227' },
      { position: [6, 1.06, 16], rotation: [0, 2.8, 0], color: '#c9a227' },
      { position: [-6, 1.06, -24], rotation: [0, 0.2, 0], color: '#c9a227' },
    ];
    addMany(PropGeometries.floodlight(), 'metal', 'floodlights', floodPlaces.slice(0, props.floodlights));
    this.layout.floodlights = floodPlaces.slice(0, props.floodlights);

    const dumpsterPlaces = [
      { position: [18, 1.06, 18], rotation: [0, 0.3, 0], color: '#8a4b3a' },
      { position: [20.4, 1.06, 18.2], rotation: [0, -0.2, 0], color: '#7a5a3a' },
      { position: [-24, 1.06, -18], rotation: [0, 1.2, 0], color: '#8a4b3a' },
      { position: [-22, 1.06, -21.5], rotation: [0, 0.7, 0], color: '#6f6b64' },
    ];
    addMany(PropGeometries.dumpster(), 'metalDark', 'dumpsters', dumpsterPlaces.slice(0, props.dumpsters));

    const rackPlaces = [
      { position: [26, 1.06, 4], rotation: [0, 0, 0], color: '#8f6f3f' },
      { position: [26, 1.06, 1.2], rotation: [0, 0, 0], color: '#8f6f3f' },
      { position: [-31, 1.06, -14], rotation: [0, 0.2, 0], color: '#8f6f3f' },
      { position: [8, 1.06, -26], rotation: [0, 0.9, 0], color: '#8f6f3f' },
      { position: [-8, 1.06, -26], rotation: [0, -0.9, 0], color: '#8f6f3f' },
    ];
    addMany(PropGeometries.pipeRack(), 'metal', 'pipe-racks', rackPlaces.slice(0, props.pipeRacks));

    const ladderPlaces = [
      { position: [22, 1.06, -14], rotation: [0, 0.2, 0.06], color: '#b0b6ba' },
      { position: [-14, 1.06, 22], rotation: [0, 1.4, -0.05], color: '#b0b6ba' },
      { position: [34, 1.06, -2], rotation: [0, -1.2, 0.04], color: '#b0b6ba' },
      { position: [-34, 1.06, -6], rotation: [0, 0.8, -0.06], color: '#b0b6ba' },
    ];
    addMany(PropGeometries.ladder(), 'metal', 'ladders', ladderPlaces.slice(0, props.ladders));

    const signPlaces = [
      { position: [3, 1.06, 20], rotation: [0, 0.1, 0], color: '#2f6f8f' },
      { position: [-9, 1.06, 12], rotation: [0, -0.6, 0], color: '#2f6f8f' },
      { position: [13.5, 1.06, -16], rotation: [0, 1.2, 0], color: '#c2603a' },
      { position: [-20, 1.06, -12], rotation: [0, 2.4, 0], color: '#2f6f8f' },
      { position: [30, 1.06, 14], rotation: [0, -1.8, 0], color: '#c2603a' },
      { position: [-30, 1.06, 8], rotation: [0, 1.9, 0], color: '#2f6f8f' },
    ];
    addMany(PropGeometries.sign(), 'paint', 'site-signs', signPlaces.slice(0, props.signs));

    const wheelStopPlaces = [];
    for (let i = 0; i < this.config.parking.stalls; i++) {
      const stallWidth = this.config.parking.lot.size[0] / this.config.parking.stalls;
      wheelStopPlaces.push({
        position: [
          this.config.parking.lot.center[0] - this.config.parking.lot.size[0] / 2 + stallWidth * (i + 0.5),
          1.12,
          this.config.parking.lot.center[1] - this.config.parking.lot.size[1] * 0.29,
        ],
        rotation: [0, 0, 0],
        color: '#d8d2c4',
      });
      wheelStopPlaces.push({
        position: [
          this.config.parking.lot.center[0] - this.config.parking.lot.size[0] / 2 + stallWidth * (i + 0.5),
          1.12,
          this.config.parking.lot.center[1] + this.config.parking.lot.size[1] * 0.29,
        ],
        rotation: [0, 0, 0],
        color: '#d8d2c4',
      });
    }
    addMany(PropGeometries.wheelStop(), 'concrete', 'wheel-stops', wheelStopPlaces.slice(0, props.wheelStops));
  }

  _buildVegetation() {
    const treeBatch = this._instance(PropGeometries.tree(), 'foliage', 'trees');
    const hedgeBatch = this._instance(PropGeometries.hedge(), 'foliage', 'hedges');
    const rng = this.rng.fork('trees');
    const treeSpots = [];
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * TAU + 0.2;
      const radius = 47 + rng.range(-3, 3);
      treeSpots.push([Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72]);
    }
    treeSpots.push([-42, 26], [42, 26], [-42, -22], [42, -22], [8, 30]);
    for (const [x, z] of treeSpots) {
      treeBatch.add({
        position: [x, -0.62, z],
        rotation: [0, rng.range(0, TAU), 0],
        scale: [rng.range(0.85, 1.35), rng.range(0.9, 1.4), rng.range(0.85, 1.35)],
        color: rng.chance(0.5) ? '#4f7a3c' : '#5f8c46',
      });
    }
    for (const [x, z, ry] of [[-32, 25, 0], [32, 25, 0], [-38, -24, 0.4], [38, -18, -0.3]]) {
      hedgeBatch.add({ position: [x, -0.6, z], rotation: [0, ry, 0], scale: [1, 1, 1], color: '#4a7438' });
    }
  }

  /** Desk dressing outside the site: mug, pencil, ruler, notebook, plant. */
  _buildDeskProps() {
    const table = this.config.world.table;
    const halfW = table.width / 2;
    const halfD = table.depth / 2;
    const mug = this._instance(PropGeometries.deskMug(), 'plastic', 'desk-mug', true, true);
    mug.add({ position: [halfW - 6.5, -0.6, -halfD + 10.5], rotation: [0, 0.4, 0], color: '#e8e4dc' });
    const pencil = this._instance(PropGeometries.deskPencil(), 'wood', 'desk-pencil', true, true);
    pencil.add({ position: [-halfW + 5.5, -0.6, halfD - 8.0], rotation: [0, 0.9, 0], color: '#e0a63c' });
    const ruler = this._instance(PropGeometries.deskRuler(), 'wood', 'desk-ruler', true, true);
    ruler.add({ position: [-halfW + 4.5, -0.6, halfD - 5.5], rotation: [0, 1.25, 0], color: '#d9c9a3' });
    const notebook = this._instance(PropGeometries.deskNotebook(), 'fabric', 'desk-notebook', true, true);
    notebook.add({ position: [halfW - 9.0, -0.6, halfD - 7.5], rotation: [0, -0.35, 0], color: '#f1ede2' });
    const plant = this._instance(PropGeometries.deskPlant(), 'foliage', 'desk-plant', true, true);
    plant.add({ position: [-halfW + 6.0, -0.6, -halfD + 7.0], rotation: [0, 0, 0], color: '#3f7038' });
  }
}

void UP;
