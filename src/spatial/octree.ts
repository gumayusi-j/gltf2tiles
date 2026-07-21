import type { GlbInstance, TileNode } from '../types.js';
import { mergeBboxes, splitOctree, pointInBox, computeGeometricError, boxCenter } from './bbox.js';

/**
 * Build an octree from a flat list of instances.
 *
 * Mirrors FBXPipeline::buildOctree() from the 3dtiles C++ project.
 */
export function buildOctree(
  instances: GlbInstance[],
  maxItemsPerTile = 1000,
  maxDepth = 8,
): TileNode {
  const globalBbox = mergeBboxes(instances.map(i => i.worldBbox));
  const root: TileNode = {
    id: '0',
    depth: 0,
    bbox: globalBbox,
    geometricError: 0,
    instances: [...instances],
    children: [],
    refine: 'REPLACE',
  };
  if (instances.length > 0) splitNode(root, maxItemsPerTile, maxDepth);
  computeGeometricError(root);
  return root;
}

function splitNode(node: TileNode, maxItems: number, maxDepth: number): void {
  if (node.depth >= maxDepth || node.instances.length <= maxItems) return;
  const childBoxes = splitOctree(node.bbox);
  const children: TileNode[] = childBoxes.map((box, i) => ({
    id: `${node.id}_${i}`,
    depth: node.depth + 1,
    bbox: box,
    geometricError: 0,
    instances: [],
    children: [],
    refine: 'REPLACE',
  }));

  for (const inst of node.instances) {
    const center = boxCenter(inst.worldBbox);
    for (const child of children) {
      if (pointInBox(center, child.bbox)) {
        child.instances.push(inst);
        break;
      }
    }
  }

  for (const child of children) splitNode(child, maxItems, maxDepth);
  node.children = children.filter(c => c.instances.length > 0 || c.children.length > 0);
  node.instances = [];
}

export function countTiles(root: TileNode): number {
  let count = 1;
  for (const child of root.children) count += countTiles(child);
  return count;
}

export function collectLeaves(root: TileNode): TileNode[] {
  if (root.children.length === 0 && root.instances.length > 0) return [root];
  const leaves: TileNode[] = [];
  for (const child of root.children) leaves.push(...collectLeaves(child));
  return leaves;
}

export function collectAtDepth(root: TileNode, depth: number): TileNode[] {
  const nodes: TileNode[] = [];
  function walk(n: TileNode): void {
    if (n.depth === depth) nodes.push(n);
    for (const c of n.children) walk(c);
  }
  walk(root);
  return nodes;
}
