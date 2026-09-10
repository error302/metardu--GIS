/**
 * Uniform-grid spatial index (STR-lite).
 *
 * A dependency-free cell grid that reduces nearest-neighbour and radius
 * queries from O(n) / O(n·m) scans to O(local) lookups. Used by the MCDA
 * evaluator, electrification clustering, hazard auditing, and canvas
 * hit-testing.
 *
 * Design notes:
 *  - Items are hashed into exactly one cell by their anchor coordinate, so
 *    radius() never needs deduplication.
 *  - nearest() uses progressive ring expansion and stops as soon as the ring
 *    perimeter lies beyond the current best distance, which preserves the
 *    exact brute-force metric.
 *  - SegmentIndex registers each segment into every cell its bounding box
 *    touches (conservative), then evaluates the exact point-to-segment
 *    distance on frontier cells only, so results are identical to a linear
 *    scan while touching a fraction of the candidates.
 */

export interface XY {
  x: number;
  y: number;
}

const CELL_BITS = 20; // pack col/row into one integer key: (row << 20) | col

export class UniformGridIndex<T> {
  private cells = new Map<number, T[]>();
  private cols = 1;
  private rows = 1;
  private cellSize = 1;
  private minX = 0;
  private minY = 0;
  private anchor: (item: T) => XY;
  private _size = 0;

  constructor(items: T[], anchor: (item: T) => XY, cellSize?: number) {
    this.anchor = anchor;
    if (items.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      const p = anchor(it);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    // Aim for roughly one item per cell, clamped so huge extents with sparse
    // data do not explode the cell count.
    const approxCells = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const autoSize = Math.max(spanX, spanY) / approxCells;
    this.cellSize = cellSize && cellSize > 0 ? cellSize : Math.max(autoSize, 1e-6);
    this.cols = Math.max(1, Math.ceil(spanX / this.cellSize) + 1);
    this.rows = Math.max(1, Math.ceil(spanY / this.cellSize) + 1);
    this.minX = minX;
    this.minY = minY;

    for (const it of items) {
      const p = anchor(it);
      const key = this.keyOf(p.x, p.y);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(it);
      else this.cells.set(key, [it]);
      this._size++;
    }
  }

  get size(): number {
    return this._size;
  }

  private keyOf(x: number, y: number): number {
    const cx = Math.floor((x - this.minX) / this.cellSize);
    const cy = Math.floor((y - this.minY) / this.cellSize);
    return (cy << CELL_BITS) | cx;
  }

  /** All items whose anchor lies within `r` of (x, y). */
  radius(x: number, y: number, r: number): T[] {
    if (this._size === 0 || r < 0) return [];
    const rSq = r * r;
    const out: T[] = [];
    const [c0, c1, rw0, rw1] = this.windowOf(x, y, r);
    for (let row = rw0; row <= rw1; row++) {
      for (let col = c0; col <= c1; col++) {
        const bucket = this.cells.get((row << CELL_BITS) | col);
        if (!bucket) continue;
        for (const it of bucket) {
          const p = this.anchor(it);
          const dx = p.x - x;
          const dy = p.y - y;
          if (dx * dx + dy * dy <= rSq) out.push(it);
        }
      }
    }
    return out;
  }

  /** Exact nearest item by anchor distance, or null when the index is empty. */
  nearest(x: number, y: number): { item: T; dist: number } | null {
    if (this._size === 0) return null;
    let best: T | null = null;
    let bestDistSq = Infinity;

    const startCol = Math.floor((x - this.minX) / this.cellSize);
    const startRow = Math.floor((y - this.minY) / this.cellSize);
    // Rings must extend to the FARTHEST grid edge so the whole grid is
    // covered; the per-direction terms also handle queries outside the
    // extent on either side.
    const maxRing = Math.max(startCol, startRow, this.cols - 1 - startCol, this.rows - 1 - startRow);

    for (let ring = 0; ring <= maxRing; ring++) {
      // Once the inner edge of the current ring is farther than the best
      // candidate, no cell on or beyond this ring can win: stop early.
      if (ring > 1 && (ring - 1) * this.cellSize > Math.sqrt(bestDistSq)) break;
      this.scanRing(startCol, startRow, ring, (it, p) => {
        const dx = p.x - x;
        const dy = p.y - y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          best = it;
        }
      });
    }

    return best ? { item: best, dist: Math.sqrt(bestDistSq) } : null;
  }

  private scanRing(
    startCol: number, startRow: number, ring: number,
    visit: (item: T, p: XY) => void
  ): void {
    if (ring === 0) {
      this.scanCell(startCol, startRow, visit);
      return;
    }
    for (let col = startCol - ring; col <= startCol + ring; col++) {
      this.scanCell(col, startRow - ring, visit);
      this.scanCell(col, startRow + ring, visit);
    }
    for (let row = startRow - ring + 1; row <= startRow + ring - 1; row++) {
      this.scanCell(startCol - ring, row, visit);
      this.scanCell(startCol + ring, row, visit);
    }
  }

  private scanCell(col: number, row: number, visit: (item: T, p: XY) => void): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const bucket = this.cells.get((row << CELL_BITS) | col);
    if (!bucket) return;
    for (const it of bucket) visit(it, this.anchor(it));
  }

  /** Bounding column/row window of a circle, clamped to the grid. */
  private windowOf(x: number, y: number, r: number): [number, number, number, number] {
    const c0 = Math.max(0, Math.floor((x - r - this.minX) / this.cellSize));
    const c1 = Math.min(this.cols - 1, Math.floor((x + r - this.minX) / this.cellSize));
    const rw0 = Math.max(0, Math.floor((y - r - this.minY) / this.cellSize));
    const rw1 = Math.min(this.rows - 1, Math.floor((y + r - this.minY) / this.cellSize));
    return [c0, c1, rw0, rw1];
  }
}

/** A straight segment registered in a SegmentIndex, traced back to its owner polyline. */
export interface IndexedSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  owner: number; // index of the owning polyline in the source array
}

/**
 * Grid index over line segments supporting exact nearest-distance queries.
 * Each segment is registered into every cell its bounding box overlaps.
 * nearestDistance() sweeps outward in square fronts and evaluates the exact
 * metric only on frontier cells, terminating once the frontier lies beyond
 * the current best distance — identical result to a brute-force scan.
 */
export class SegmentIndex {
  private cells = new Map<number, IndexedSegment[]>();
  private cols = 1;
  private rows = 1;
  private cellSize = 1;
  private minX = 0;
  private minY = 0;
  private _segmentCount = 0;

  constructor(polylines: XY[][]) {
    let exMin = Infinity, eyMin = Infinity, exMax = -Infinity, eyMax = -Infinity;
    let sumLen = 0;
    let segCount = 0;

    for (const pts of polylines) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a.x < exMin) exMin = a.x;
        if (a.y < eyMin) eyMin = a.y;
        if (b.x < exMin) exMin = b.x;
        if (b.y < eyMin) eyMin = b.y;
        if (a.x > exMax) exMax = a.x;
        if (a.y > eyMax) eyMax = a.y;
        if (b.x > exMax) exMax = b.x;
        if (b.y > eyMax) eyMax = b.y;
        sumLen += Math.hypot(b.x - a.x, b.y - a.y);
        segCount++;
      }
    }

    this._segmentCount = segCount;
    if (segCount === 0) return;

    const spanX = exMax - exMin || 1;
    const spanY = eyMax - eyMin || 1;
    const span = Math.max(spanX, spanY);
    // Cell size tuned to ~2x the average segment length so a typical segment
    // touches only a few cells, clamped to a coarse grid (<=128 cells per
    // axis) — dense-vertex polylines (long, smooth) would otherwise generate
    // millions of near-empty cells and expensive far-query sweeps.
    const avgLen = Math.max(sumLen / segCount, 1e-6);
    let cell = Math.max(avgLen * 2, span / 128);
    if (!(cell > 0)) cell = 1e-6;

    this.cellSize = cell;
    this.cols = Math.max(1, Math.ceil(spanX / cell) + 1);
    this.rows = Math.max(1, Math.ceil(spanY / cell) + 1);
    this.minX = exMin;
    this.minY = eyMin;

    const colOf = (x: number) => Math.floor((x - this.minX) / cell);
    const rowOf = (y: number) => Math.floor((y - this.minY) / cell);

    let owner = 0;
    for (const pts of polylines) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const seg: IndexedSegment = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, owner };
        const c0 = Math.max(0, colOf(Math.min(a.x, b.x)));
        const c1 = Math.min(this.cols - 1, colOf(Math.max(a.x, b.x)));
        const r0 = Math.max(0, rowOf(Math.min(a.y, b.y)));
        const r1 = Math.min(this.rows - 1, rowOf(Math.max(a.y, b.y)));
        for (let row = r0; row <= r1; row++) {
          for (let col = c0; col <= c1; col++) {
            const key = (row << CELL_BITS) | col;
            const bucket = this.cells.get(key);
            if (bucket) bucket.push(seg);
            else this.cells.set(key, [seg]);
          }
        }
      }
      owner++;
    }
  }

  get segmentCount(): number {
    return this._segmentCount;
  }

  /**
   * Exact minimum distance from (x, y) to any registered segment, evaluated
   * with the supplied metric (pass pointToSegmentDistance to mirror the
   * legacy linear scan bit-for-bit).
   *
   * Uses a best-first search over cell bounding rectangles: cells are popped
   * in order of their minimum possible distance to the query, so only cells
   * that can actually improve the answer are visited. Exact — identical to a
   * brute-force scan — because a segment closer than `best` always overlaps
   * at least one cell whose rect bound is below `best`.
   */
  nearestDistance(
    x: number,
    y: number,
    exact: (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => number
  ): number {
    if (this._segmentCount === 0) return Infinity;

    let best = Infinity;

    // Min-heap over unvisited cells keyed by lower-bound distance from the
    // query to the cell rectangle.
    const heap: { b: number; col: number; row: number }[] = [];
    const push = (col: number, row: number) => {
      if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
      const key = row * this.cols + col;
      if (visited.has(key)) return;
      visited.add(key);
      // Rect-to-point lower bound
      const dx = Math.max(this.minX + col * this.cellSize - x, 0, x - (this.minX + (col + 1) * this.cellSize));
      const dy = Math.max(this.minY + row * this.cellSize - y, 0, y - (this.minY + (row + 1) * this.cellSize));
      const b = Math.hypot(dx, dy);
      if (b >= best) return;
      heap.push({ b, col, row });
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent].b <= heap[i].b) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    };
    const pop = (): { b: number; col: number; row: number } | null => {
      if (heap.length === 0) return null;
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].b < heap[m].b) m = l;
          if (r < heap.length && heap[r].b < heap[m].b) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };

    const visited = new Set<number>();

    // Seed from the clamped query cell (valid for in-grid and outside queries)
    const startCol = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
    const startRow = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cellSize)));
    push(startCol, startRow);

    for (;;) {
      const cell = pop();
      if (!cell) break;
      // Heap-ordered: every remaining cell is at least this far — stop early.
      if (cell.b >= best) break;

      const bucket = this.cells.get((cell.row << CELL_BITS) | cell.col);
      if (bucket) {
        for (const s of bucket) {
          const d = exact(x, y, s.x1, s.y1, s.x2, s.y2);
          if (d < best) best = d;
        }
      }
      push(cell.col - 1, cell.row);
      push(cell.col + 1, cell.row);
      push(cell.col, cell.row - 1);
      push(cell.col, cell.row + 1);
    }

    return best;
  }
}

/**
 * Convenience: build an index over a point-like array and answer the exact
 * nearest-anchor query. Kept here so call sites stay one-liners.
 */
export function buildPointIndex<T>(items: T[], anchor: (item: T) => XY): UniformGridIndex<T> {
  return new UniformGridIndex<T>(items, anchor);
}
