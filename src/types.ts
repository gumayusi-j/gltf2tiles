import type { Mesh, Material } from '@gltf-transform/core';
import type { mat4 } from 'gl-matrix';

// ── 3D Bounding box ──────────────────────────────────
export interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}

// ── Flattened scene instance ──────────────────────────
export interface GlbInstance {
  id: number;
  name: string;
  worldMatrix: Float64Array;
  localBbox: Box3;
  worldBbox: Box3;
  mesh: Mesh;
  material: Material | null;
}

// ── Octree tile node ──────────────────────────────────
export interface TileNode {
  id: string;
  depth: number;
  bbox: Box3;
  geometricError: number;
  instances: GlbInstance[];
  children: TileNode[];
  refine: 'REPLACE' | 'ADD';
  /** Optional LOD-nested tileset JSON (set during LOD generation). */
  lodTree?: Record<string, unknown>;
}

// ── 3D Tiles 1.1 CLI config ────────────────────────────
export interface GeodeticConfig {
  longitude: number;
  latitude: number;
  height: number;
}

export interface ImplicitTilingConfig {
  subdivisionScheme: 'QUADTREE' | 'OCTREE';
  subtreeLevels: number;
  availableLevels: number;
}

export interface Tileset11Config {
  geodetic?: GeodeticConfig;
  implicitTiling?: ImplicitTilingConfig;
}

// ── Compression config ────────────────────────────────
export interface DracoConfig {
  positionBits: number;
  normalBits: number;
  texcoordBits: number;
}

export interface LODLevel {
  ratio: number;
  error: number;
  draco: boolean;
}

export interface LODConfig {
  levels: LODLevel[];
}

// ── Pipeline input / output ────────────────────────────
export interface PipelineOptions {
  input: string;
  output: string;
  maxItemsPerTile: number;
  maxDepth: number;
  lodConfig: LODConfig;
  dracoConfig?: DracoConfig;
  enableTextureCompress: boolean;
  tilesetConfig: Tileset11Config;
  verbose: boolean;
}

export interface PipelineResult {
  tileCount: number;
  totalTriangles: number;
  totalVertices: number;
  implicit: boolean;
}

// ── gl-matrix re-export ────────────────────────────────
export type Mat4 = mat4;
export type Vec3 = [number, number, number];
