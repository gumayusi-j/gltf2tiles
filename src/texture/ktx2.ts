/**
 * KTX2 纹理编码器
 *
 * 基于 ktx-parse + basis-universal-codec-wasm，零原生依赖。
 * Node.js 为主运行环境，bun 为打包工具。
 *
 * Issues fixed:
 *   1. 注册 KHR_texture_basisu glTF Extension
 *   2. 图像尺寸对齐到 4 倍数 (ETC1S/UASTC 块压缩要求)
 *   3. Alpha 通道检测优先从元数据判断，避免全像素扫描
 *   4. 使用纯 JS 解码器 (upng-js + jpeg-js) 支持 Node.js，不锁定 bun
 */

import { encodeImage, initBasisModule } from 'basis-universal-codec-wasm';
import type { Document, Texture } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// upng-js / jpeg-js 为纯 JS 解码器，零原生依赖
const UPNG: any = require('upng-js');
const jpeg: any = require('jpeg-js');

// ── Types ───────────────────────────────────────────────

export interface Ktx2EncodeOptions {
  /** Basis 压缩格式 */
  format: 'etc1s' | 'uastc';
  /** 压缩质量 1-255（ETC1S 模式），默认 128 */
  quality: number;
  /** 是否生成 mipmap */
  generateMipmaps: boolean;
  /** UASTC 压缩级别 0-4（仅 uastc 模式），默认 2 */
  compressionLevel?: number;
}

export interface Ktx2EncodeResult {
  /** 编码后的 KTX2 二进制数据 */
  data: Uint8Array;
  /** 对齐后的纹理宽度 */
  width: number;
  /** 对齐后的纹理高度 */
  height: number;
  /** 原始纹理宽度 */
  originalWidth: number;
  /** 原始纹理高度 */
  originalHeight: number;
  /** 是否有 alpha 通道 */
  hasAlpha: boolean;
}

// ── Size alignment helpers ─────────────────────────────

/** 向上取整到 4 的倍数（Basis Universal 块压缩要求） */
function ceilTo4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

/** 下一个 2 的幂（mipmap 生成建议） */
function nextPowerOf2(n: number): number {
  if (n <= 0) return 4;
  return 1 << (32 - Math.clz32(n - 1));
}

/**
 * 将像素数据垫到 Basis Universal 要求的合法尺寸
 *
 * 规则:
 *   - generateMipmaps=true → 垫到 2 的幂
 *   - generateMipmaps=false → 垫到 4 的倍数
 *   - 用透明黑 (0,0,0,0) 填充新增区域
 *
 * @returns 对齐后的像素数据和尺寸
 */
function alignTextureSize(
  pixels: Uint8Array,
  width: number,
  height: number,
  generateMipmaps: boolean,
): { pixels: Uint8Array; width: number; height: number } {
  const targetW = generateMipmaps ? nextPowerOf2(width) : ceilTo4(width);
  const targetH = generateMipmaps ? nextPowerOf2(height) : ceilTo4(height);

  if (targetW === width && targetH === height) {
    return { pixels, width, height };
  }

  const aligned = new Uint8Array(targetW * targetH * 4);
  // 逐行拷贝原始像素（新增区域自动为 0,0,0,0 透明黑）
  for (let y = 0; y < height; y++) {
    const srcStart = y * width * 4;
    const dstStart = y * targetW * 4;
    aligned.set(pixels.subarray(srcStart, srcStart + width * 4), dstStart);
  }

  return { pixels: aligned, width: targetW, height: targetH };
}

// ── Alpha detection ────────────────────────────────────

/**
 * 检测 RGBA 像素中是否有半透明像素
 *
 * 优化策略:
 *   1. 先用步进扫描快速判断（64 像素步长）
 *   2. 步进扫描确定有不透明→无需继续
 *   3. 步进扫描未发现→降级到全扫描
 *   4. 调用方如果已从元数据获知 alpha 信息，可直接传入 knownHasAlpha
 */
function detectAlpha(pixels: Uint8Array, knownHasAlpha?: boolean): boolean {
  if (knownHasAlpha !== undefined) return knownHasAlpha;

  // 快速步进扫描 — 64 步长覆盖 1/64 像素
  for (let i = 3; i < pixels.length; i += 256) {
    if ((pixels[i] as number) < 255) return true;
  }

  // 降级全扫描
  for (let i = 3; i < pixels.length; i += 4) {
    if ((pixels[i] as number) < 255) return true;
  }

  return false;
}

// ── Image decoders ─────────────────────────────────────

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

      // PNG 元数据: 从 color type 判断 alpha
      //  PNG color types: 0=Grayscale, 2=RGB, 3=Indexed, 4=Grayscale+Alpha, 6=RGBA
      const colorType = img.tabs?.IHDR?.colorType ?? 2;
      const hasAlpha =
        colorType === 4 || colorType === 6 || (img.tabs?.acTL != null);

      return { pixels, width: img.width, height: img.height, hasAlpha };
    }

    if (mimeType === 'image/jpeg') {
      const img = jpeg.decode(data, { useTArray: true });
      // JPEG 不支持 alpha 通道
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

// ── WASM initialization ────────────────────────────────

let initialized = false;

// ── Ktx2Encoder ────────────────────────────────────────

export class Ktx2Encoder {
  private wasmPath: string | undefined;

  constructor(wasmPath?: string) {
    this.wasmPath = wasmPath;
  }

  private async ensureInit(): Promise<void> {
    if (initialized) return;
    await initBasisModule({
      wasmPath: this.wasmPath,
      withEncoder: true,
    });
    initialized = true;
  }

  /**
   * 将 RGBA 像素数据编码为 KTX2
   *
   * @param pixels  RGBA Uint8Array（长度 = width * height * 4）
   * @param width   图像宽度
   * @param height  图像高度
   * @param options 编码选项
   * @returns       KTX2 数据（尺寸会自动对齐到合法值）
   */
  async encode(
    pixels: Uint8Array,
    width: number,
    height: number,
    options: Ktx2EncodeOptions,
    knownHasAlpha?: boolean,
  ): Promise<Ktx2EncodeResult | null> {
    await this.ensureInit();

    // ── Fix 2: 尺寸对齐到 4 倍数 / POT ──
    const aligned = alignTextureSize(pixels, width, height, options.generateMipmaps);

    const formatMap: Record<string, 'ETC1S' | 'UASTC_LDR'> = {
      etc1s: 'ETC1S',
      uastc: 'UASTC_LDR',
    };

    const result = await encodeImage(aligned.pixels, aligned.width, aligned.height, {
      format: formatMap[options.format] ?? 'ETC1S',
      quality: options.quality,
      compressionLevel: options.compressionLevel ?? 2,
      generateMipmaps: options.generateMipmaps,
      outputKTX2: true,
    });

    if (!result) return null;

    // ── Fix 3: 从解码元数据获知 alpha，避免全扫描 ──
    // 此处已知像素是 RGBA，需扫描（但由调用方在 compressTexture 中传入已知值）
    const hasAlpha = detectAlpha(aligned.pixels, knownHasAlpha);

    return {
      data: result,
      width: aligned.width,
      height: aligned.height,
      originalWidth: width,
      originalHeight: height,
      hasAlpha,
    };
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

    // ── Fix 1: 注册 KHR_texture_basisu 扩展 ──
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
    const [width, height] = size;

    const mimeType = tex.getMimeType();

    // 跳过已压缩的
    if (mimeType === 'image/ktx2') return false;

    // 解码 PNG/JPEG → RGBA（传入已知 alpha 信息）
    let rgbaPixels: Uint8Array;
    let imgWidth = width;
    let imgHeight = height;
    let knownAlpha: boolean | undefined;

    if (mimeType === 'image/png') {
      const decoded = await decodeImageToRGBA(image, 'image/png');
      if (!decoded) return false;
      rgbaPixels = decoded.pixels;
      imgWidth = decoded.width;
      imgHeight = decoded.height;
      knownAlpha = decoded.hasAlpha; // 来自 PNG header
    } else if (mimeType === 'image/jpeg') {
      const decoded = await decodeImageToRGBA(image, 'image/jpeg');
      if (!decoded) return false;
      rgbaPixels = decoded.pixels;
      imgWidth = decoded.width;
      imgHeight = decoded.height;
      knownAlpha = false; // JPEG 无 alpha
    } else {
      // 未知格式/raw RGBA
      rgbaPixels = image;
    }

    // encode 内部会做尺寸对齐，传入已知 alpha 信息避免全像素扫描
    const result = await this.encode(rgbaPixels, imgWidth, imgHeight, options, knownAlpha);
    if (!result) return false;

    tex.setImage(result.data);
    tex.setMimeType('image/ktx2');

    return true;
  }
}
