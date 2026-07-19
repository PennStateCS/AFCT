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

  // The crop is repositioned without a pointer via two native range sliders
  // (horizontal + vertical), so no `role="application"` is needed; native inputs
  // are announced and operated correctly by every screen reader. Pointer users can
  // still drag the image directly.
  const setPosition = (x: number, y: number) => {
    setCrop((c) => {
      const next = { x, y, scale: c.scale };
      onPositionChange?.({ x: next.x, y: next.y });
      return next;
    });
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // Update crop whenever the incoming preview or crop params change.
  useEffect(() => {
    setCrop({ x: cropX, y: cropY, scale: zoom });
  }, [avatarPreview, cropX, cropY, zoom]);

  return (
    <div className="space-y-4">
      <div className="mx-auto grid h-[260px] w-[260px] place-items-center overflow-hidden rounded-2xl">
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
            value={crop.x}
            aria-valuetext={pct(crop.x)}
            onChange={(e) => setPosition(parseFloat(e.target.value), crop.y)}
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
            value={crop.y}
            aria-valuetext={pct(crop.y)}
            onChange={(e) => setPosition(crop.x, parseFloat(e.target.value))}
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
          onChange={(e) => {
            const nextZoom = parseFloat(e.target.value);
            setCrop((c) => ({ ...c, scale: nextZoom }));
            onZoomChange?.(nextZoom);
          }}
          className="bg-primary-foreground accent-primary h-2 w-full cursor-pointer rounded-lg"
        />
      </div>
    </div>
  );
}