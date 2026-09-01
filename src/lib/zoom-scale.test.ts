import { describe, it, expect } from 'vitest';
import { zoomToSlider, sliderToZoom, zoomPercentLabel, zoomPercentSpoken } from './zoom-scale';

// The viewer's own bounds, so the assertions describe the real control.
const MIN = 0.2;
const MAX = 6;

describe('the zoom slider scale', () => {
  it('puts the ends of the track at the ends of the range', () => {
    expect(zoomToSlider(MIN, MIN, MAX)).toBe(0);
    expect(zoomToSlider(MAX, MIN, MAX)).toBe(100);
    expect(sliderToZoom(0, MIN, MAX)).toBeCloseTo(MIN, 5);
    expect(sliderToZoom(100, MIN, MAX)).toBeCloseTo(MAX, 5);
  });

  it('puts 100% near the middle rather than squashed against the left', () => {
    // This is the whole reason the scale is logarithmic. Linearly, 1x would sit at 13.8.
    const position = zoomToSlider(1, MIN, MAX);
    expect(position).toBeGreaterThan(40);
    expect(position).toBeLessThan(55);
  });

  it('gives equal ratios equal distances, which is what makes dragging feel even', () => {
    const oneToTwo = zoomToSlider(2, MIN, MAX) - zoomToSlider(1, MIN, MAX);
    const twoToFour = zoomToSlider(4, MIN, MAX) - zoomToSlider(2, MIN, MAX);
    expect(Math.abs(oneToTwo - twoToFour)).toBeLessThanOrEqual(1);
  });

  it('round-trips a position through zoom and back', () => {
    for (const position of [0, 17, 50, 83, 100]) {
      expect(zoomToSlider(sliderToZoom(position, MIN, MAX), MIN, MAX)).toBe(position);
    }
  });

  it('clamps rather than running off either end', () => {
    expect(zoomToSlider(0.01, MIN, MAX)).toBe(0);
    expect(zoomToSlider(99, MIN, MAX)).toBe(100);
    expect(sliderToZoom(-40, MIN, MAX)).toBeCloseTo(MIN, 5);
    expect(sliderToZoom(400, MIN, MAX)).toBeCloseTo(MAX, 5);
  });

  it('survives nonsense bounds instead of returning NaN', () => {
    // cytoscape is asked for these at runtime, so a missing instance must not poison the UI.
    expect(zoomToSlider(1, 0, 0)).toBe(0);
    expect(sliderToZoom(50, 0, 0)).toBe(1);
    expect(Number.isNaN(zoomToSlider(NaN, MIN, MAX))).toBe(false);
  });

  it('shows the zoom as a percentage', () => {
    expect(zoomPercentLabel(1)).toBe('100%');
    expect(zoomPercentLabel(0.2)).toBe('20%');
    expect(zoomPercentLabel(2.5)).toBe('250%');
  });

  it('spells the percent out for the slider, where pronunciation of the symbol varies', () => {
    expect(zoomPercentSpoken(1)).toBe('100 percent');
    expect(zoomPercentSpoken(0.5)).toBe('50 percent');
  });
});
