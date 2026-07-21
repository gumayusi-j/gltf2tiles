import { describe, it, expect } from 'vitest';
import { generateTilesetJson } from '../src/tileset/tileset-1.1.js';
import type { TileNode } from '../src/types.js';

function makeTileNode(over?: Partial<TileNode>): TileNode {
  return { id: '0', depth: 0, bbox: { min: [0, 0, 0], max: [10, 10, 10] }, geometricError: 100, instances: [], children: [], refine: 'REPLACE', ...over };
}

describe('generateTilesetJson', () => {
  it('asset.version = "1.1"', () => {
    const ts = generateTilesetJson({ config: {}, root: makeTileNode(), outputDir: '' });
    expect((ts.asset as Record<string, unknown>).version).toBe('1.1');
  });

  it('includes boundingVolume.box', () => {
    const ts = generateTilesetJson({ config: {}, root: makeTileNode(), outputDir: '' });
    const bv = (ts.root as Record<string, unknown>).boundingVolume as Record<string, unknown>;
    expect(Array.isArray(bv.box)).toBe(true);
    expect((bv.box as number[]).length).toBe(12);
  });

  it('adds content URI for leaf with instances', () => {
    const inst = [{ id: 0, name: 't', worldMatrix: new Float64Array(16), localBbox: { min: [0, 0, 0], max: [1, 1, 1] }, worldBbox: { min: [0, 0, 0], max: [1, 1, 1] }, mesh: { getName: () => 'm' } as never, material: null }];
    const ts = generateTilesetJson({ config: {}, root: makeTileNode({ instances: inst as never[] }), outputDir: '' });
    expect((ts.root as Record<string, unknown>).content).toBeDefined();
  });

  it('includes transform for geodetic config', () => {
    const ts = generateTilesetJson({ config: { geodetic: { longitude: 120, latitude: 30, height: 0 } }, root: makeTileNode(), outputDir: '' });
    expect(Array.isArray((ts.root as Record<string, unknown>).transform)).toBe(true);
    expect(((ts.root as Record<string, unknown>).transform as number[]).length).toBe(16);
  });

  it('builds child tiles', () => {
    const child = makeTileNode({ id: '0_0', depth: 1, geometricError: 50 });
    const ts = generateTilesetJson({ config: {}, root: makeTileNode({ children: [child] }), outputDir: '' });
    expect((ts.root as Record<string, unknown>).children).toBeDefined();
  });
});
