import THREE from '../lib/three.js';
import { Rng } from '../lib/rng.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
// Lets MaterialKit keep driving the emissive response of cloned batch materials.
const MATERIAL_TAGS = { emissive: { emissive: true, lampFactor: 1.0 } };
// Per-material texture tiling for unit-box UVs: small members need finer grain
// than big slabs to avoid reading as noise at miniature scale.
const MATERIAL_REPEAT = {
  concrete: 2.2,
  concreteRaw: 1.8,
  glass: 1,
  glassFrame: 1,
  metal: 3,
  metalDark: 2,
  wood: 2,
  net: 1,
  plastic: 1,
  emissive: 1,
};

/**
 * BatchedBuilder - accumulates the SAME primitive (a unit box, by default) at
 * many transforms so a whole structure becomes a couple of InstancedMeshes.
 * Revisions allow cheap "rebuild only when geometry meaningfully changed".
 */
export class BatchedBuilder {
  constructor({ name = 'batch', kits }) {
    this.name = name;
    this.kits = kits;
    this.materials = new Map();
    this.revision = 0;
  }

  material(key) {
    if (!this.materials.has(key)) {
      this.materials.set(key, { key, entries: [], mesh: null });
    }
    return this.materials.get(key);
  }

  box(key, { position, size, rotation = [0, 0, 0], color = '#ffffff', anchor = 'bottom' }) {
    const y = anchor === 'bottom' ? position[1] + size[1] / 2 : position[1];
    this.material(key).entries.push({
      position: [position[0], y, position[2]],
      scale: size,
      rotation,
      color,
    });
    return this;
  }

  clear() {
    for (const entry of this.materials.values()) entry.entries.length = 0;
    this.revision++;
    return this;
  }

  get entryCount() {
    let total = 0;
    for (const entry of this.materials.values()) total += entry.entries.length;
    return total;
  }

  /** Creates/refreshes InstancedMesh children on the provided parent group. */
  commit(parent) {
    for (const entry of this.materials.values()) {
      const count = entry.entries.length;
      const needsMesh = !entry.mesh || entry.mesh.instanceMatrix.count < count;
      if (needsMesh) {
        if (entry.mesh) {
          parent.remove(entry.mesh);
          entry.mesh.dispose();
        }
        // Dedicated material per batch: this mesh instances a plain UnitBox with
        // NO color attribute, so it must not share a material whose shader variant
        // was compiled for merged, vertex-colored geometry. Textures are re-scaled
        // per material because unit-box UVs are 0..1 per face.
        const material = this.kits.cloneSurfaced
          ? this.kits.cloneSurfaced(entry.key, { repeat: MATERIAL_REPEAT[entry.key] || 1 })
          : this.kits.get(entry.key);
        const tag = MATERIAL_TAGS[entry.key];
        if (tag && tag.emissive) {
          material.userData.lampFactor = tag.lampFactor;
          this.kits.emissiveMaterials.add(material);
        }
        const mesh = new THREE.InstancedMesh(UNIT_BOX, material, Math.max(1, count));
        mesh.name = `${this.name}:${entry.key}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        parent.add(mesh);
        entry.mesh = mesh;
      }
      const target = entry.mesh;
      target.count = count;
      target.visible = count > 0;
      if (!count) continue;
      const matrix = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const euler = new THREE.Euler();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      const color = new THREE.Color();
      entry.entries.forEach((item, index) => {
        euler.set(item.rotation[0], item.rotation[1], item.rotation[2]);
        quat.setFromEuler(euler);
        pos.set(item.position[0], item.position[1], item.position[2]);
        scl.set(item.scale[0], item.scale[1], item.scale[2]);
        matrix.compose(pos, quat, scl);
        target.setMatrixAt(index, matrix);
        target.setColorAt(index, color.set(item.color));
      });
      target.instanceMatrix.needsUpdate = true;
      if (target.instanceColor) target.instanceColor.needsUpdate = true;
    }
    this.revision++;
    return parent;
  }

  dispose() {
    for (const entry of this.materials.values()) {
      if (entry.mesh) entry.mesh.dispose();
    }
    this.materials.clear();
  }
}

export const PALETTE_FALLBACK = {
  structure: '#b9b4a9',
  slab: '#a8a49b',
  wall: '#cfc7b6',
  window: '#3d5566',
  windowLit: '#ffd9a0',
  roof: '#8d8a84',
};

/**
 * BuildingGeometry - the actual "no scaleY" construction model.
 *
 * Grid rules (all fixed so instances stay identical):
 *  - columns:  every grid node, fixed section
 *  - slab:     ONE bay-sized plate per bay (independently castable = build sequence)
 *  - walls:    fixed bay module per facade bay
 *  - windows:  fixed module per bay per floor
 *  - scaffold: 2.0 m vertical lift, fixed tube length
 */
export class BuildingGeometry {
  constructor(spec, kits, { seed = 'building' } = {}) {
    this.spec = spec;
    this.kits = kits;
    this.rng = new Rng(`${seed}:${spec.id}`);
    this.size = spec.size;
    this.grid = spec.grid || { baysX: 4, baysZ: 3, column: 0.7, slabThickness: 0.32, wallThickness: 0.35 };
    this.floorHeight = spec.floorHeight || 3.5;
    this.palette = { ...PALETTE_FALLBACK, ...(spec.palette || {}) };
    this.position = new THREE.Vector3(spec.position[0], 1.02, spec.position[2] !== undefined ? spec.position[2] : spec.position[1]);
    this.rotation = spec.rotation || 0;
    this.bayWidthX = this.size[0] / this.grid.baysX;
    this.bayWidthZ = this.size[1] / this.grid.baysZ;
    this.group = new THREE.Group();
    this.group.name = `building:${spec.id}`;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.rotation;
    this.batches = new BatchedBuilder({ name: `building:${spec.id}`, kits });
    this.colliders = [];
    this.stats = { boxes: 0, floors: 0 };
    this._buildColliders();
  }

  get half() {
    return [this.size[0] / 2, this.size[1] / 2];
  }

  floorY(floorIndex) {
    return floorIndex * this.floorHeight;
  }

  _buildColliders() {
    for (let floor = 0; floor < this.spec.floors.target; floor++) {
      const y = this.floorY(floor);
      const inset = 0.4;
      this.colliders.push({
        floor,
        rect: {
          minX: this.position.x - this.half[0] - inset,
          maxX: this.position.x + this.half[0] + inset,
          minZ: this.position.z - this.half[1] - inset,
          maxZ: this.position.z + this.half[1] + inset,
          minY: y + 0.1,
          maxY: y + this.floorHeight,
        },
      });
    }
  }

  /** Where a worker standing "on" this floor should be placed (world space). */
  floorWorkPoint(floorIndex, side = 'south', target = new THREE.Vector3()) {
    const inset = 1.4;
    const y = this.position.y + this.floorY(floorIndex) + this.grid.slabThickness;
    const [hx, hz] = this.half;
    const sideIndex = { south: 0, north: 1, east: 2, west: 3 }[side] ?? 0;
    const points = [
      [0, hz - inset],
      [0, -hz + inset],
      [hx - inset, 0],
      [-hx + inset, 0],
    ];
    const p = points[sideIndex];
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const lx = p[0];
    const lz = p[1];
    return target.set(
      this.position.x + lx * cos + lz * sin,
      y,
      this.position.z + -lx * sin + lz * cos,
    );
  }

  /** True when the given world position is above a real floor (for characters). */
  floorAt(worldY) {
    return Math.floor((worldY - this.position.y) / this.floorHeight);
  }

  /**
   * Rebuild geometry from a construction state.
   * Everything is fixed-size: slabs per bay, fixed columns, fixed facade modules.
   */
  build(state) {
    const batch = this.batches;
    batch.clear();
    const pal = this.palette;
    const { baysX, baysZ, column, slabThickness, wallThickness } = this.grid;
    const [hx, hz] = this.half;
    const floorH = this.floorHeight;
    const floors = state.floorsCompleted;
    const existing = this.spec.floors.existing;

    // ---------------- foundation ----------------
    const found = state.foundation;
    if (found > 0.01) {
      const matH = 0.9 * Math.min(1, found * 1.4);
      batch.box('concrete', {
        position: [0, -0.9 + matH / 2, 0],
        size: [this.size[0] + 3.2, matH, this.size[1] + 3.2],
        color: '#a9a49a',
      });
      batch.box('metal', {
        position: [0, -0.9 + matH, 0],
        size: [this.size[0] + 3.4, 0.06, this.size[1] + 3.4],
        color: '#8a5a34',
      });
      // Rebar mat grid sticking out above the blinding layer.
      if (found < 0.85) {
        const step = 1.1;
        for (let x = -hx; x <= hx; x += step) {
          batch.box('metal', { position: [x, -0.6 + matH, 0], size: [0.06, 0.06, this.size[1] + 2.4], color: '#9c6a3c' });
        }
        for (let z = -hz; z <= hz; z += step) {
          batch.box('metal', { position: [0, -0.52 + matH, z], size: [this.size[0] + 2.4, 0.06, 0.06], color: '#9c6a3c' });
        }
      }
    }

    // ---------------- structure: slabs / columns / beams ----------------
    const slabKey = 'concrete';
    const structureKey = 'concreteRaw';
    for (let floor = 0; floor < floors; floor++) {
      const y = this.floorY(floor);
      const isTop = floor === floors - 1;
      const slabDone = isTop ? state.slabProgress : 1;
      const columnDone = isTop ? state.columnProgress : 1;
      const beamDone = isTop ? state.beamProgress : 1;

      // Columns of this floor.
      if (columnDone > 0) {
        const columnHeight = floorH - slabThickness;
        for (const gx of this.gridNodesX()) {
          for (const gz of this.gridNodesZ()) {
            const isPerimeter = gx === 0 || gx === baysX || gz === 0 || gz === baysZ;
            const w = isPerimeter ? column : column * 0.72;
            batch.box(structureKey, {
              position: [this.gridX(gx), y + slabThickness + (columnHeight * columnDone) / 2, this.gridZ(gz)],
              size: [w, columnHeight * columnDone, w],
              color: pal.structure,
            });
          }
        }
        // Core / stair shaft walls.
        if (this.spec.style !== 'podium') {
          const coreW = this.bayWidthX * 1.05;
          const coreD = this.bayWidthZ * 0.85;
          batch.box(structureKey, {
            position: [-hx + coreW / 2 + 1.2, y + slabThickness, -hz + coreD / 2 + 1.2],
            size: [coreW, columnHeight * columnDone, 0.32],
            color: pal.core || pal.structure,
          });
          batch.box(structureKey, {
            position: [-hx + 0.28 + 1.2, y + slabThickness, -hz + coreD / 2 + 1.2],
            size: [0.32, columnHeight * columnDone, coreD],
            color: pal.core || pal.structure,
          });
        }
      }

      // Beams under the slab above.
      if (beamDone > 0 && floor + 1 <= floors) {
        const beamY = y + floorH - slabThickness - 0.18;
        for (let gx = 0; gx <= baysX; gx++) {
          batch.box(structureKey, {
            position: [this.gridX(gx), beamY, 0],
            size: [column * 0.62, 0.38 * beamDone, this.size[1] - column],
            color: pal.structure,
          });
        }
        for (let gz = 0; gz <= baysZ; gz++) {
          batch.box(structureKey, {
            position: [0, beamY, this.gridZ(gz)],
            size: [this.size[0] - column, 0.38 * beamDone, column * 0.62],
            color: pal.structure,
          });
        }
      }

      // Slab: one plate per bay so a pour can advance bay by bay.
      for (let bx = 0; bx < baysX; bx++) {
        for (let bz = 0; bz < baysZ; bz++) {
          const bayIndex = bx * baysZ + bz;
          const order = (bayIndex + 1) / (baysX * baysZ);
          if (slabDone < order) continue;
          const isPerimeter = bx === 0 || bx === baysX - 1 || bz === 0 || bz === baysZ - 1;
          batch.box(slabKey, {
            position: [this.gridX(bx) + this.bayWidthX / 2, y, this.gridZ(bz) + this.bayWidthZ / 2],
            size: [this.bayWidthX + column * 0.2, slabThickness, this.bayWidthZ + column * 0.2],
            color: isPerimeter ? pal.slab : this._shade(pal.slab, -0.05),
          });
        }
      }

      // Safety edge + formwork on the active floor.
      if (isTop && state.slabProgress < 1) {
        batch.box('wood', {
          position: [0, y + floorH - 0.1, hz + 0.25],
          size: [this.size[0] + 0.6, 0.22, 0.06],
          color: pal.formwork,
        });
        batch.box('wood', {
          position: [0, y + floorH - 0.1, -hz - 0.25],
          size: [this.size[0] + 0.6, 0.22, 0.06],
          color: pal.formwork,
        });
        batch.box('plastic', {
          position: [0, y + floorH + 0.45, hz + 0.12],
          size: [this.size[0] + 0.4, 0.08, 0.04],
          color: '#e8853c',
        });
        batch.box('plastic', {
          position: [0, y + floorH + 0.45, -hz - 0.12],
          size: [this.size[0] + 0.4, 0.08, 0.04],
          color: '#e8853c',
        });
      }

      // Rebar starters for the floor above.
      if (floor === floors - 1 && state.core < 0.995) {
        for (const gx of this.gridNodesX()) {
          for (const gz of this.gridNodesZ()) {
            batch.box('metal', {
              position: [this.gridX(gx), y + floorH, this.gridZ(gz)],
              size: [0.08, 0.9, 0.08],
              color: '#9c6a3c',
            });
          }
        }
      }
    }

    // ---------------- facade + glazing ----------------
    const facadeFloors = Math.floor(state.facadeFloors + 1e-6);
    const glazingFloors = Math.floor(state.glazingFloors + 1e-6);
    for (let floor = 0; floor < Math.min(floors, facadeFloors + 1); floor++) {
      const y = this.floorY(floor);
      const topY = y + floorH;
      const wallsDone = Math.min(1, state.facadeFloors - floor + 1) > 0.999 ? 1 : Math.max(0, state.facadeFloors - floor);
      if (wallsDone <= 0.001) continue;
      const glazed = glazingFloors >= floor + 1 || state.glazing > 0.98;
      const isGround = floor === 0;
      const wallH = (floorH - slabThickness) * Math.min(1, wallsDone);
      const yBase = y + slabThickness;

      // Four facades: parapet panel under the slab above + spandrel bands.
      for (const [side, sx, sz, along] of [
        ['south', 0, hz, 'x'],
        ['north', 0, -hz, 'z'],
        ['east', hx, 0, 'z'],
        ['west', -hx, 0, 'x'],
      ]) {
        void side;
        const bays = along === 'x' ? baysX : baysZ;
        const bay = along === 'x' ? this.bayWidthX : this.bayWidthZ;
        for (let b = 0; b < bays; b++) {
          const offset = (b + 0.5) * bay - (along === 'x' ? hx : hz);
          const position = along === 'x' ? [offset, 0, sz] : [sx, 0, offset];
          // Spandrel (solid strip at floor level).
          batch.box('concreteRaw', {
            position: [position[0], yBase, position[2]],
            size: along === 'x' ? [bay, 0.75 * Math.min(1, wallsDone * 1.3), wallThickness] : [wallThickness, 0.75 * Math.min(1, wallsDone * 1.3), bay],
            color: pal.wall,
          });
          if (isGround && !glazed) {
            // Ground floor glazing bands before the curtain wall goes in.
            batch.box('glass', {
              position: [position[0], yBase + 0.75, position[2]],
              size: along === 'x' ? [bay * 0.9, (wallH - 0.75), 0.12] : [0.12, (wallH - 0.75), bay * 0.9],
              color: '#7fa8bd',
            });
            continue;
          }
          if (glazed) {
            // Curtain wall module: frame + glass + emissive interior pane.
            const paneH = Math.max(0.5, wallH - 0.95);
            const col = this._windowColor(floor, b, along);
            batch.box('glassFrame', {
              position: [position[0], yBase + 0.75, position[2]],
              size: along === 'x' ? [bay * 0.96, 0.1, 0.16] : [0.16, 0.1, bay * 0.96],
              color: '#8d959b',
            });
            batch.box('glassFrame', {
              position: [position[0], yBase + 0.75 + paneH, position[2]],
              size: along === 'x' ? [bay * 0.96, 0.1, 0.16] : [0.16, 0.1, bay * 0.96],
              color: '#8d959b',
            });
            batch.box('glass', {
              position: [position[0], yBase + 0.75, position[2]],
              size: along === 'x' ? [bay * 0.86, paneH, 0.07] : [0.07, paneH, bay * 0.86],
              color: col.glass,
            });
            if (col.lit) {
              batch.box('emissive', {
                position: [
                  along === 'x' ? position[0] : position[0] + (sx > 0 ? -0.14 : 0.14),
                  yBase + 0.75,
                  along === 'x' ? position[2] + (sz > 0 ? -0.14 : 0.14) : position[2],
                ],
                size: along === 'x' ? [bay * 0.8, paneH * 0.9, 0.02] : [0.02, paneH * 0.9, bay * 0.8],
                color: col.emissive,
              });
            }
          } else {
            // Punch windows: masonry with an inset frame.
            const winW = bay * 0.55;
            const winH = Math.min(1.5, wallH - 1.0);
            if (winH > 0.4) {
              const count = along === 'x' ? 1 : 1;
              for (let i = 0; i < count; i++) {
                const shift = (i - (count - 1) / 2) * winW * 1.35;
                const px = along === 'x' ? position[0] + shift : position[0];
                const pz = along === 'x' ? position[2] : position[2] + shift;
                batch.box('concreteRaw', {
                  position: [px, yBase + 0.85, pz],
                  size: along === 'x' ? [winW, winH, wallThickness * 0.9] : [wallThickness * 0.9, winH, winW],
                  color: pal.window,
                });
              }
            }
            // The wall itself (fills the bay around/below the window).
            batch.box('concreteRaw', {
              position: [position[0], yBase + 0.75 + Math.max(0.4, wallH - 0.75), position[2]],
              size: along === 'x' ? [bay, 0.45, wallThickness] : [wallThickness, 0.45, bay],
              color: pal.wall,
            });
          }
        }
      }
    }

    // ---------------- roof ----------------
    if (floors >= this.spec.floors.target && state.roofing > 0.02) {
      const y = this.floorY(this.spec.floors.target);
      batch.box('concreteRaw', { position: [0, y, 0], size: [this.size[0] + 0.9, 0.35, this.size[1] + 0.9], color: pal.roof });
      if (state.roofing > 0.3) {
        batch.box('metal', { position: [0, y + 0.35, 0], size: [this.size[0] - 1.6, 0.5, this.size[1] - 1.6], color: '#8f9598' });
      }
      if (state.roofing > 0.55) {
        batch.box('metalDark', { position: [hx - 3.4, y + 0.85, -hz + 3.0], size: [4.2, 1.5, 3.4], color: '#767c80' });
        batch.box('metal', { position: [-hx + 4.0, y + 0.85, hz - 3.2], size: [3.0, 1.8, 3.0], color: '#8b9195' });
      }
    }

    // ---------------- scaffolding ----------------
    if (state.scaffolding) {
      const { from, to } = state.scaffolding;
      const startFloor = Math.max(0, from);
      const endFloor = Math.min(floors + 1, to);
      const lift = 2.0;
      const offset = 1.15;
      for (let floor = startFloor; floor <= endFloor; floor++) {
        const baseY = this.floorY(floor);
        const topY = baseY + floorH;
        // Uprights (both faces of the long sides).
        if (floor === startFloor) {
          for (let x = -hx - offset; x <= hx + offset + 0.01; x += 2.0) {
            for (const z of [-hz - offset, hz + offset]) {
              batch.box('metal', { position: [x, baseY, z], size: [0.09, topY - baseY, 0.09], color: '#b8bfc4' });
            }
          }
          for (let z = -hz - offset; z <= hz + offset + 0.01; z += 2.0) {
            for (const x of [-hx - offset, hx + offset]) {
              batch.box('metal', { position: [x, baseY, z], size: [0.09, topY - baseY, 0.09], color: '#b8bfc4' });
            }
          }
        }
        // Ledgers + planks per lift.
        for (let y = baseY; y < topY; y += lift) {
          for (const z of [-hz - offset, hz + offset]) {
            batch.box('metal', { position: [0, y, z], size: [this.size[0] + offset * 2, 0.08, 0.08], color: '#c3cacf' });
          }
          for (const x of [-hx - offset, hx + offset]) {
            batch.box('metal', { position: [x, y, 0], size: [0.08, 0.08, this.size[1] + offset * 2], color: '#c3cacf' });
          }
          batch.box('wood', { position: [0, y + 0.05, hz + offset], size: [this.size[0] + offset * 2, 0.06, 0.9], color: '#a9763f' });
          batch.box('wood', { position: [0, y + 0.05, -hz - offset], size: [this.size[0] + offset * 2, 0.06, 0.9], color: '#a9763f' });
        }
      }
      // Safety netting over the outer face of the scaffold.
      const netFrom = this.floorY(startFloor);
      const netTo = this.floorY(Math.min(endFloor, floors) + 1);
      if (netTo - netFrom > 0.5) {
        batch.box('net', {
          position: [0, netFrom, hz + 1.5],
          size: [this.size[0] + 2.4, netTo - netFrom, 0.05],
          color: '#3f8f52',
        });
        batch.box('net', {
          position: [0, netFrom, -hz - 1.5],
          size: [this.size[0] + 2.4, netTo - netFrom, 0.05],
          color: '#3f8f52',
        });
      }
    }

    this.stats.boxes = batch.entryCount;
    this.stats.floors = floors;
    void existing;
    return batch;
  }

  _shade(hex, amount) {
    const color = new THREE.Color(hex);
    color.offsetHSL(0, 0, amount);
    return `#${color.getHexString()}`;
  }

  /** Lit windows: deterministic per floor/bay so night lighting looks settled. */
  _windowColor(floor, bay, along) {
    const seed = this.rng.seed ^ (floor * 73856093) ^ (bay * 19349663) ^ (along === 'x' ? 83492791 : 12345);
    let h = seed >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const roll = (h % 1000) / 1000;
    const lit = roll > 0.42;
    return {
      lit,
      glass: lit ? '#5d7f92' : '#33505f',
      emissive: roll > 0.8 ? '#fff0cf' : roll > 0.6 ? '#ffd9a0' : '#cfe2f0',
    };
  }

  gridNodesX() {
    const nodes = [];
    for (let i = 0; i <= this.grid.baysX; i++) nodes.push(i);
    return nodes;
  }

  gridNodesZ() {
    const nodes = [];
    for (let i = 0; i <= this.grid.baysZ; i++) nodes.push(i);
    return nodes;
  }

  gridX(index) {
    return -this.half[0] + index * this.bayWidthX;
  }

  gridZ(index) {
    return -this.half[1] + index * this.bayWidthZ;
  }

  dispose() {
    this.batches.dispose();
  }
}
