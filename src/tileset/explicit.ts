import type { TileNode } from '../types.js';
import { generateTilesetJson } from './tileset-1.1.js';

/**
 * Generate an explicit (nested children array) tileset.
 * For small-to-medium datasets (≤10,000 tiles).
 */
export function explicitTileset(
  root: TileNode,
  options: { longitude?: number; latitude?: number; height?: number },
): Record<string, unknown> {
  return generateTilesetJson({
    config: {
      geodetic: options.longitude !== undefined
        ? { longitude: options.longitude, latitude: options.latitude!, height: options.height ?? 0 }
        : undefined,
    },
    root,
    outputDir: '',
  });
}
