import { describe, expect, it } from 'vitest';
import { blobToVector, cosineSimilarity, vectorToBlob } from './embed.js';

describe('cosineSimilarity', () => {
  it('is 1 for identical direction and 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([2, 0, 0]); // same direction, different magnitude
    const c = new Float32Array([0, 1, 0]); // orthogonal
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(a, c)).toBeCloseTo(0, 6);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([-1, -2]))).toBeCloseTo(
      -1,
      6,
    );
  });

  it('matches a hand-computed value', () => {
    // a·b = 1*3 + 2*4 = 11; |a| = sqrt(5); |b| = 5; cos = 11/(sqrt5*5)
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(11 / (Math.sqrt(5) * 5), 6);
  });

  it('returns 0 when either vector is all zeros (no NaN)', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });
});

describe('vector BLOB round-trip', () => {
  it('encodes and decodes a Float32 vector exactly', () => {
    const vec = new Float32Array([0.5, -0.25, 1.5, 0, 3.125]);
    const back = blobToVector(vectorToBlob(vec));
    expect(Array.from(back)).toEqual(Array.from(vec));
  });

  it('decodes correctly even when the BLOB is not 4-byte aligned', () => {
    const vec = new Float32Array([1, 2, 3]);
    const blob = vectorToBlob(vec);
    // Simulate SQLite handing back a sub-view with a non-aligned byteOffset.
    const padded = Buffer.concat([Buffer.from([0]), blob]);
    const unaligned = padded.subarray(1);
    expect(Array.from(blobToVector(unaligned))).toEqual([1, 2, 3]);
  });
});
