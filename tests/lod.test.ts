import { describe, it, expect } from 'vitest';
import { buildDefaultLODConfig, generateLODTilesetJson } from '../src/lod/generator.js';

describe('buildDefaultLODConfig', () => {
  it('creates correct number of levels', () => {
    const config = buildDefaultLODConfig(3);
    expect(config.levels).toHaveLength(3);
  });

  it('ratios decrease exponentially', () => {
    const config = buildDefaultLODConfig(3, 0.5, 0.01);
    expect(config.levels[0]!.ratio).toBe(1.0);
    expect(config.levels[1]!.ratio).toBe(0.5);
    expect(config.levels[2]!.ratio).toBe(0.25);
  });

  it('errors increase exponentially', () => {
    const config = buildDefaultLODConfig(3, 0.5, 0.01);
    expect(config.levels[0]!.error).toBe(0.01);
    expect(config.levels[1]!.error).toBe(0.02);
    expect(config.levels[2]!.error).toBe(0.04);
  });

  it('Draco enabled for LOD > 0', () => {
    const config = buildDefaultLODConfig(3);
    expect(config.levels[0]!.draco).toBe(false);
    expect(config.levels[1]!.draco).toBe(true);
    expect(config.levels[2]!.draco).toBe(true);
  });
});

describe('generateLODTilesetJson', () => {
  const bbox = [5, 5, 5, 5, 0, 0, 0, 5, 0, 0, 0, 5];

  it('generates nested LOD chain with correct structure', () => {
    const { rootJson, rootError } = generateLODTilesetJson('0', bbox, 3, 100);
    expect(rootJson.content).toBeDefined();
    expect((rootJson.content as Record<string, unknown>).uri).toContain('_lod2');
    expect(rootJson.children).toBeDefined();

    const child1 = (rootJson.children as Record<string, unknown>[])[0]!;
    expect(child1.content).toBeDefined();
    expect((child1.content as Record<string, unknown>).uri).toContain('_lod1');

    const child2 = (child1.children as Record<string, unknown>[])[0]!;
    expect(child2.content).toBeDefined();
    expect((child2.content as Record<string, unknown>).uri).toContain('_lod0');
    expect(child2.children).toBeUndefined();
  });

  it('rootError equals coarsest level geometricError', () => {
    const { rootError } = generateLODTilesetJson('0', bbox, 3, 100);
    expect(rootError).toBe(400);
  });

  it('handles single LOD level', () => {
    const { rootJson } = generateLODTilesetJson('0', bbox, 1, 50);
    expect(rootJson.content).toBeDefined();
    expect((rootJson.content as Record<string, unknown>).uri).toContain('_lod0');
    expect(rootJson.children).toBeUndefined();
  });
});
