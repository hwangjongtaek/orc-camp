/**
 * SPEC-301-AC-05 — 8-direction quantize: centers, half-open boundary determinism, vectors.
 */
import { describe, it, expect } from 'vitest';
import { quantizeAngle, quantizeVector } from '../src/scene/direction';

describe('SPEC-301-AC-05 direction quantize', () => {
  it('AC-05: bucket centers map to the matching manifest direction (screen y-down)', () => {
    expect(quantizeAngle(0)).toBe('east');
    expect(quantizeAngle(45)).toBe('south-east');
    expect(quantizeAngle(90)).toBe('south');
    expect(quantizeAngle(135)).toBe('south-west');
    expect(quantizeAngle(180)).toBe('west');
    expect(quantizeAngle(-180)).toBe('west');
    expect(quantizeAngle(-135)).toBe('north-west');
    expect(quantizeAngle(-90)).toBe('north');
    expect(quantizeAngle(-45)).toBe('north-east');
  });

  it('AC-05: boundary angles (±22.5° multiples) always resolve to the UPPER bucket', () => {
    expect(quantizeAngle(22.5)).toBe('south-east'); // not east
    expect(quantizeAngle(67.5)).toBe('south'); // not south-east
    expect(quantizeAngle(112.5)).toBe('south-west');
    expect(quantizeAngle(157.5)).toBe('west');
    expect(quantizeAngle(-22.5)).toBe('east');
    expect(quantizeAngle(-67.5)).toBe('north-east');
    expect(quantizeAngle(-112.5)).toBe('north');
    expect(quantizeAngle(-157.5)).toBe('north-west');
  });

  it('AC-05: boundaries are deterministic (no tie) — repeated calls are stable', () => {
    for (const deg of [22.5, 67.5, 112.5, 157.5, -22.5, -67.5, -112.5, -157.5]) {
      expect(quantizeAngle(deg)).toBe(quantizeAngle(deg));
    }
  });

  it('AC-05: vector helper — right=east, down=south, up=north, zero=south', () => {
    expect(quantizeVector(1, 0)).toBe('east');
    expect(quantizeVector(0, 1)).toBe('south');
    expect(quantizeVector(0, -1)).toBe('north');
    expect(quantizeVector(-1, 0)).toBe('west');
    expect(quantizeVector(0, 0)).toBe('south');
  });
});
