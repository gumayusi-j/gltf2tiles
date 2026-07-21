import type { TileNode, Tileset11Config } from '../types.js';
import { bboxToTilesetBox } from '../spatial/bbox.js';
import { CoordinateTransform } from '../coord/transform.js';

export interface TilesetOptions {
  config: Tileset11Config;
  root: TileNode;
  outputDir: string;
}

/**
 * Generate a 3D Tiles 1.1 tileset.json object.
 *
 * Handles both simple flat tiles and LOD-nested tile trees.
 * If a TileNode has a `lodTree`, that LOD structure is embedded instead
 * of a flat content reference.
 */
export function generateTilesetJson(opts: TilesetOptions): Record<string, unknown> {
  const { config, root } = opts;
  const rootJson = buildTileJson(root, config);
  return {
    asset: {
      version: '1.1',
      gltfUpAxis: 'Y',
      generator: 'gltf2tiles v0.1.0',
    },
    geometricError: root.geometricError,
    root: rootJson,
  };
}

function buildTileJson(node: TileNode, config: Tileset11Config): Record<string, unknown> {
  const box = bboxToTilesetBox(node.bbox);
  const tile: Record<string, unknown> = {
    boundingVolume: { box },
    geometricError: node.geometricError,
    refine: node.refine,
  };

  // ── If node has a LOD tree, embed it instead of flat content ──
  if (node.lodTree) {
    // LOD tree already contains geometricError, boundingVolume, content, children
    Object.assign(tile, node.lodTree);
  } else if (node.children.length === 0 && node.instances.length > 0) {
    // Flat leaf tile: simple content reference
    tile.content = { uri: `./${node.id}.glb` };
  }

  // ── Geodetic transform (on root only, but we check depth for safety) ──
  if (config.geodetic && node.depth === 0) {
    const ct = new CoordinateTransform(
      config.geodetic.longitude,
      config.geodetic.latitude,
      config.geodetic.height,
    );
    tile.transform = Array.from(ct.enuToEcefMatrix());
  }

  // ── Child tiles (only if no LOD tree and has children) ──
  if (!node.lodTree && node.children.length > 0) {
    tile.children = node.children.map(c => buildTileJson(c, config));
  }

  return tile;
}
