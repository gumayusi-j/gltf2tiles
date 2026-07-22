/**
 * Lanczos3 图像下采样 — 纯 TypeScript 实现，零依赖
 *
 * Lanczos3 是三叶窗格 Lanczos 滤波器（窗格半径=3），
 * 与 sharp 的 Lanczos 算法同级，适合纹理 LOD 下采样和 mipmap 生成。
 */

/**
 * Lanczos3 权重函数
 * 在 x=0 处返回 1，在 |x|>=3 处返回 0
 */
function lanczos3Weight(x: number): number {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= 3) return 0;
  const px = Math.PI * x;
  return (Math.sin(px) * Math.sin(px / 3)) / (px * px / 3);
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * 对 RGBA Uint8Array 图像进行 Lanczos3 下采样
 *
 * @param pixels 输入 RGBA 像素数据 (Uint8Array, 长度为 srcW * srcH * 4)
 * @param srcW   输入图像宽度
 * @param srcH   输入图像高度
 * @param dstW   目标图像宽度
 * @param dstH   目标图像高度
 * @returns      下采样后的 RGBA Uint8Array (长度为 dstW * dstH * 4)
 */
export function resizeLanczos3(
  pixels: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return new Uint8Array(pixels);
  }

  const dstPixels = new Uint8Array(dstW * dstH * 4);
  const ratioX = srcW / dstW;
  const ratioY = srcH / dstH;
  const radius = 3;

  for (let y = 0; y < dstH; y++) {
    const srcY = (y + 0.5) * ratioY - 0.5;
    const y0 = Math.max(0, Math.floor(srcY - radius + 1));
    const y1 = Math.min(srcH - 1, Math.floor(srcY + radius));

    // 预计算 y 方向权重
    const yWeights: { idx: number; w: number }[] = [];
    let yTotalWeight = 0;
    for (let sy = y0; sy <= y1; sy++) {
      const wy = lanczos3Weight(sy - srcY + 0.5);
      yWeights.push({ idx: sy, w: wy });
      yTotalWeight += wy;
    }

    for (let x = 0; x < dstW; x++) {
      const srcX = (x + 0.5) * ratioX - 0.5;
      const x0 = Math.max(0, Math.floor(srcX - radius + 1));
      const x1 = Math.min(srcW - 1, Math.floor(srcX + radius));

      // 预计算 x 方向权重
      const xWeights: { idx: number; w: number }[] = [];
      let xTotalWeight = 0;
      for (let sx = x0; sx <= x1; sx++) {
        const wx = lanczos3Weight(sx - srcX + 0.5);
        xWeights.push({ idx: sx, w: wx });
        xTotalWeight += wx;
      }

      // 应用滤波器
      let r = 0, g = 0, b = 0, a = 0;
      let totalWeight = 0;

      for (const { idx: sy, w: wy } of yWeights) {
        for (const { idx: sx, w: wx } of xWeights) {
          const w = wx * wy;
          const idx = (sy * srcW + sx) * 4;
          r += pixels[idx + 0] * w;
          g += pixels[idx + 1] * w;
          b += pixels[idx + 2] * w;
          a += pixels[idx + 3] * w;
          totalWeight += w;
        }
      }

      const dstIdx = (y * dstW + x) * 4;
      dstPixels[dstIdx + 0] = clamp(r / totalWeight);
      dstPixels[dstIdx + 1] = clamp(g / totalWeight);
      dstPixels[dstIdx + 2] = clamp(b / totalWeight);
      dstPixels[dstIdx + 3] = clamp(a / totalWeight);
    }
  }

  return dstPixels;
}

/**
 * 为图像生成完整的 mipmap 链（逐级减半，直到 minDimension）
 *
 * @param pixels    输入 RGBA 像素数据
 * @param width     输入宽度
 * @param height    输入高度
 * @param minDim    最小尺寸（默认 4px）
 * @returns         mipmap 链，每项为 { pixels, width, height }
 */
export function generateMipmaps(
  pixels: Uint8Array,
  width: number,
  height: number,
  minDim = 4,
): { pixels: Uint8Array; width: number; height: number }[] {
  const mips: { pixels: Uint8Array; width: number; height: number }[] = [
    { pixels: new Uint8Array(pixels), width, height },
  ];

  let w = width;
  let h = height;
  let srcPixels = pixels;

  while (w > minDim || h > minDim) {
    w = Math.max(minDim, Math.floor(w / 2));
    h = Math.max(minDim, Math.floor(h / 2));
    const dstPixels = resizeLanczos3(srcPixels, w * 2, h * 2, w, h);
    mips.push({ pixels: dstPixels, width: w, height: h });
    srcPixels = dstPixels;
  }

  return mips;
}
