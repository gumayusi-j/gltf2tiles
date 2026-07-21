import type { TileNode, ImplicitTilingConfig, Box3 } from '../types.js';
import { bboxToTilesetBox, leafGeometricError } from '../spatial/bbox.js';
import { CoordinateTransform } from '../coord/transform.js';
import { info, debug } from '../util/log.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

// ── Constants ────────────────────────────────────────────

const SUBTREE_MAGIC = 'subtree';
const SUBTREE_HEADER_SIZE = 28;

// ── Types ────────────────────────────────────────────────

export interface SubtreeAvailability {
  isConstant: boolean;
  constantValue: number;
  /** Number of bits in the tile/content availability bitstreams */
  length: number;
  /** Bitstream data (packed into bytes, MSB first) */
  buffer: Uint8Array | null;
}

export interface SubtreeResult {
  tilesetJson: Record<string, unknown>;
  /** Generated subtree files: (level, x, y, Buffer)[] */
  subtreeFiles: Array<{ level: number; x: number; y: number; data: Buffer }>;
}

// ── Public API ───────────────────────────────────────────

/**
 * Build a complete 3D Tiles 1.1 implicit tileset from an octree.
 *
 * Generates:
 *  - tileset.json with implicitTiling root + template URIs
 *  - subtree binary files for all root quadtree/octree nodes
 */
export function buildImplicitTileset(
  root: TileNode,
  config: ImplicitTilingConfig,
  geodetic?: { longitude: number; latitude: number; height: number },
  enableDepth = 2, // subtree depth to materialise
): SubtreeResult {
  const box = bboxToTilesetBox(root.bbox);

  const rootJson: Record<string, unknown> = {
    boundingVolume: { box },
    geometricError: root.geometricError,
    refine: 'REPLACE',
    content: { uri: '{level}/{x}/{y}.glb' },
    implicitTiling: {
      subdivisionScheme: config.subdivisionScheme,
      subtreeLevels: config.subtreeLevels,
      availableLevels: config.availableLevels,
    },
    subtree: { uri: 'subtrees/{level}/{x}/{y}.subtree' },
  };

  if (geodetic) {
    const ct = new CoordinateTransform(geodetic.longitude, geodetic.latitude, geodetic.height);
    rootJson.transform = Array.from(ct.enuToEcefMatrix());
  }

  // ── Generate subtree files from the octree ──────────
  const subtreeFiles: SubtreeResult['subtreeFiles'] = [];

  // The root subtree (level 0, x=0, y=0) contains availability
  // for tiles in levels 0..subtreeLevels-1
  generateSubtreeFiles(root, 0, 0, 0, enableDepth, config.subdivisionScheme, subtreeFiles);

  info(`  ∟ Generated ${subtreeFiles.length} subtree file(s)`);

  return {
    tilesetJson: {
      asset: {
        version: '1.1',
        gltfUpAxis: 'Y',
        generator: 'gltf2tiles v0.1.0',
      },
      geometricError: root.geometricError,
      root: rootJson,
    },
    subtreeFiles,
  };
}

// ── Subtree generation ───────────────────────────────────

/**
 * Recursively generate subtree files for a TileNode tree.
 *
 * For each subtree, we compute:
 *  - tileAvailability: which tiles in the subtree grid are present
 *  - contentAvailability: which tiles have GLB content
 *  - childSubtreeAvailability: which tiles have further subtree files
 */
function generateSubtreeFiles(
  node: TileNode,
  level: number,
  x: number,
  y: number,
  maxLevel: number,
  scheme: string,
  output: SubtreeResult['subtreeFiles'],
): void {
  if (level >= maxLevel) return;

  // Build a map of child positions for quick lookup
  const childMap = new Map<string, TileNode>();
  for (const child of node.children) {
    // Parse the tile id to extract child position
    const pos = tilePosition(child.id, level + 1);
    if (pos) childMap.set(`${pos.x},${pos.y},${pos.z}`, child);
  }

  // Total tiles in this subtree = 4^levels (QUADTREE) or 8^levels (OCTREE)
  const subspaceLen = scheme === 'QUADTREE' ? 2 : 2;
  const leafCount = Math.pow(
    scheme === 'QUADTREE' ? 4 : 8,
    maxLevel - level - 1,
  );

  // Generate availability bitstreams
  // For simplicity, we traverse the tree and set bits.
  // A real implementation would pack bits into Uint8Array.

  // tileAvailability: which tiles in this subtree range exist
  const tileAvail: number[] = [];
  // contentAvailability: which tiles have leaf content (GLB files)
  const contentAvail: number[] = [];
  // child subtree: which tiles have further subtree
  const childAvail: number[] = [];

  for (let cz = 0; cz < subspaceLen; cz++) {
    for (let cy = 0; cy < subspaceLen; cy++) {
      for (let cx = 0; cx < subspaceLen; cx++) {
        const key = `${x * 2 + cx},${y * 2 + cy},${cz}`;
        const child = childMap.get(key);
        const exists = child !== undefined && (child.instances.length > 0 || child.children.length > 0);
        const hasContent = child !== undefined && child.instances.length > 0;
        const hasSubtree = child !== undefined && child.children.length > 0 && level + 1 < maxLevel;

        tileAvail.push(exists ? 1 : 0);
        contentAvail.push(hasContent ? 1 : 0);
        childAvail.push(hasSubtree ? 1 : 0);

        // Recurse for child subtrees
        if (hasSubtree) {
          generateSubtreeFiles(child, level + 1, x * 2 + cx, y * 2 + cy, maxLevel, scheme, output);
        }
      }
    }
  }

  // Pack availability into binary bitstream
  const tileBuf = packBits(tileAvail);
  const contentBuf = packBits(contentAvail);
  const childBuf = packBits(childAvail);

  // Check if all are constant 1 or 0
  const allOnes = (a: number[]) => a.every(v => v === 1);
  const allZeros = (a: number[]) => a.every(v => v === 0);

  function makeAvail(arr: number[], buf: Uint8Array): SubtreeAvailability {
    if (allOnes(arr)) return { isConstant: true, constantValue: 1, length: arr.length, buffer: null };
    if (allZeros(arr)) return { isConstant: true, constantValue: 0, length: arr.length, buffer: null };
    return { isConstant: false, constantValue: 0, length: arr.length, buffer: buf };
  }

  const subtreeData = encodeSubtree({
    tile: makeAvail(tileAvail, tileBuf),
    content: [makeAvail(contentAvail, contentBuf)],
    childSubtree: makeAvail(childAvail, childBuf),
  });

  output.push({ level, x, y, data: subtreeData });
}

// ── Subtree binary encoding ─────────────────────────────

interface EncodedAvail {
  tile: SubtreeAvailability;
  content: SubtreeAvailability[];
  childSubtree: SubtreeAvailability;
}

function encodeSubtree(avail: EncodedAvail): Buffer {
  const json: Record<string, unknown> = {};

  json.tileAvailability = avail.tile.isConstant
    ? { constant: avail.tile.constantValue }
    : { bitstream: 0, availableCount: avail.tile.length };

  json.contentAvailability = avail.content.map(c => c.isConstant
    ? { constant: c.constantValue }
    : { bitstream: 0, availableCount: c.length },
  );

  json.childSubtreeAvailability = avail.childSubtree.isConstant
    ? { constant: avail.childSubtree.constantValue }
    : { bitstream: 0, availableCount: avail.childSubtree.length };

  const jsonStr = JSON.stringify(json);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');

  // Concatenate binary buffers
  const binaryParts: Buffer[] = [];
  let binaryLength = 0;

  if (!avail.tile.isConstant && avail.tile.buffer) {
    binaryParts.push(Buffer.from(avail.tile.buffer));
    binaryLength += avail.tile.buffer.length;
  }
  for (const c of avail.content) {
    if (!c.isConstant && c.buffer) {
      binaryParts.push(Buffer.from(c.buffer));
      binaryLength += c.buffer.length;
    }
  }
  if (!avail.childSubtree.isConstant && avail.childSubtree.buffer) {
    binaryParts.push(Buffer.from(avail.childSubtree.buffer));
    binaryLength += avail.childSubtree.buffer.length;
  }

  const binaryBuf = Buffer.concat(binaryParts);

  // Pad JSON to 8-byte boundary
  const jsonPadding = (8 - (jsonBuf.length % 8)) % 8;
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(jsonPadding, ' ')]);

  // Header
  const header = Buffer.alloc(SUBTREE_HEADER_SIZE);
  header.write(SUBTREE_MAGIC, 0, 8, 'utf8');
  header.writeUInt32LE(1, 8);
  header.writeBigUInt64LE(BigInt(jsonPadded.length), 12);
  header.writeBigUInt64LE(BigInt(binaryBuf.length), 20);

  return Buffer.concat([header, jsonPadded, binaryBuf]);
}

// ── Utility ──────────────────────────────────────────────

/**
 * Pack an array of 0/1 bits into a Uint8Array (MSB-first).
 */
function packBits(bits: number[]): Uint8Array {
  const byteCount = Math.ceil(bits.length / 8);
  const buf = new Uint8Array(byteCount);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      buf[Math.floor(i / 8)]! |= (1 << (7 - (i % 8)));
    }
  }
  return buf;
}

/**
 * Extract child tile position from a tile id like "0_0_1".
 * The last numeric segment z is always 0 for quadtree.
 */
function tilePosition(
  id: string,
  currentLevel: number,
): { x: number; y: number; z: number } | null {
  const parts = id.split('_').map(Number);
  if (parts.length < currentLevel + 1) return null;
  // The last part varies.
  // For octree, parts at depth d are the index (0-7) at that level.
  // We reconstruct x,y,z from the last segment.
  const idx = parts[parts.length - 1]!;
  // Since the octree splits into 8: indices 0-7
  // Convert index to (x,y,z) where each is 0 or 1
  const z = Math.floor(idx / 4);
  const y = Math.floor((idx % 4) / 2);
  const x = idx % 2;
  return { x, y, z };
}

// ── Writer ───────────────────────────────────────────────

export async function writeSubtreeFile(
  outputDir: string,
  level: number,
  x: number,
  y: number,
  data: Buffer,
): Promise<void> {
  const subDir = path.join(outputDir, 'subtrees', String(level), String(x));
  await fs.mkdir(subDir, { recursive: true });
  const outPath = path.join(subDir, `${y}.subtree`);
  await fs.writeFile(outPath, data);
  debug(`  ∟ Subtree: ${outPath}`);
}
