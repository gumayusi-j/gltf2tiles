import { describe, it, expect } from 'vitest';
import {
  createBox3, boxCenter, boxHalfExtents, mergeBboxes,
  splitOctree, bboxToTilesetBox, leafGeometricError, pointInBox,
} from '../src/spatial/bbox.js';

describe('createBox3', () => {
  it('creates box with given min/max', () => {
    const b = createBox3([0, 0, 0], [10, 20, 30]);
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max).toEqual([10, 20, 30]);
  });
});

describe('boxCenter', () => {
  it('finds center', () => {
    expect(boxCenter(createBox3([0, 0, 0], [2, 4, 6]))).toEqual([1, 2, 3]);
  });
});

describe('boxHalfExtents', () => {
  it('returns half extents', () => {
    expect(boxHalfExtents(createBox3([0, 0, 0], [1, 2, 3]))).toEqual([0.5, 1, 1.5]);
  });
  it('clamps tiny boxes', () => {
    const [hx, hy, hz] = boxHalfExtents(createBox3([0, 0, 0], [0.001, 0.001, 0.001]));
    expect(hx).toBe(0.005);
    expect(hy).toBe(0.005);
    expect(hz).toBe(0.005);
  });
});

describe('mergeBboxes', () => {
  it('merges multiple boxes', () => {
    const b1 = createBox3([0, 0, 0], [5, 5, 5]);
    const b2 = createBox3([3, 3, 3], [10, 10, 10]);
    const merged = mergeBboxes([b1, b2]);
    expect(merged.min).toEqual([0, 0, 0]);
    expect(merged.max).toEqual([10, 10, 10]);
  });
});

describe('splitOctree', () => {
  it('splits into 8 children', () => {
    const children = splitOctree(createBox3([0, 0, 0], [10, 10, 10]));
    expect(children).toHaveLength(8);
    for (const c of children) {
      const [hx, hy, hz] = boxHalfExtents(c);
      expect(hx).toBeCloseTo(2.5);
      expect(hy).toBeCloseTo(2.5);
      expect(hz).toBeCloseTo(2.5);
    }
  });
});

describe('bboxToTilesetBox', () => {
  it('produces 12-element array', () => {
    const arr = bboxToTilesetBox(createBox3([0, 0, 0], [10, 20, 30]));
    expect(arr).toHaveLength(12);
    expect(arr[0]).toBe(5);
    expect(arr[1]).toBe(10);
    expect(arr[2]).toBe(15);
    expect(arr[3]).toBe(5);
    expect(arr[7]).toBe(10);
    expect(arr[11]).toBe(15);
  });
});

describe('leafGeometricError', () => {
  it('returns half max span', () => {
    expect(leafGeometricError(createBox3([0, 0, 0], [10, 20, 30]))).toBe(15);
  });
});

describe('pointInBox', () => {
  const b = createBox3([0, 0, 0], [10, 10, 10]);
  it('inside', () => expect(pointInBox([5, 5, 5], b)).toBe(true));
  it('boundary', () => expect(pointInBox([0, 0, 0], b)).toBe(true));
  it('outside', () => expect(pointInBox([-1, 5, 5], b)).toBe(false));
});
