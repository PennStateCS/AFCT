import React, { useRef, useState } from 'react';
import AvatarEditor, { type AvatarEditorRef } from 'react-avatar-editor';
import { Label } from './ui/label';

export type AvatarCropRef = React.MutableRefObject<AvatarEditorRef | null>;

export function AvatarCrop({
  avatarPreview,
  editorRef,
  onChange,
}: {
  avatarPreview: string;
  editorRef?: AvatarCropRef;
  onChange?: () => void;
}) {
  const [zoom, setZoom] = useState(1.2);
  const [crop, setCrop] = useState({ x: 0.5, y: 0.5 });
  const internalEditorRef = useRef<AvatarEditorRef | null>(null);

  return (
    <div className="space-y-4">
      <div className="mx-auto grid h-[260px] w-[260px] place-items-center rounded-2xl overflow-hidden">
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
            setCrop(position);
            onChange?.();
          }}
          style={{
            backgroundColor: 'transparent',
            width: '100%',
            height: '100%',
          }}
        />
      </div>

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
            setZoom(parseFloat(e.target.value));
            onChange?.();
          }}
          className="h-2 w-full cursor-pointer rounded-lg bg-primary-foreground accent-primary"
        />
      </div>
    </div>
  );
}