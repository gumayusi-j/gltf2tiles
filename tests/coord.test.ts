import { describe, it, expect } from 'vitest';
import { CoordinateTransform } from '../src/coord/transform.js';
import { WGS84 } from '../src/constants.js';

describe('CoordinateTransform', () => {
  it('ENU→ECEF matrix at equator lon=0 has X≈a', () => {
    const mat = new CoordinateTransform(0, 0, 0).enuToEcefMatrix();
    expect(mat[12]).toBeGreaterThan(WGS84.A - 1);
    expect(mat[12]).toBeLessThan(WGS84.A + 1);
    expect(mat[13]).toBeCloseTo(0, 6);
    expect(mat[14]).toBeCloseTo(0, 6);
  });

  it('produces column-major 4×4', () => {
    const mat = new CoordinateTransform(120, 30, 100).enuToEcefMatrix();
    expect(mat).toHaveLength(16);
    expect(mat[3]).toBeCloseTo(0);
    expect(mat[7]).toBeCloseTo(0);
    expect(mat[11]).toBeCloseTo(0);
    expect(mat[15]).toBeCloseTo(1);
  });

  it('rotation submatrix is orthonormal', () => {
    const m = new CoordinateTransform(117, 35, 0).enuToEcefMatrix();
    const cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const dot = cols[i]![0] * cols[j]![0] + cols[i]![1] * cols[j]![1] + cols[i]![2] * cols[j]![2];
        expect(Math.abs(dot)).toBeLessThan(1e-10);
      }
    }
    for (const col of cols) {
      const len = Math.sqrt(col[0] * col[0] + col[1] * col[1] + col[2] * col[2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('mat4Multiply identity × identity = identity', () => {
    const id = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const r = CoordinateTransform.mat4Multiply(id, id);
    for (let i = 0; i < 16; i++) expect(r[i]).toBeCloseTo(id[i]!);
  });

  it('transformPoint applies translation', () => {
    const t = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);
    expect(CoordinateTransform.transformPoint(t, [1, 2, 3])).toEqual([11, 22, 33]);
  });
});
