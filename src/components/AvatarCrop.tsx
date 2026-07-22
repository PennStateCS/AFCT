import React, { useRef } from 'react';
import { avatarCropStyle } from './ui/avatar';
import { Label } from './ui/label';

// The editor frame is a plain <img> styled with the SAME transform as <AvatarImage>
// (via the shared `avatarCropStyle`), so what you frame here is pixel-for-pixel what
// every avatar in the app displays. Values are stored as cropX/cropY (0..1, where 0.5
// is centered) and zoom (a scale multiplier) — the identical model <AvatarImage>
// consumes. (We deliberately replaced react-avatar-editor, whose boundary-checked,
// overflow-relative `position` could never round-trip against this transform.)
export type AvatarCropRef = React.MutableRefObject<HTMLDivElement | null>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function AvatarCrop({
  avatarPreview,
  editorRef,
  cropX,
  cropY,
  zoom,
  onPositionChange,
  onZoomChange,
}: {
  avatarPreview: string;
  editorRef?: AvatarCropRef;
  cropX: number;
  cropY: number;
  zoom: number;
  onPositionChange?: (position: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  // Pointer origin plus the crop values captured when the drag began.
  const drag = useRef<{ px: number; py: number; cropX: number; cropY: number } | null>(null);

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const attachFrame = (node: HTMLDivElement | null) => {
    frameRef.current = node;
    if (editorRef) editorRef.current = node;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    frameRef.current?.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, cropX, cropY };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const size = frameRef.current?.clientWidth ?? 0;
    if (!start || size === 0) return;
    // <AvatarImage> shifts the image by zoom*(0.5 - crop)*size px, so a pointer move of
    // `d` px changes crop by -d/(zoom*size). Dragging right reveals the image's left
    // side (crop decreases) — the exact inverse of the display transform.
    const x = clamp01(start.cropX - (e.clientX - start.px) / (zoom * size));
    const y = clamp01(start.cropY - (e.clientY - start.py) / (zoom * size));
    onPositionChange?.({ x, y });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    frameRef.current?.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="space-y-4">
      {/* Circular frame that clips the same transform the app uses everywhere. Drag to
          pan (pointer users); the labeled sliders below give keyboard/AT users the same
          control. */}
      <div
        ref={attachFrame}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="border-border bg-muted mx-auto h-[230px] w-[230px] cursor-grab touch-none overflow-hidden rounded-full border select-none active:cursor-grabbing"
      >
        {avatarPreview ? (
          // Avatar preview is a local object/data URL; next/image adds no value here and
          // can't carry this transform.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarPreview}
            alt=""
            draggable={false}
            style={avatarCropStyle(cropX, cropY, zoom)}
          />
        ) : null}
      </div>
      <p className="text-muted-foreground text-center text-xs">
        Drag the image to reposition it, or use the sliders below.
      </p>

      {/* Position: two labeled native sliders (no application role needed). */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="crop-x" className="w-full text-center">
            Horizontal
          </Label>
          <input
            id="crop-x"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={cropX}
            aria-valuetext={pct(cropX)}
            onChange={(e) => onPositionChange?.({ x: parseFloat(e.target.value), y: cropY })}
            className="bg-primary-foreground accent-primary h-2 w-full cursor-pointer rounded-lg"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="crop-y" className="w-full text-center">
            Vertical
          </Label>
          <input
            id="crop-y"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={cropY}
            aria-valuetext={pct(cropY)}
            onChange={(e) => onPositionChange?.({ x: cropX, y: parseFloat(e.target.value) })}
            className="bg-primary-foreground accent-primary h-2 w-full cursor-pointer rounded-lg"
          />
        </div>
      </div>

      {/* Zoom Bar */}
      <div className="space-y-2">
        <Label htmlFor="zoom" className="w-full text-center">
          Zoom
        </Label>
        <input
          id="zoom"
          type="range"
          min="0.6"
          max="2.6"
          step="0.001"
          value={zoom}
          onChange={(e) => onZoomChange?.(parseFloat(e.target.value))}
          className="bg-primary-foreground accent-primary h-2 w-full cursor-pointer rounded-lg"
        />
      </div>
    </div>
  );
}
