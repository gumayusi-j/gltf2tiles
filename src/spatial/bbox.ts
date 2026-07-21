import { CoordinateTransform } from '../coord/transform.js';
import type { Box3, TileNode } from '../types.js';

/** Create a Box3 from min/max extents. */
export function createBox3(
  min: [number, number, number],
  max: [number, number, number],
): Box3 {
  return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] };
}

/** Center of a box. */
export function boxCenter(b: Box3): [number, number, number] {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

/** Half-extents (clamped to ≥ 0.005 m). */
export function boxHalfExtents(b: Box3): [number, number, number] {
  return [
    Math.max((b.max[0] - b.min[0]) / 2, 0.005),
    Math.max((b.max[1] - b.min[1]) / 2, 0.005),
    Math.max((b.max[2] - b.min[2]) / 2, 0.005),
  ];
}

/** Merge multiple boxes into one AABB. */
export function mergeBboxes(boxes: Box3[]): Box3 {
  if (boxes.length === 0) return createBox3([0, 0, 0], [0, 0, 0]);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const b of boxes) {
    if (b.min[0] < minX) minX = b.min[0];
    if (b.min[1] < minY) minY = b.min[1];
    if (b.min[2] < minZ) minZ = b.min[2];
    if (b.max[0] > maxX) maxX = b.max[0];
    if (b.max[1] > maxY) maxY = b.max[1];
    if (b.max[2] > maxZ) maxZ = b.max[2];
  }
  return createBox3([minX, minY, minZ], [maxX, maxY, maxZ]);
}

/**
 * Split a box into 8 octants (OCTREE).
 * Iterates in Morton-like order: (x:0/1, y:0/1, z:0/1).
 */
export function splitOctree(b: Box3): Box3[] {
  const c = boxCenter(b);
  const out: Box3[] = [];
  for (let iz = 0; iz < 2; iz++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let ix = 0; ix < 2; ix++) {
        out.push(
          createBox3(
            [ix === 0 ? b.min[0] : c[0], iy === 0 ? b.min[1] : c[1], iz === 0 ? b.min[2] : c[2]],
            [ix === 0 ? c[0] : b.max[0], iy === 0 ? c[1] : b.max[1], iz === 0 ? c[2] : b.max[2]],
          ),
        );
      }
    }
  }
  return out;
}

/**
 * Convert a Box3 to a 3D Tiles `boundingVolume.box` (12 numbers):
 *   [center, halfAxisX, zero, zero,  zero, halfAxisY, zero,  zero, zero, halfAxisZ]
 */
export function bboxToTilesetBox(b: Box3): number[] {
  const [cx, cy, cz] = boxCenter(b);
  const [hx, hy, hz] = boxHalfExtents(b);
  return [cx, cy, cz, hx, 0, 0, 0, hy, 0, 0, 0, hz];
}

/**
 * Leaf geometric error = half of the maximum span.
 * Mirrors osgb23dtile.cpp:285-294.
 */
export function leafGeometricError(b: Box3): number {
  const dx = b.max[0] - b.min[0];
  const dy = b.max[1] - b.min[1];
  const dz = b.max[2] - b.min[2];
  return Math.max(dx, dy, dz) / 2;
}

/**
 * Bottom-up geometric error propagation.
 * Leaf → max(span)/2.  Parent → max(child error) × 2.
 * Mirrors osgb23dtile.cpp:1466-1483.
 */
export function computeGeometricError(node: TileNode): void {
  for (const child of node.children) computeGeometricError(child);
  if (node.children.length === 0) {
    node.geometricError = leafGeometricError(node.bbox);
  } else {
    node.geometricError = Math.max(...node.children.map(c => c.geometricError)) * 2;
  }
}

/** Transform an AABB by a column-major 4×4 matrix. */
export function transformBbox(b: Box3, mat: Float64Array | number[]): Box3 {
  const corners: [number, number, number][] = [
    [b.min[0], b.min[1], b.min[2]],
    [b.max[0], b.min[1], b.min[2]],
    [b.min[0], b.max[1], b.min[2]],
    [b.min[0], b.min[1], b.max[2]],
    [b.max[0], b.max[1], b.min[2]],
    [b.min[0], b.max[1], b.max[2]],
    [b.max[0], b.min[1], b.max[2]],
    [b.max[0], b.max[1], b.max[2]],
  ];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of corners) {
    const [x, y, z] = CoordinateTransform.transformPoint(mat, c);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return createBox3([minX, minY, minZ], [maxX, maxY, maxZ]);
}

/** Test whether point is inside box (AABB). */
export function pointInBox(p: [number, number, number], b: Box3): boolean {
  return (
    p[0] >= b.min[0] && p[0] <= b.max[0] &&
    p[1] >= b.min[1] && p[1] <= b.max[1] &&
    p[2] >= b.min[2] && p[2] <= b.max[2]
  );
}
