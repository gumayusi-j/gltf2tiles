import { Document, NodeIO } from '@gltf-transform/core';
import { simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { LODConfig, LODLevel } from '../types.js';
import { info, debug } from '../util/log.js';

export { buildDefaultLODConfig, generateTileLODs, generateLODTilesetJson };

/**
 * Build a LODConfig from simple count + parameters.
 * Mirrors lod_pipeline.cpp:build_lod_levels().
 */
function buildDefaultLODConfig(
  levelCount: number,
  baseRatio = 0.5,
  baseError = 0.01,
): LODConfig {
  const levels: LODLevel[] = [];
  for (let i = 0; i < levelCount; i++) {
    levels.push({
      ratio: Math.pow(baseRatio, i),
      error: baseError * Math.pow(2, i),
      draco: i > 0,
    });
  }
  return { levels };
}

/**
 * Deep-clone a Document by round-tripping through binary GLB.
 */
async function cloneDocument(doc: Document): Promise<Document> {
  const io = new NodeIO();
  const buf = await io.writeBinary(doc);
  const cloned = await io.readBinary(buf);
  return cloned;
}

/**
 * Generate LOD level Documents for a tile's base Document.
 *
 * LOD 0 = original (no simplification).
 * LOD 1..N = increasingly simplified copies via meshoptimizer WASM.
 */
async function generateTileLODs(
  doc: Document,
  config: LODConfig,
): Promise<Document[]> {
  const docs: Document[] = [];

  // LOD 0 — original (clone to avoid mutation)
  docs.push(await cloneDocument(doc));

  for (let i = 1; i < config.levels.length; i++) {
    const level = config.levels[i]!;
    info(`    LOD ${i}: simplify ratio=${level.ratio}, error=${level.error}`);

    const cloned = await cloneDocument(doc);

    await cloned.transform(
      weld(),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: level.ratio,
        error: level.error,
      }),
    );

    debug(`      LOD ${i}: meshes=${cloned.getRoot().listMeshes().length}`);
    docs.push(cloned);
  }

  return docs;
}

/**
 * Build nested tileset JSON for a single tile's LOD chain.
 *
 * Nesting: coarsest (lod_N) → ... → finest (lod_0).
 */
function generateLODTilesetJson(
  tileId: string,
  bbox: number[],
  levelCount: number,
  baseError: number,
): { rootJson: Record<string, unknown>; rootError: number } {
  const nodes: Record<string, unknown>[] = [];
  for (let i = 0; i < levelCount; i++) {
    const error = baseError * Math.pow(2, levelCount - 1 - i);
    nodes.push({
      geometricError: error,
      boundingVolume: { box: bbox },
      content: { uri: `./${tileId}_lod${levelCount - 1 - i}.glb` },
    });
  }

  let chain = nodes[nodes.length - 1]!;
  for (let i = nodes.length - 2; i >= 0; i--) {
    const parent = { ...nodes[i] };
    parent.children = [chain];
    chain = parent;
  }

  return { rootJson: chain as Record<string, unknown>, rootError: (chain.geometricError as number) || baseError };
}
