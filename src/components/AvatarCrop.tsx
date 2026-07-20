import React, { useEffect, useState } from 'react';
import AvatarEditor, { useAvatarEditor} from 'react-avatar-editor'
import { Label } from './ui/label';

export function AvatarCrop({
  avatarPreview,
  cropX,
  cropY,
  zoom,
  onPositionChange,
  onZoomChange,
}: {
  avatarPreview: string;
  cropX: number;
  cropY: number;
  zoom: number;
  onPositionChange?: (position: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
}) {
  const editor = useAvatarEditor()
  const [state, setState] = useState<{ position: { x: number; y: number }; scale: number }>({
    position: { x: cropX, y: cropY },
    scale: zoom,
  })

  const update = (patch: Partial<{ position: { x: number; y: number }; scale: number }>) =>
    setState((previous) => ({ ...previous, ...patch }))

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const handleZoomKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const zoomStep = 0.001;
    const min = 0.6;
    const max = 2.6;
    const key = event.key;

    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();

    const delta = key === 'ArrowLeft' || key === 'ArrowDown' ? -zoomStep * 50 : zoomStep * 50;
    const nextZoom = clamp(state.scale + delta, min, max);

    update({ scale: nextZoom });
    onZoomChange?.(nextZoom);
  };

  // Update crop whenever the incoming preview or crop params change.
  useEffect(() => {
    update({ position: { x: cropX, y: cropY }, scale: zoom });
    console.log('AvatarCrop: Updated crop state from props', { cropX, cropY, zoom });
  }, [avatarPreview, cropX, cropY, zoom]);

  return (
    <div className="space-y-4">
      <div className="mx-auto h-[230px] w-[230px]">
        <AvatarEditor
          ref={editor.ref}
          image={avatarPreview}
          width={230}
          height={230}
          border={15}
          borderRadius={115}
          color={[0, 0, 0, 0.4]}
          scale={state.scale}
          position={{ x: state.position.x, y: state.position.y }}
          onPositionChange={(position) => {
            update({ position });
            onPositionChange?.(position);
          }}
          style={{
            backgroundColor: 'transparent',
          }}
        />
      </div>

      <p className="text-muted-foreground text-center text-xs">
        Focus the image preview and use arrow keys to pan the crop or drag the image to reposition it
      </p>

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
          value={state.scale}
          onChange={(e) => {
            const nextZoom = parseFloat(e.target.value);
            update({ scale: nextZoom });
            onZoomChange?.(nextZoom);
          }}
          onKeyDown={handleZoomKeyDown}
          className="bg-primary-foreground accent-primary h-2 w-full cursor-pointer rounded-lg"
        />
      </div>
    </div>
  );
} 