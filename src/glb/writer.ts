import type { GlbInstance, DracoConfig } from '../types.js';
import { writeGlb } from './reader.js';
import { debug } from '../util/log.js';
import { Document, Accessor, Mesh, Material } from '@gltf-transform/core';

let _uuidCounter = 0;
function uuid(): string { return `${++_uuidCounter}`; }
import { dedup, join, prune, draco, textureCompress } from '@gltf-transform/functions';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export interface TileWriteResult {
  filePath: string;
  triangleCount: number;
  vertexCount: number;
}

export interface TileWriteOptions {
  enableDraco?: boolean;
  dracoConfig?: DracoConfig;
  enableTextureCompress?: boolean;
  sourceDoc?: Document;
}

/**
 * Build a new Document for a tile, properly copying mesh data
 * from the source Document. gltf-transform does NOT allow sharing
 * objects between Documents, so we deep-copy accessor arrays.
 */
export function buildTileDocument(
  instances: GlbInstance[],
  sourceDoc: Document,
): Document {
  const doc = new Document();
  // Create a default buffer for accessor data storage
  doc.createBuffer();
  const scene = doc.createScene();
  const matCache = new Map<string, Material>();

  for (const inst of instances) {
    const node = doc.createNode(inst.name);
    const m = inst.worldMatrix;
    node.setMatrix([
      m[0], m[1], m[2], m[3],
      m[4], m[5], m[6], m[7],
      m[8], m[9], m[10], m[11],
      m[12], m[13], m[14], m[15],
    ]);
    const srcMesh = inst.mesh;
    if (srcMesh) {
      const newMesh = copyMesh(doc, srcMesh, matCache);
      node.setMesh(newMesh);
    }
    scene.addChild(node);
  }
  return doc;
}

// ── Deep copy mesh across Documents ─────────────────────

function copyMesh(
  targetDoc: Document,
  source: Mesh,
  matCache: Map<string, Material>,
): Mesh {
  const mesh = targetDoc.createMesh(source.getName() || 'mesh');
  for (const src of source.listPrimitives()) {
    const prim = targetDoc.createPrimitive();
    prim.setMode(src.getMode());

    // Copy known vertex attributes
    const attrNames = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1',
      'JOINTS_0', 'WEIGHTS_0', 'COLOR_0', 'TANGENT'];
    for (const name of attrNames) {
      const acc = src.getAttribute(name);
      if (acc) prim.setAttribute(name, copyAccessor(targetDoc, acc));
    }
    const idx = src.getIndices();
    if (idx) prim.setIndices(copyAccessor(targetDoc, idx));

    const srcMat = src.getMaterial();
    if (srcMat) {
      const key = srcMat.getName() || `mat_${uuid()}`;
      let dst = matCache.get(key);
      if (!dst) {
        dst = targetDoc.createMaterial(srcMat.getName() || 'mat');
        try { dst.setBaseColorFactor(srcMat.getBaseColorFactor()); } catch {}
        try { dst.setMetallicFactor(srcMat.getMetallicFactor()); } catch {}
        try { dst.setRoughnessFactor(srcMat.getRoughnessFactor()); } catch {}
        try { dst.setDoubleSided(srcMat.getDoubleSided()); } catch {}
        matCache.set(key, dst);
      }
      prim.setMaterial(dst);
    }
    mesh.addPrimitive(prim);
  }
  return mesh;
}

function copyAccessor(targetDoc: Document, source: Accessor): Accessor {
  const acc = targetDoc.createAccessor();
  const arr = source.getArray();
  if (arr) {
    const Ctor = arr.constructor as new (n: number) => typeof arr;
    const copy = new Ctor(arr.length);
    copy.set(arr);
    acc.setArray(copy);
  }
  acc.setType(source.getType());
  return acc;
}

// ── Optimisation ────────────────────────────────────────

export async function optimizeDocument(doc: Document): Promise<void> {
  await doc.transform(dedup(), join({ keepMeshes: false }), prune());
}

async function maybeApplyDraco(doc: Document, opts?: TileWriteOptions): Promise<void> {
  if (!opts?.enableDraco) return;
  const dc = opts.dracoConfig;
  await doc.transform(draco({
    quantizePosition: dc?.positionBits ?? 11,
    quantizeNormal: dc?.normalBits ?? 10,
    quantizeTexcoord: dc?.texcoordBits ?? 12,
    quantizeGeneric: 8,
  }));
  debug('  ∟ Applied Draco');
}

async function maybeApplyTextureCompress(doc: Document, opts?: TileWriteOptions): Promise<void> {
  if (!opts?.enableTextureCompress) return;
  await doc.transform(textureCompress({}));
  debug('  ∟ Applied KTX2');
}

// ── Write single tile ───────────────────────────────────

export async function writeTileGlb(
  instances: GlbInstance[],
  outputDir: string,
  tileName: string,
  options?: TileWriteOptions,
): Promise<TileWriteResult> {
  const sourceDoc = options?.sourceDoc;
  if (!sourceDoc) throw new Error('sourceDoc required');
  const doc = buildTileDocument(instances, sourceDoc);
  await optimizeDocument(doc);
  await maybeApplyDraco(doc, options);
  await maybeApplyTextureCompress(doc, options);
  const outPath = path.join(outputDir, `${tileName}.glb`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await writeGlb(doc, outPath);
  const s = countPrimitives(doc);
  debug(`  ∟ ${outPath} (${s.triCount} tris, ${s.vertCount} verts)`);
  return { filePath: outPath, triangleCount: s.triCount, vertexCount: s.vertCount };
}

// ── Write LOD tiles ─────────────────────────────────────

export async function writeTileLODs(
  docs: Document[],
  outputDir: string,
  tileId: string,
): Promise<TileWriteResult[]> {
  const results: TileWriteResult[] = [];
  for (let i = 0; i < docs.length; i++) {
    const name = `${tileId}_lod${i}`;
    const outPath = path.join(outputDir, `${name}.glb`);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await writeGlb(docs[i]!, outPath);
    const s = countPrimitives(docs[i]!);
    debug(`  ∟ ${outPath} (LOD ${i}: ${s.triCount} tris, ${s.vertCount} verts)`);
    results.push({ filePath: outPath, triangleCount: s.triCount, vertexCount: s.vertCount });
  }
  return results;
}

function countPrimitives(doc: Document): { triCount: number; vertCount: number } {
  let tri = 0, vert = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      if (pos) vert += pos.getCount();
      const idx = p.getIndices();
      if (idx) tri += Math.floor(idx.getCount() / 3);
    }
  }
  return { triCount: tri, vertCount: vert };
}
