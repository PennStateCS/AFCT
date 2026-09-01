/**
 * Mapping between a zoom factor and a slider position.
 *
 * Logarithmic, not linear, because zoom is multiplicative: the viewer runs from 0.2x to 6x,
 * and on a linear track 100% would sit at about a seventh of the way along, cramming every
 * useful value into the left-hand end while most of the track zoomed in further than anyone
 * wants. On a log track each equal step is an equal ratio, which is how zooming actually
 * feels, and 100% lands near the middle.
 */

/** Slider positions are a plain 0 to 100, so the control needs no knowledge of zoom bounds. */
export const ZOOM_SLIDER_MIN = 0;
export const ZOOM_SLIDER_MAX = 100;

/** Where a zoom factor sits on the track. */
export function zoomToSlider(zoom: number, min: number, max: number): number {
  if (!(zoom > 0) || !(min > 0) || !(max > min)) return ZOOM_SLIDER_MIN;
  const clamped = Math.min(Math.max(zoom, min), max);
  const position = (Math.log(clamped) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.round(position * ZOOM_SLIDER_MAX);
}

/** The zoom factor a track position means. */
export function sliderToZoom(position: number, min: number, max: number): number {
  if (!(min > 0) || !(max > min)) return 1;
  const clamped = Math.min(Math.max(position, ZOOM_SLIDER_MIN), ZOOM_SLIDER_MAX);
  const ratio = clamped / ZOOM_SLIDER_MAX;
  return Math.exp(Math.log(min) + ratio * (Math.log(max) - Math.log(min)));
}

/** Zoom as a percentage, for the value shown in the toolbar. */
export function zoomPercentLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/**
 * The same value spelled out, for the slider's `aria-valuetext`.
 *
 * A slider whose value is left as a bare number announces "62", which is its position on the
 * track and means nothing to anybody. The percent sign is written as a word because how a
 * screen reader pronounces the symbol varies, and this is the one place it must be certain.
 */
export function zoomPercentSpoken(zoom: number): string {
  return `${Math.round(zoom * 100)} percent`;
}
