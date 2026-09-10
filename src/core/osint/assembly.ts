/**
 * OSM multipolygon assembly — turn Overpass relation members into real
 * polygon geometry with holes.
 *
 * Why this exists: the v1 Overpass parser counted relations and moved on
 * rather than inventing a partial geometry. Land use polygons, water bodies
 * and forest blocks are overwhelmingly mapped as multipolygon relations
 * (several outer ways + inner holes), so skipping them silently dropped
 * exactly the large-area context that matters for planning screens. This
 * module assembles members honestly:
 *
 *  - member ways are chained into closed rings by exact endpoint matching
 *    (fragment orientation is normalized as needed);
 *  - explicit roles (outer/inner) are trusted; empty roles are classified
 *    by containment (a ring inside another ring is a hole);
 *  - each inner ring is assigned to the smallest containing outer;
 *  - ring orientation is normalized to RFC 7946 (outer CCW, inner CW);
 *  - anything that cannot be closed or classified is EXCLUDED and counted,
 *    never approximated — the honesty contract from the v1 parser holds.
 *
 * All functions are pure (lon/lat in, structures out) and run without DOM
 * or network so they are fully unit-testable.
 */

export type Ring = [number, number][]; // [lon, lat]

/** One member of a multipolygon relation, geometry pre-resolved by the caller. */
export interface RelationMemberInput {
  ref: number;
  role: string;
  /** Null when the member way has no resolvable geometry. */
  coords: Ring | null;
}

export interface AssembledPolygon {
  outer: Ring;
  inners: Ring[];
}

export type AssemblyStatus =
  | { status: "assembled"; polygons: AssembledPolygon[]; orphanInners: number }
  | { status: "skipped"; reason: "missing-member-geometry" | "unclosed-rings" | "no-valid-rings" };

/* ------------------------------------------------------------------ */
/* Ring primitives                                                     */
/* ------------------------------------------------------------------ */

/** Signed shoelace area on the lon/lat plane. Positive = counter-clockwise. */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

/** True when first and last coordinates coincide exactly. */
export function isClosed(coords: Ring): boolean {
  if (coords.length < 4) return false;
  const a = coords[0];
  const b = coords[coords.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

/** Remove consecutive duplicate vertices; a collapsed ring becomes invalid. */
export function dedupeRing(coords: Ring): Ring {
  const out: Ring = [];
  for (const c of coords) {
    const last = out[out.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c);
  }
  return out;
}

/** Ray-cast point-in-ring test (boundary behavior unspecified by design). */
export function pointInRing(pt: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Enforce orientation in place: CCW when wantCcw, CW otherwise. */
export function orient(ring: Ring, wantCcw: boolean): Ring {
  const ccw = signedArea(ring) > 0;
  return ccw === wantCcw ? ring : [...ring].reverse();
}

/* ------------------------------------------------------------------ */
/* Fragment chaining                                                   */
/* ------------------------------------------------------------------ */

/**
 * Chain open way fragments into closed rings by exact endpoint matching.
 * Fragments may be used reversed; every fragment is consumed at most once.
 * Returns the closed rings plus a count of fragments left dangling.
 */
export function chainOpenWays(fragments: Ring[]): { rings: Ring[]; leftover: number } {
  // Degenerate fragments (zero unique interior, e.g. repeated identical
  // nodes) can never close a ring — drop them up front instead of
  // counting them as dangling evidence of broken OSM data.
  const pool: Ring[] = fragments
    .map((f) => dedupeRing(f))
    .filter((f) => f.length >= 2)
    .map((f) => [...f]);
  const rings: Ring[] = [];
  let leftover = 0;

  while (pool.length > 0) {
    let chain = pool.pop()!;

    // Grow the chain at both ends until nothing connects.
    let grew = true;
    while (grew && !isClosed(chain)) {
      grew = false;
      const head = chain[0];
      const tail = chain[chain.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        const cHead = cand[0];
        const cTail = cand[cand.length - 1];

        if (tail[0] === cHead[0] && tail[1] === cHead[1]) {
          chain = chain.concat(cand.slice(1));
          pool.splice(i, 1);
          grew = true;
          break;
        }
        if (tail[0] === cTail[0] && tail[1] === cTail[1]) {
          chain = chain.concat(cand.slice(0, cand.length - 1).reverse());
          pool.splice(i, 1);
          grew = true;
          break;
        }
        if (head[0] === cTail[0] && head[1] === cTail[1]) {
          chain = cand.slice(0, cand.length - 1).concat(chain);
          pool.splice(i, 1);
          grew = true;
          break;
        }
        if (head[0] === cHead[0] && head[1] === cHead[1]) {
          chain = cand.slice(1).reverse().concat(chain);
          pool.splice(i, 1);
          grew = true;
          break;
        }
      }
    }

    if (isClosed(chain)) rings.push(dedupeRing(chain));
    else leftover++;
  }
  return { rings, leftover };
}

/** Normalize every ring: dedupe, close if needed, drop degenerates. */
function toValidRings(coordsList: Ring[]): { rings: Ring[]; degenerate: number } {
  const rings: Ring[] = [];
  let degenerate = 0;
  for (const c of coordsList) {
    const d = dedupeRing(c);
    if (isClosed(d) && Math.abs(signedArea(d)) > 0) rings.push(d);
    else degenerate++;
  }
  return { rings, degenerate };
}

/* ------------------------------------------------------------------ */
/* Classification + hole assignment                                    */
/* ------------------------------------------------------------------ */

/**
 * Classify role-less rings by containment: a ring contained in another
 * ring is a hole; the top-level rings are outers. Largest-area rings are
 * tested first so nesting deeper than one level still resolves sanely.
 */
export function classifyRingsByContainment(rings: Ring[]): { outers: Ring[]; inners: Ring[] } {
  const sorted = [...rings].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const outers: Ring[] = [];
  const inners: Ring[] = [];
  for (const ring of sorted) {
    const probe = ring[0];
    const container = outers.find((o) => pointInRing(probe, o));
    if (container) inners.push(ring);
    else outers.push(ring);
  }
  return { outers, inners };
}

/**
 * Assign each inner ring to the smallest containing outer. Returns the
 * polygon list and the number of orphans (inners with no containing
 * outer) — orphans are excluded upstream, never invented around.
 */
export function assignInners(
  outers: Ring[],
  inners: Ring[],
): { polygons: AssembledPolygon[]; orphanInners: number } {
  const polygons: AssembledPolygon[] = outers.map((outer) => ({
    outer: orient(outer, true),
    inners: [],
  }));
  let orphanInners = 0;

  for (const inner of inners) {
    const probe = inner[0];
    // Smallest-area containing outer wins (nested outers edge case).
    let best: AssembledPolygon | null = null;
    let bestArea = Infinity;
    for (const poly of polygons) {
      if (pointInRing(probe, poly.outer)) {
        const a = Math.abs(signedArea(poly.outer));
        if (a < bestArea) {
          best = poly;
          bestArea = a;
        }
      }
    }
    if (best) best.inners.push(orient(inner, false));
    else orphanInners++;
  }
  return { polygons, orphanInners };
}

/* ------------------------------------------------------------------ */
/* Relation assembly                                                   */
/* ------------------------------------------------------------------ */

/**
 * Assemble one multipolygon relation. Geometry for every member must be
 * present — a single missing member skips the whole relation (no partial
 * geometry is ever emitted).
 */
export function assembleRelation(members: RelationMemberInput[]): AssemblyStatus {
  if (members.some((m) => !m.coords || m.coords.length < 2)) {
    return { status: "skipped", reason: "missing-member-geometry" };
  }

  const present = members.filter(
    (m): m is RelationMemberInput & { coords: Ring } => m.coords !== null,
  );

  const explicitOuterWays: Ring[] = [];
  const explicitInnerWays: Ring[] = [];
  const rolelessWays: Ring[] = [];
  for (const m of present) {
    if (m.role === "outer") explicitOuterWays.push(m.coords);
    else if (m.role === "inner") explicitInnerWays.push(m.coords);
    else rolelessWays.push(m.coords);
  }

  // Closed ways become rings directly; open fragments chain per bucket.
  const closedOf = (list: Ring[]) => list.filter(isClosed);
  const openOf = (list: Ring[]) => list.filter((c) => !isClosed(c));

  const outerClosed = closedOf(explicitOuterWays);
  const innerClosed = closedOf(explicitInnerWays);
  const rolelessClosed = closedOf(rolelessWays);

  const outerChained = chainOpenWays(openOf(explicitOuterWays));
  const innerChained = chainOpenWays(openOf(explicitInnerWays));
  const rolelessChained = chainOpenWays(openOf(rolelessWays));

  // Unclosed fragments anywhere → refuse the relation (the OSM data is
  // broken enough that any completion would be fabrication).
  const leftoverFragments =
    outerChained.leftover + innerChained.leftover + rolelessChained.leftover;
  if (leftoverFragments > 0) {
    return { status: "skipped", reason: "unclosed-rings" };
  }

  const outerRings = [...outerClosed, ...outerChained.rings];
  const innerRings = [...innerClosed, ...innerChained.rings];
  const rolelessRings = [...rolelessClosed, ...rolelessChained.rings];

  // Role-less rings classify by containment against each other AND the
  // explicit outers (an untagged hole inside a tagged outer is common).
  let classifiedInners: Ring[] = [];
  let allOuters = outerRings;
  if (rolelessRings.length > 0) {
    const cls = classifyRingsByContainment([...rolelessRings, ...outerRings]);
    allOuters = cls.outers; // explicit outers stay outers unless nested (pathological)
    classifiedInners = cls.inners; // roleless rings that fell inside something
  }

  const allInners = [...innerRings, ...classifiedInners];

  const outerValid = toValidRings(allOuters);
  const innerValid = toValidRings(allInners);
  if (outerValid.rings.length === 0) {
    return { status: "skipped", reason: "no-valid-rings" };
  }

  const { polygons, orphanInners } = assignInners(outerValid.rings, innerValid.rings);
  if (polygons.length === 0) {
    return { status: "skipped", reason: "no-valid-rings" };
  }
  return { status: "assembled", polygons, orphanInners };
}
