/**
 * KTX2 纹理编码器
 *
 * 基于 @loaders.gl/textures 分发的 Basis Universal WASM 编码器。
 * 底层使用 BinomialLLC/basis_universal，由 loaders.gl 团队维护打包。
 *
 * 编码流程:
 *   1. 解码 PNG/JPEG → RGBA pixels
 *   2. BasisEncoder → KTX2 二进制
 *   3. 替换纹理数据 + 注册 KHR_texture_basisu
 *
 * WASM 加载（一次初始化，之后复用）:
 *   basis_encoder.js   (Emscripten 模块工厂)
 *   basis_encoder.wasm (WASM 二进制)
 *   均取自 @loaders.gl/textures 包内 vendor。
 *
 * Mipmap: 使用 BasisEncoder.setMipGen(true) 内部生成，不需外部 Lanczos3。
 *
 * 移除依赖: ktx-parse, basis-universal-codec-wasm
 * 新增依赖: @loaders.gl/textures (内嵌 WASM)
 */

import type { Document, Texture } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── Types ───────────────────────────────────────────────

export interface Ktx2EncodeOptions {
  /** Basis 压缩格式 */
  format: 'etc1s' | 'uastc';
  /** 压缩质量 1-255（ETC1S 模式），默认 128 */
  quality: number;
  /** 是否生成 mipmap */
  generateMipmaps: boolean;
  /** UASTC 压缩级别 0-4（仅 uastc 模式） */
  compressionLevel?: number;
}

export interface Ktx2EncodeResult {
  data: Uint8Array;
  width: number;
  height: number;
  hasAlpha: boolean;
}

// ── WASM module loading ─────────────────────────────────

interface BasisModule {
  BasisEncoder: new () => BasisEncoderInstance;
  initializeBasis: () => void;
}

interface BasisEncoderInstance {
  setCreateKTX2File: (v: boolean) => void;
  setKTX2UASTCSupercompression: (v: boolean) => void;
  setKTX2SRGBTransferFunc: (v: boolean) => void;
  setSliceSourceImage: (slice: number, data: Uint8Array, w: number, h: number, transparent: boolean) => void;
  setPerceptual: (v: boolean) => void;
  setMipSRGB: (v: boolean) => void;
  setQualityLevel: (level: number) => void;
  setUASTC: (v: boolean) => void;
  setMipGen: (v: boolean) => void;
  setCompressionLevel: (level: number) => void;
  setDebug: (v: boolean) => void;
  encode: (output: Uint8Array) => number;
  delete: () => void;
}

let basisModulePromise: Promise<BasisModule> | null = null;

/**
 * 加载并初始化 Basis Universal WASM 编码器
 *
 * 从 @loaders.gl/textures 包内读取 vendor 的 basis_encoder.{js,wasm}。
 * 仅首次调用实际加载，之后复用缓存。线程安全：多次并发调用共享同一个 promise。
 */
async function loadBasisEncoder(): Promise<BasisModule> {
  if (basisModulePromise) return basisModulePromise;

  basisModulePromise = (async () => {
    // 从 @loaders.gl/textures 已导出的入口点反向查找包目录
    const entryPoint = createRequire(import.meta.url).resolve('@loaders.gl/textures');
    // entryPoint → <pkgDir>/dist/index.js
    const pkgDir = path.resolve(path.dirname(entryPoint), '..');
    const libDir = path.join(pkgDir, 'dist', 'libs');
    const jsPath = path.join(libDir, 'basis_encoder.js');
    const wasmPath = path.join(libDir, 'basis_encoder.wasm');

    const wasmBinary = readFileSync(wasmPath);
    const jsCode = readFileSync(jsPath, 'utf-8');

    // 用 Function 构造器模拟 CommonJS 环境执行 Emscripten 模块
    const cjsRequire = createRequire(import.meta.url);
    const sandboxMod = { exports: {} as any };
    const wrapper = new Function(
      'module', 'exports', 'require', '__filename', '__dirname',
      jsCode,
    );
    wrapper(sandboxMod, sandboxMod.exports, cjsRequire, jsPath, path.dirname(jsPath));
    const createModule: (opts: { wasmBinary: ArrayBuffer }) => Promise<BasisModule> =
      sandboxMod.exports;

    const mod = await createModule({ wasmBinary: wasmBinary.buffer });
    mod.initializeBasis();
    return mod;
  })();

  return basisModulePromise;
}

// ── Image decoders ──────────────────────────────────────

const _require = createRequire(import.meta.url);
const UPNG: any = _require('upng-js');
const jpeg: any = _require('jpeg-js');

async function decodeImageToRGBA(
  data: Uint8Array,
  mimeType: string,
): Promise<{
  pixels: Uint8Array;
  width: number;
  height: number;
  hasAlpha: boolean;
} | null> {
  try {
    if (mimeType === 'image/png') {
      const img = UPNG.decode(data);
      const frame = UPNG.toRGBA8(img)[0] as ArrayBuffer;
      const pixels = new Uint8Array(frame);
      const colorType = img.tabs?.IHDR?.colorType ?? 2;
      const hasAlpha =
        colorType === 4 || colorType === 6 || (img.tabs?.acTL != null);
      return { pixels, width: img.width, height: img.height, hasAlpha };
    }

    if (mimeType === 'image/jpeg') {
      const img = jpeg.decode(data, { useTArray: true });
      return {
        pixels: new Uint8Array(img.data),
        width: img.width,
        height: img.height,
        hasAlpha: false,
      };
    }
  } catch (err) {
    console.warn(`[ktx2] Failed to decode ${mimeType} texture:`, (err as Error).message);
    return null;
  }

  console.warn(`[ktx2] Unsupported MIME type: ${mimeType}, skipping.`);
  return null;
}

// ── Ktx2Encoder ─────────────────────────────────────────

export class Ktx2Encoder {
  /**
   * 将 RGBA 像素数据编码为 KTX2（Basis Universal）
   *
   * @param pixels  RGBA Uint8Array（长度 = width * height * 4）
   * @param width   图像宽度
   * @param height  图像高度
   * @param options 编码选项
   * @returns       KTX2 编码结果，失败返回 null
   */
  async encode(
    pixels: Uint8Array,
    width: number,
    height: number,
    options: Ktx2EncodeOptions,
  ): Promise<Ktx2EncodeResult | null> {
    const mod = await loadBasisEncoder();
    const encoder = new mod.BasisEncoder();

    try {
      encoder.setCreateKTX2File(true);
      encoder.setKTX2UASTCSupercompression(true);
      encoder.setKTX2SRGBTransferFunc(true);

      // 设置源图
      encoder.setSliceSourceImage(0, pixels, width, height, false);
      encoder.setPerceptual(false);
      encoder.setMipSRGB(false);

      // 格式与质量
      const isUastc = options.format === 'uastc';
      encoder.setUASTC(isUastc);
      encoder.setQualityLevel(options.quality);
      if (isUastc && options.compressionLevel !== undefined) {
        encoder.setCompressionLevel(options.compressionLevel);
      }

      // Mipmap（由 Basis 内部生成）
      encoder.setMipGen(options.generateMipmaps);

      // 编码
      const outputSize = Math.max(width * height * 4, 4096);
      const output = new Uint8Array(outputSize);
      const numBytes = encoder.encode(output);

      if (!numBytes || numBytes <= 0) {
        console.warn('[ktx2] BasisEncoder returned 0 bytes');
        return null;
      }

      return {
        data: output.subarray(0, numBytes),
        width,
        height,
        hasAlpha: true, // Basis 内部自行检测，默认 true
      };
    } catch (err) {
      console.warn('[ktx2] Encoding failed:', (err as Error).message);
      return null;
    } finally {
      encoder.delete();
    }
  }

  /**
   * 对 gltf-transform Document 中的所有纹理进行 KTX2 压缩
   *
   * 在源 Document 上直接修改纹理数据（替换为 KTX2 + 注册扩展）。
   *
   * @param doc     gltf-transform Document
   * @param options 编码选项
   * @returns       成功压缩的纹理数量
   */
  async compressDocument(doc: Document, options: Ktx2EncodeOptions): Promise<number> {
    const textures = doc.getRoot().listTextures();
    if (textures.length === 0) return 0;

    let count = 0;

    for (const tex of textures) {
      const ok = await this.compressTexture(tex, options);
      if (ok) count++;
    }

    // 注册 KHR_texture_basisu 扩展
    if (count > 0) {
      const root = doc.getRoot();
      const existing = root.listExtensionsUsed();
      const hasBasisu = existing.some(
        (ext: any) => ext.extensionName === 'KHR_texture_basisu',
      );
      if (!hasBasisu) {
        doc.createExtension(KHRTextureBasisu);
      }
    }

    return count;
  }

  /**
   * 压缩单个纹理
   */
  private async compressTexture(
    tex: Texture,
    options: Ktx2EncodeOptions,
  ): Promise<boolean> {
    const image = tex.getImage();
    if (!image) return false;

    const size = tex.getSize();
    if (!size || size[0] === 0 || size[1] === 0) return false;

    const mimeType = tex.getMimeType();

    // 跳过已压缩的
    if (mimeType === 'image/ktx2') return false;

    // 解码 PNG/JPEG → RGBA
    let rgbaPixels: Uint8Array;
    let imgWidth = size[0];
    let imgHeight = size[1];

    if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
      const decoded = await decodeImageToRGBA(image, mimeType);
      if (!decoded) return false;
      rgbaPixels = decoded.pixels;
      imgWidth = decoded.width;
      imgHeight = decoded.height;
    } else {
      // 未知格式—直接当 RGBA 处理
      rgbaPixels = image;
    }

    const result = await this.encode(rgbaPixels, imgWidth, imgHeight, options);
    if (!result) return false;

    tex.setImage(result.data);
    tex.setMimeType('image/ktx2');

    return true;
  }
}
