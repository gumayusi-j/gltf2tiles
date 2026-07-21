import { WGS84, WGS84_E2 } from '../constants.js';

/**
 * WGS84 geodetic ↔ ECEF ↔ ENU coordinate transforms.
 *
 * All angles in radians internally.  Public API accepts degrees.
 *
 * Reference:
 *  - coordinate_transformer.cpp (3dtiles project), NIMA TR8350.2
 */
export class CoordinateTransform {
  private readonly lonRad: number;
  private readonly latRad: number;
  private readonly height: number;

  constructor(lonDeg: number, latDeg: number, height: number) {
    this.lonRad = lonDeg * (Math.PI / 180);
    this.latRad = latDeg * (Math.PI / 180);
    this.height = height;
  }

  /** ECEF position of the geographic origin. */
  originEcef(): [number, number, number] {
    const { lonRad, latRad, height } = this;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const N = WGS84.A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const x = (N + height) * cosLat * Math.cos(lonRad);
    const y = (N + height) * cosLat * Math.sin(lonRad);
    const z = (N * (1 - WGS84_E2) + height) * sinLat;
    return [x, y, z];
  }

  /**
   * ENU → ECEF 4×4 **column-major** matrix (16-element Float64Array).
   *
   * Maps a local Cartesian point (E=0,N=0,U=0 at the origin) into ECEF.
   * Used as the `transform` property in the root of tileset.json.
   */
  enuToEcefMatrix(): Float64Array {
    const { lonRad, latRad, height } = this;
    const sinLon = Math.sin(lonRad);
    const cosLon = Math.cos(lonRad);
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);

    const N = WGS84.A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const x0 = (N + height) * cosLat * cosLon;
    const y0 = (N + height) * cosLat * sinLon;
    const z0 = (N * (1 - WGS84_E2) + height) * sinLat;

    // Column-major 4×4 = [east | north | up | position]
    return new Float64Array([
      -sinLon, cosLon, 0, 0,
      -sinLat * cosLon, -sinLat * sinLon, cosLat, 0,
      cosLat * cosLon, cosLat * sinLon, sinLat, 0,
      x0, y0, z0, 1,
    ]);
  }

  /** Multiply two column-major 4×4 matrices (both 16-element). out = a × b */
  static mat4Multiply(
    a: Float64Array | number[],
    b: Float64Array | number[],
  ): Float64Array {
    const out = new Float64Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[k * 4 + row]! * b[col * 4 + k]!;
        }
        out[col * 4 + row] = sum;
      }
    }
    return out;
  }

  /** Transform [x,y,z] by a column-major 4×4 matrix (homogeneous, w=1). */
  static transformPoint(
    mat: Float64Array | number[],
    p: [number, number, number],
  ): [number, number, number] {
    return [
      mat[0] * p[0] + mat[4] * p[1] + mat[8] * p[2] + mat[12],
      mat[1] * p[0] + mat[5] * p[1] + mat[9] * p[2] + mat[13],
      mat[2] * p[0] + mat[6] * p[1] + mat[10] * p[2] + mat[14],
    ];
  }
}
