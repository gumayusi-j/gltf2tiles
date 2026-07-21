import type { Document } from '@gltf-transform/core';
import type { PipelineOptions, PipelineResult, GlbInstance, TileNode } from './types.js';
import { readGlb } from './glb/reader.js';
import { buildTileDocument, optimizeDocument, writeTileLODs, writeTileGlb } from './glb/writer.js';
import { flattenScene } from './scene/flatten.js';
import { buildOctree, countTiles, collectLeaves } from './spatial/octree.js';
import { mergeBboxes, computeGeometricError, bboxToTilesetBox } from './spatial/bbox.js';
import { generateTilesetJson } from './tileset/tileset-1.1.js';
import { generateTileLODs, generateLODTilesetJson } from './lod/generator.js';
import { buildImplicitTileset, writeSubtreeFile } from './tileset/implicit.js';
import { info } from './util/log.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  info('═══════════════════════════════════════════');
  info('GLB → 3D Tiles 1.1 Pipeline');
  info('═══════════════════════════════════════════');
  info(`Input:  ${opts.input}`);
  info(`Output: ${opts.output}`);
  info(`Max items/tile: ${opts.maxItemsPerTile}, Max depth: ${opts.maxDepth}`);
  if (opts.lodConfig.levels.length > 1) info(`LOD levels: ${opts.lodConfig.levels.length}`);
  if (opts.dracoConfig) info('Draco: ON');
  if (opts.enableTextureCompress) info('KTX2: ON');
  if (opts.tilesetConfig.implicitTiling) info('Implicit tiling: ON');

  // ── 1. Read GLB ──────────────────────────────────────
  info('Phase 1/5: Reading GLB...');
  const doc: Document = await readGlb(opts.input);

  // ── 2. Flatten scene ─────────────────────────────────
  info('Phase 2/5: Flattening scene...');
  const instances: GlbInstance[] = flattenScene(doc);
  if (instances.length === 0) throw new Error('No meshes found in input file');
  info(`  ∟ ${instances.length} instance(s) extracted`);

  // ── 3. Spatial partitioning ──────────────────────────
  info('Phase 3/5: Spatial partitioning...');
  let root: TileNode;
  if (instances.length <= opts.maxItemsPerTile) {
    const globalBbox = mergeBboxes(instances.map(i => i.worldBbox));
    root = {
      id: '0', depth: 0, bbox: globalBbox,
      geometricError: 0, instances: [...instances], children: [], refine: 'REPLACE',
    };
    computeGeometricError(root);
    info('  ∟ Single tile (no subdivision)');
  } else {
    root = buildOctree(instances, opts.maxItemsPerTile, opts.maxDepth);
    info(`  ∟ ${countTiles(root)} tile(s) in octree`);
  }

  // ── 4. Generate LOD & write tile GLBs ─────────────────
  info('Phase 4/5: Generating LOD & writing GLBs...');
  const tileDir = opts.output;
  await fs.mkdir(tileDir, { recursive: true });
  let totalTriangles = 0;
  let totalVertices = 0;
  let tilesWritten = 0;

  const leaves = collectLeaves(root);

  if (opts.lodConfig.levels.length > 1) {
    // ── LOD mode: generate multiple detail levels per tile ──
    info(`  LOD mode: ${opts.lodConfig.levels.length} levels`);
    for (const leaf of leaves) {
      if (leaf.instances.length === 0) continue;

      // Build base document
      const baseDoc = buildTileDocument(leaf.instances, doc);
      await optimizeDocument(baseDoc);

      // Generate LODs
      const lodDocs = await generateTileLODs(baseDoc, opts.lodConfig);

      // Write all LOD files
      const results = await writeTileLODs(lodDocs, tileDir, leaf.id);
      for (const r of results) {
        totalTriangles += r.triangleCount;
        totalVertices += r.vertexCount;
      }
      tilesWritten++;

      // Replace leaf content with LOD-nested tileset JSON
      const box = bboxToTilesetBox(leaf.bbox);
      const baseError = leaf.geometricError;
      const { rootJson } = generateLODTilesetJson(
        leaf.id, box, opts.lodConfig.levels.length, baseError,
      );
      leaf.lodTree = rootJson;
    }
  } else {
    // ── Single LOD mode: simple GLB write ──
    for (const leaf of leaves) {
      if (leaf.instances.length === 0) continue;
      const result = await writeTileGlb(leaf.instances, tileDir, leaf.id, {
        sourceDoc: doc,
        enableDraco: opts.dracoConfig !== undefined,
        dracoConfig: opts.dracoConfig,
        enableTextureCompress: opts.enableTextureCompress,
      });
      totalTriangles += result.triangleCount;
      totalVertices += result.vertexCount;
      tilesWritten++;
    }
  }
  info(`  ∟ ${tilesWritten} tile(s), ${totalTriangles} tris, ${totalVertices} verts`);

  // ── 5. Write tileset.json & subtrees ──────────────────
  info('Phase 5/5: Writing tileset.json...');

  if (opts.tilesetConfig.implicitTiling) {
    // ── 3D Tiles 1.1 implicit tiling ──
    const config = opts.tilesetConfig.implicitTiling!;
    const { tilesetJson, subtreeFiles } = buildImplicitTileset(
      root, config,
      opts.tilesetConfig.geodetic,
      config.subtreeLevels,
    );
    const tilesetPath = path.join(opts.output, 'tileset.json');
    await fs.writeFile(tilesetPath, JSON.stringify(tilesetJson, null, 2));

    // Write subtree files
    for (const sf of subtreeFiles) {
      await writeSubtreeFile(opts.output, sf.level, sf.x, sf.y, sf.data);
    }
    info(`  ∟ ${tilesetPath} (implicit)`);
    info(`  ∟ ${subtreeFiles.length} subtree file(s) written`);

    info('═══════════════════════════════════════════');
    info(`Pipeline complete: ${tilesWritten} tiles, ${totalTriangles} triangles (implicit tiling)`);
    info('═══════════════════════════════════════════');

    return { tileCount: tilesWritten, totalTriangles, totalVertices, implicit: true };
  } else {
    // ── Explicit tileset (3D Tiles 1.0/1.1) ──
    // LOD trees were already embedded in leaf nodes during Phase 4.
    const tileset = generateTilesetJson({
      config: opts.tilesetConfig,
      root,
      outputDir: opts.output,
    });

    const tilesetPath = path.join(opts.output, 'tileset.json');
    await fs.writeFile(tilesetPath, JSON.stringify(tileset, null, 2));
    info(`  ∟ ${tilesetPath} (explicit)`);

    info('═══════════════════════════════════════════');
    info(`Pipeline complete: ${tilesWritten} tiles, ${totalTriangles} triangles`);
    info('═══════════════════════════════════════════');

    return { tileCount: tilesWritten, totalTriangles, totalVertices, implicit: false };
  }
}
