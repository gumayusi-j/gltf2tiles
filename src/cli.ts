#!/usr/bin/env node

import { Command } from 'commander';
import { runPipeline } from './index.js';
import { setLogLevel, LogLevel, info, error } from './util/log.js';
import { DEFAULTS } from './constants.js';
import type { PipelineOptions } from './types.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const program = new Command();

program.name('gltf2tiles').description('Convert GLB/glTF to 3D Tiles 1.1').version('0.2.0');

program.requiredOption('-i, --input <path>', 'Input GLB/glTF file');
program.requiredOption('-o, --output <dir>', 'Output directory');
program.option('--max-items <number>', 'Max instances per tile', String(DEFAULTS.maxItemsPerTile));
program.option('--max-depth <number>', 'Octree max depth', String(DEFAULTS.maxDepth));
program.option('--lon <degrees>', 'Longitude');
program.option('--lat <degrees>', 'Latitude');
program.option('--alt <meters>', 'Altitude', '0');
program.option('--lod-levels <number>', 'LOD levels', String(DEFAULTS.lodLevels));
program.option('--simplify-ratio <ratio>', 'Simplify ratio', String(DEFAULTS.simplifyRatio));
program.option('--simplify-error <error>', 'Simplify error', String(DEFAULTS.simplifyError));
program.option('--implicit', 'Enable 3D Tiles 1.1 implicit tiling');
program.option('--subdivision <scheme>', 'QUADTREE or OCTREE', 'OCTREE');
program.option('--subtree-levels <n>', 'Subtree levels', String(DEFAULTS.subtreeLevels));
program.option('--draco', 'Enable Draco compression');
program.option('--ktx2', 'Enable KTX2 texture compression');
program.option('--ktx2-format <format>', 'KTX2 format: etc1s|uastc', 'etc1s');
program.option('--ktx2-quality <n>', 'KTX2 quality 1-255', String(DEFAULTS.ktx2Quality));
program.option('--ktx2-mipmaps', 'Generate mipmaps');
program.option('-v, --verbose', 'Verbose logging');

program.parse(process.argv);
const args = program.opts();

async function main(): Promise<void> {
  setLogLevel(args.verbose ? LogLevel.Debug : LogLevel.Info);

  const inputPath = path.resolve(args.input);
  try { await fs.access(inputPath); }
  catch { error(`Input not found: ${inputPath}`); process.exit(1); }

  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.glb' && ext !== '.gltf') {
    error(`Unsupported format: ${ext}. Expected .glb or .gltf`);
    process.exit(1);
  }

  const lodLevels = parseInt(args.lodLevels, 10);
  const simplifyRatio = parseFloat(args.simplifyRatio);
  const simplifyError = parseFloat(args.simplifyError);

  const opts: PipelineOptions = {
    input: inputPath,
    output: path.resolve(args.output),
    maxItemsPerTile: parseInt(args.maxItems, 10),
    maxDepth: parseInt(args.maxDepth, 10),
    lodConfig: {
      levels: Array.from({ length: lodLevels }, (_, i) => ({
        ratio: Math.pow(simplifyRatio, i),
        error: simplifyError * Math.pow(2, i),
        draco: i > 0 && !!args.draco,
      })),
    },
    dracoConfig: args.draco ? { positionBits: 11, normalBits: 10, texcoordBits: 12 } : undefined,
    enableTextureCompress: !!args.ktx2,
    textureCompressConfig: args.ktx2 ? {
      format: args.ktx2Format as 'etc1s' | 'uastc',
      quality: parseInt(args.ktx2Quality, 10),
      generateMipmaps: !!args.ktx2Mipmaps,
    } : undefined,
    tilesetConfig: {
      geodetic: args.lon !== undefined ? { longitude: parseFloat(args.lon), latitude: parseFloat(args.lat), height: parseFloat(args.alt ?? '0') } : undefined,
      implicitTiling: args.implicit ? { subdivisionScheme: (args.subdivision as string).toUpperCase() === 'QUADTREE' ? 'QUADTREE' : 'OCTREE', subtreeLevels: parseInt(args.subtreeLevels, 10), availableLevels: parseInt(args.maxDepth, 10) } : undefined,
    },
    verbose: !!args.verbose,
  };

  try {
    const result = await runPipeline(opts);
    info(`Done. ${result.tileCount} tiles generated.`);
    process.exit(0);
  } catch (err) {
    error(`Pipeline failed: ${(err as Error).message}`);
    if (args.verbose) console.error(err);
    process.exit(1);
  }
}

main();
