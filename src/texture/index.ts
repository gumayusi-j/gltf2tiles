/**
 * 纹理管线 — 统一导出
 *
 * 包含:
 * - ktx2.ts:   KTX2/Basis Universal 编码器（基于 @loaders.gl/textures 分发的 WASM）
 * - resize.ts: Lanczos3 下采样（供 LOD 纹理缩放使用，非 KTX2 mipmap）
 */

export { Ktx2Encoder } from './ktx2.js';
export type { Ktx2EncodeOptions, Ktx2EncodeResult } from './ktx2.js';

// resize.ts 保留用于 LOD 纹理下采样，KTX2 mipmap 由 BasisEncoder 内部生成
export { resizeLanczos3, generateMipmaps } from './resize.js';
