import THREE from '../lib/three.js';

const _v = new THREE.Vector3();

/**
 * WaypointGraph - navigable node graph with A* pathfinding.
 * Nodes are plain data (id, pos, tags). Edges connect nodes with a cost and an
 * optional "walkable" flag used by the nav grid validator.
 */
export class WaypointGraph {
  constructor({ nodes = [], edges = [] } = {}) {
    this.nodes = new Map();
    this.adjacency = new Map();
    this.tags = new Map();
    for (const node of nodes) this.addNode(node);
    // Edges accept either [a, b] pairs (scene.json) or { a, b, cost } objects.
    for (const edge of edges) {
      if (Array.isArray(edge)) this.addEdge(edge[0], edge[1]);
      else this.addEdge(edge.a, edge.b, edge.cost);
    }
  }

  addNode({ id, position, tag = 'default', workSpot = false }) {
    this.nodes.set(id, { id, position: new THREE.Vector3(position[0], 0, position[2] !== undefined ? position[2] : position[1]), tag, workSpot });
    if (!this.adjacency.has(id)) this.adjacency.set(id, []);
    if (!this.tags.has(tag)) this.tags.set(tag, []);
    this.tags.get(tag).push(id);
    return id;
  }

  addEdge(a, b, cost = null) {
    if (!this.nodes.has(a) || !this.nodes.has(b)) throw new Error(`WaypointGraph: unknown node in edge ${a}-${b}`);
    const dist = cost === null ? this.nodes.get(a).position.distanceTo(this.nodes.get(b).position) : cost;
    this.adjacency.get(a).push({ to: b, cost: dist });
    this.adjacency.get(b).push({ to: a, cost: dist });
    return this;
  }

  connectBidirectional(pairs, cost = null) {
    for (const [a, b] of pairs) this.addEdge(a, b, cost);
    return this;
  }

  /** Auto-connect each node to its k nearest neighbours within maxDist. */
  autoConnect({ maxDist = 16, k = 3, sameBias = 1.3 } = {}) {
    const ids = [...this.nodes.keys()];
    for (const id of ids) {
      const from = this.nodes.get(id);
      const candidates = ids
        .filter((other) => other !== id)
        .map((other) => ({ other, d: from.position.distanceTo(this.nodes.get(other).position) }))
        .filter((c) => c.d <= maxDist)
        .sort((a, b) => a.d - b.d)
        .slice(0, k);
      for (const candidate of candidates) {
        const to = this.nodes.get(candidate.other);
        const bias = to.tag === from.tag ? 1 : sameBias;
        const exists = this.adjacency.get(id).some((e) => e.to === candidate.other);
        if (!exists) this.addEdge(id, candidate.other, candidate.d * bias);
      }
    }
    return this;
  }

  get(id) {
    return this.nodes.get(id) || null;
  }

  position(id, target = _v) {
    const node = this.nodes.get(id);
    return node ? target.copy(node.position) : target.set(0, 0, 0);
  }

  nodesWithTag(tag) {
    return this.tags.get(tag) || [];
  }

  /** A* over the adjacency list. Returns array of node ids (inclusive) or null. */
  findPath(startId, goalId) {
    if (startId === goalId) return [startId];
    if (!this.nodes.has(startId) || !this.nodes.has(goalId)) return null;
    const goal = this.nodes.get(goalId).position;
    const open = new Set([startId]);
    const cameFrom = new Map();
    const gScore = new Map([[startId, 0]]);
    const fScore = new Map([[startId, this.nodes.get(startId).position.distanceTo(goal)]]);

    while (open.size) {
      let current = null;
      let best = Infinity;
      for (const id of open) {
        const f = fScore.get(id) ?? Infinity;
        if (f < best) {
          best = f;
          current = id;
        }
      }
      if (current === goalId) {
        const path = [current];
        let cursor = current;
        while (cameFrom.has(cursor)) {
          cursor = cameFrom.get(cursor);
          path.unshift(cursor);
        }
        return path;
      }
      open.delete(current);
      for (const edge of this.adjacency.get(current) || []) {
        const tentative = (gScore.get(current) ?? Infinity) + edge.cost;
        if (tentative < (gScore.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, current);
          gScore.set(edge.to, tentative);
          fScore.set(edge.to, tentative + this.nodes.get(edge.to).position.distanceTo(goal));
          open.add(edge.to);
        }
      }
    }
    return null;
  }

  nearestNode(position, filter = null) {
    let best = null;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      if (filter && !filter(node)) continue;
      const d = node.position.distanceToSquared(position);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  /** Debug helper: line segments for every unique edge. */
  buildDebugGeometry(offsetY = 0.12) {
    const positions = [];
    const seen = new Set();
    for (const [id, edges] of this.adjacency) {
      for (const edge of edges) {
        const key = id < edge.to ? `${id}|${edge.to}` : `${edge.to}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = this.nodes.get(id).position;
        const b = this.nodes.get(edge.to).position;
        positions.push(a.x, offsetY, a.z, b.x, offsetY, b.z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }

  buildNodeGeometry(size = 0.5, offsetY = 0.12) {
    return new THREE.BoxGeometry(size, 0.08, size).translate(0, offsetY, 0);
  }
}

/**
 * Simple 2D occupancy grid used to validate navigation links around obstacles.
 * Walls/fences register rectangles; characters use it to reject graph edges.
 */
export class NavGrid {
  constructor({ width = 96, depth = 72, cell = 2, origin = [0, 0] } = {}) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(depth / cell);
    this.originX = origin[0] - width / 2;
    this.originZ = origin[1] - depth / 2;
    this.grid = new Uint8Array(this.cols * this.rows);
  }

  _index(x, z) {
    const col = Math.floor((x - this.originX) / this.cell);
    const row = Math.floor((z - this.originZ) / this.cell);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  blockRect({ center, size, rotation = 0, margin = 0.4 }) {
    const halfW = size[0] / 2 + margin;
    const halfD = size[1] / 2 + margin;
    const radius = Math.hypot(halfW, halfD);
    const minCol = Math.floor((center[0] - radius - this.originX) / this.cell);
    const maxCol = Math.ceil((center[0] + radius - this.originX) / this.cell);
    const minRow = Math.floor((center[1] - radius - this.originZ) / this.cell);
    const maxRow = Math.ceil((center[1] + radius - this.originZ) / this.cell);
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) continue;
        const wx = this.originX + (col + 0.5) * this.cell;
        const wz = this.originZ + (row + 0.5) * this.cell;
        const dx = wx - center[0];
        const dz = wz - center[1];
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        if (Math.abs(lx) <= halfW && Math.abs(lz) <= halfD) this.grid[row * this.cols + col] = 1;
      }
    }
    return this;
  }

  isBlocked(x, z) {
    const index = this._index(x, z);
    return index < 0 ? true : this.grid[index] === 1;
  }

  /** True when the straight segment is clear of blocked cells. */
  isSegmentClear(a, b, samples = 10) {
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      if (this.isBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  /** Push a point out of blocked cells (used when characters are spawned inside props). */
  resolve(position, radius = 0.6) {
    if (!this.isBlocked(position.x, position.z)) return position;
    for (let ring = 1; ring <= 6; ring++) {
      const dist = ring * this.cell * 0.5;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const x = position.x + Math.cos(angle) * dist;
        const z = position.z + Math.sin(angle) * dist;
        if (!this.isBlocked(x, z)) {
          position.x = x + Math.cos(angle) * radius;
          position.z = z + Math.sin(angle) * radius;
          return position;
        }
      }
    }
    return position;
  }
}
