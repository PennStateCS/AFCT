import React, { useEffect, useRef, useState } from 'react';
import AvatarEditor, { type AvatarEditorRef } from 'react-avatar-editor';
import { Label } from './ui/label';

export type AvatarCropRef = React.MutableRefObject<AvatarEditorRef | null>;

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
  const [crop, setCrop] = useState({ x: cropX, y: cropY, scale: zoom });
  const internalEditorRef = useRef<AvatarEditorRef | null>(null);

  // The crop position/zoom is stored (the original image is uploaded and framed at
  // render), so it must be adjustable without a pointer: arrow keys nudge the crop
  // (Shift = bigger steps).
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const nudgeCrop = (dx: number, dy: number) => {
    setCrop((c) => {
      const next = { x: clamp01(c.x + dx), y: clamp01(c.y + dy), scale: c.scale };
      onPositionChange?.(next);
      return next;
    });
  };
  const handleCropKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        nudgeCrop(-step, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        nudgeCrop(step, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        nudgeCrop(0, -step);
        break;
      case 'ArrowDown':
        e.preventDefault();
        nudgeCrop(0, step);
        break;
    }
  };

  // Update crop whenever the incoming preview or crop params change.
  useEffect(() => {
    setCrop({ x: cropX, y: cropY, scale: zoom });
  }, [avatarPreview, cropX, cropY, zoom]);

  return (
    <div className="space-y-4">
      {/* role="application" keeps screen readers in pass-through mode so the
          arrow keys reach the handler instead of moving the virtual cursor. */}
      <div
        role="application"
        tabIndex={0}
        aria-label="Avatar crop area"
        aria-describedby="avatar-crop-hint"
        onKeyDown={handleCropKeyDown}
        className="mx-auto grid h-[260px] w-[260px] place-items-center rounded-2xl overflow-hidden focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
      >
        <AvatarEditor
          ref={editorRef ?? internalEditorRef}
          image={avatarPreview}
          width={230}
          height={230}
          border={15}
          borderRadius={115}
          color={[0, 0, 0, 0.4]}
          scale={zoom}
          position={crop}
          onPositionChange={(position) => {
            setCrop({ x: position.x, y: position.y, scale: crop.scale });
            onPositionChange?.(position);
          }}
          style={{
            backgroundColor: 'transparent',
            width: '100%',
            height: '100%',
          }}
        />
      </div>
      <p id="avatar-crop-hint" className="sr-only">
        Drag the image, or focus the crop area and use the arrow keys to reposition
        it. Hold Shift for larger steps. Use the zoom slider below to resize.
      </p>

      {/* Zoom Bar */}
      <div className="space-y-2">
        <Label htmlFor="zoom" className="text-center w-full">Zoom</Label>
        <input
          id="zoom"
          type="range"
          min="0.6"
          max="2.6"
          step="0.001"
          value={zoom}
          onChange={(e) => {
            const nextZoom = parseFloat(e.target.value);
            setCrop((c) => ({ ...c, scale: nextZoom }));
            onZoomChange?.(nextZoom);
          }}
          className="h-2 w-full cursor-pointer rounded-lg bg-primary-foreground accent-primary"
        />
      </div>
    </div>
  );
}