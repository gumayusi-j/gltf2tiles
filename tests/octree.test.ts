import { describe, it, expect } from 'vitest';
import { buildOctree, countTiles, collectLeaves } from '../src/spatial/octree.js';
import type { GlbInstance } from '../src/types.js';

function makeInstance(id: number, x: number, y: number, z: number): GlbInstance {
  const bbox = { min: [x - 0.5, y - 0.5, z - 0.5] as [number, number, number], max: [x + 0.5, y + 0.5, z + 0.5] as [number, number, number] };
  return {
    id, name: `inst_${id}`,
    worldMatrix: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
    localBbox: bbox, worldBbox: bbox,
    mesh: { getName: () => 'mesh' } as never,
    material: null,
  };
}

describe('buildOctree', () => {
  it('single instance → single leaf', () => {
    const root = buildOctree([makeInstance(0, 0, 0, 0)], 10, 8);
    expect(root.instances).toHaveLength(1);
    expect(root.children).toHaveLength(0);
    expect(root.geometricError).toBeGreaterThan(0);
  });

  it('subdivides when over capacity', () => {
    const instances: GlbInstance[] = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        instances.push(makeInstance(instances.length, i * 10, j * 10, 0));
      }
    }
    const root = buildOctree(instances, 5, 4);
    expect(root.children.length).toBeGreaterThan(0);
    expect(root.instances).toHaveLength(0);
  });

  it('leaves have ≤ maxItems', () => {
    const instances: GlbInstance[] = [];
    for (let i = 0; i < 100; i++) {
      instances.push(makeInstance(i, Math.random() * 100, Math.random() * 100, Math.random() * 100));
    }
    const root = buildOctree(instances, 10, 8);
    function check(node: { instances: GlbInstance[]; children: unknown[] }): void {
      if (node.children.length === 0) expect(node.instances.length).toBeLessThanOrEqual(10);
      else for (const c of node.children) check(c as { instances: GlbInstance[]; children: unknown[] });
    }
    check(root);
  });

  it('countTiles + collectLeaves', () => {
    const instances: GlbInstance[] = [];
    for (let i = 0; i < 50; i++) instances.push(makeInstance(i, Math.random() * 100, Math.random() * 100, Math.random() * 100));
    const root = buildOctree(instances, 10, 8);
    expect(countTiles(root)).toBeGreaterThan(0);
    const leaves = collectLeaves(root);
    for (const leaf of leaves) expect(leaf.children).toHaveLength(0);
  });
});
