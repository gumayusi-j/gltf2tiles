import { describe, it, expect } from 'vitest';
import { buildImplicitTileset } from '../src/tileset/implicit.js';
import type { TileNode } from '../src/types.js';

describe('buildImplicitTileset', () => {
  const root: TileNode = {
    id: '0', depth: 0,
    bbox: { min: [0, 0, 0], max: [100, 100, 50] },
    geometricError: 500,
    instances: [], children: [], refine: 'REPLACE',
  };

  it('generates tileset with implicitTiling property', () => {
    const result = buildImplicitTileset(
      root,
      { subdivisionScheme: 'QUADTREE', subtreeLevels: 5, availableLevels: 10 },
    );
    const ts = result.tilesetJson;
    expect((ts.asset as Record<string, unknown>).version).toBe('1.1');
    const rt = ts.root as Record<string, unknown>;
    expect(rt.implicitTiling).toBeDefined();
    expect((rt.implicitTiling as Record<string, unknown>).subdivisionScheme).toBe('QUADTREE');
    expect(rt.content).toBeDefined();
    expect((rt.content as Record<string, unknown>).uri).toContain('{level}');
    expect(rt.subtree).toBeDefined();
  });

  it('includes transform with geodetic data', () => {
    const result = buildImplicitTileset(
      root,
      { subdivisionScheme: 'OCTREE', subtreeLevels: 4, availableLevels: 8 },
      { longitude: 120, latitude: 30, height: 0 },
    );
    const rt = result.tilesetJson.root as Record<string, unknown>;
    expect(rt.transform).toBeDefined();
    expect((rt.transform as number[]).length).toBe(16);
  });

  it('generates subtree files', () => {
    const rootWithChildren: TileNode = {
      id: '0', depth: 0,
      bbox: { min: [0, 0, 0], max: [100, 100, 50] },
      geometricError: 500,
      instances: [],
      children: [
        {
          id: '0_0', depth: 1,
          bbox: { min: [0, 0, 0], max: [50, 50, 25] },
          geometricError: 100, instances: [{
            id: 1, name: 'test',
            worldMatrix: new Float64Array(16),
            localBbox: { min: [0, 0, 0], max: [1, 1, 1] },
            worldBbox: { min: [0, 0, 0], max: [1, 1, 1] },
            mesh: { getName: () => 'm' } as never,
            material: null,
          }],
          children: [], refine: 'REPLACE',
        },
      ],
      refine: 'REPLACE',
    };

    const result = buildImplicitTileset(
      rootWithChildren,
      { subdivisionScheme: 'OCTREE', subtreeLevels: 3, availableLevels: 6 },
      undefined,
      2, // enableDepth
    );
    // Should have at least the root subtree
    expect(result.subtreeFiles.length).toBeGreaterThanOrEqual(1);

    // Check root subtree binary
    const rootSubtree = result.subtreeFiles[0]!;
    expect(rootSubtree.level).toBe(0);
    expect(rootSubtree.data.slice(0, 7).toString('utf8')).toBe('subtree');
    expect(rootSubtree.data.readUInt32LE(8)).toBe(1); // version
  });
});
