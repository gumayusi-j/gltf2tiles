import { Document, Node as GltfNode, Mesh, Accessor } from '@gltf-transform/core';
import type { GlbInstance, Box3 } from '../types.js';
import { mergeBboxes, transformBbox, createBox3 } from '../spatial/bbox.js';
import { CoordinateTransform } from '../coord/transform.js';
import { debug, info } from '../util/log.js';

export function flattenScene(doc: Document): GlbInstance[] {
  const instances: GlbInstance[] = [];
  let idCounter = 0;
  const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const visited = new Set<GltfNode>();

  function walk(node: GltfNode, parentMatrix: Float64Array): void {
    if (visited.has(node)) return;
    visited.add(node);

    const local = readNodeMatrix(node);
    const worldMatrix = CoordinateTransform.mat4Multiply(parentMatrix, local);

    const mesh = node.getMesh();
    if (mesh) {
      const localBbox = computeMeshBbox(mesh);
      const worldBbox = transformBbox(localBbox, worldMatrix);
      instances.push({
        id: idCounter++,
        name: node.getName() || `node_${idCounter}`,
        worldMatrix,
        localBbox,
        worldBbox,
        mesh,
        material: mesh.listPrimitives()[0]?.getMaterial() ?? null,
      });
    }

    for (const child of node.listChildren()) walk(child, worldMatrix);
  }

  for (const scene of doc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) walk(node, identity);
  }

  if (instances.length === 0) {
    for (const node of doc.getRoot().listNodes()) {
      if (node.getMesh() && !visited.has(node)) walk(node, identity);
    }
  }

  info(`Flattened scene: ${instances.length} instance(s), ${visited.size} node(s) visited`);
  return instances;
}

function readNodeMatrix(node: GltfNode): Float64Array {
  const explicit = node.getMatrix();
  if (explicit) return new Float64Array(explicit);

  const t = node.getTranslation();
  const r = node.getRotation();
  const s = node.getScale();
  const qx = r[0], qy = r[1], qz = r[2], qw = r[3];
  const tx = t[0], ty = t[1], tz = t[2];
  const sx = s[0], sy = s[1], sz = s[2];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, xw = qx * qw;
  const yz = qy * qz, yw = qy * qw, zw = qz * qw;

  return new Float64Array([
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + zw)) * sx, (2 * (xz - yw)) * sx, 0,
    (2 * (xy - zw)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + xw)) * sy, 0,
    (2 * (xz + yw)) * sz, (2 * (yz - xw)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

function computeMeshBbox(mesh: Mesh): Box3 {
  let merged: Box3 | null = null;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const minArr = pos.getMin([]);
    const maxArr = pos.getMax([]);
    if (!minArr || !maxArr) continue;
    const min: [number, number, number] = [minArr[0] ?? 0, minArr[1] ?? 0, minArr[2] ?? 0];
    const max: [number, number, number] = [maxArr[0] ?? 0, maxArr[1] ?? 0, maxArr[2] ?? 0];
    const box = createBox3(min, max);
    merged = merged ? mergeBboxes([merged, box]) : box;
  }
  return merged ?? createBox3([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]);
}
