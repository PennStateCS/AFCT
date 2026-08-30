'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AvatarCrop, type AvatarCropRef } from '@/components/AvatarCrop';
import { SettingsSection, SETTINGS_COMPACT } from '@/components/settings/settings-layout';
import { ImageFileOptional } from '@/schemas/image-file';
import { apiPaths } from '@/lib/api-paths';
import { showToast } from '@/lib/toast';
import type { SessionUser } from '@/types/next-auth';

type ProfileUser = SessionUser & {
  cropX?: number;
  cropY?: number;
  zoom?: number;
};

/** Where the picture sits in its circle, and how far in it is zoomed. */
type Crop = { cropX: number; cropY: number; zoom: number };

const cropOf = (user: ProfileUser): Crop => ({
  cropX: user.cropX ?? 0.5,
  cropY: user.cropY ?? 0.5,
  zoom: user.zoom ?? 1,
});

/**
 * Your profile photo, on its own tab.
 *
 * It was the top half of the Profile tab, sharing a form and a Save button with your name and
 * timezone. Two different things to do, and repositioning a picture is the fiddly one, so they
 * are now two tabs with a save each. The route takes a partial update for that reason: this
 * form says nothing about your name, and the name form says nothing about your photo.
 */
export function AvatarSection({ user }: { user: ProfileUser }) {
  const router = useRouter();
  // The navbar/sidebar avatars read from the NextAuth session; update() re-runs the session
  // callback (which re-reads the user from the DB), so the new photo appears immediately
  // without a page reload.
  const { update: updateSession } = useSession();
  const editorRef = useRef<AvatarCropRef['current']>(null);
  // Ref (not getElementById) to trigger the hidden file input, and a unique id so the
  // input, button and error stay associated even if this renders more than once.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadId = useId();
  const errorId = `${uploadId}-error`;

  const [preview, setPreview] = useState<string>(
    user.avatar ? apiPaths.files.pfp(user.avatar) : '',
  );
  const [crop, setCrop] = useState<Crop>(cropOf(user));
  const [file, setFile] = useState<File | undefined>(undefined);
  const [removed, setRemoved] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // What was last saved, so Save and Reset can tell whether there is anything to do. Held in
  // state rather than read from the prop: the prop is the session's copy, and after a save it
  // is refreshed asynchronously.
  const [saved, setSaved] = useState<Crop>(cropOf(user));
  const dirty =
    file !== undefined ||
    removed ||
    crop.cropX !== saved.cropX ||
    crop.cropY !== saved.cropY ||
    crop.zoom !== saved.zoom;

  const pickFile = (picked?: File) => {
    if (!picked) return;
    const parsed = ImageFileOptional.safeParse(picked);
    if (!parsed.success) {
      setFileError(parsed.error.issues[0]?.message ?? 'Invalid file.');
      return;
    }
    setFileError(null);
    setFile(picked);
    setRemoved(false);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(picked);
  };

  const removePhoto = () => {
    setFile(undefined);
    setRemoved(true);
    setFileError(null);
    setPreview('');
  };

  const resetChanges = () => {
    setFile(undefined);
    setRemoved(false);
    setFileError(null);
    setPreview(user.avatar ? apiPaths.files.pfp(user.avatar) : '');
    setCrop(saved);
  };

  const save = async () => {
    setSaving(true);
    const formData = new FormData();
    // Only the photo's own fields. Restating the name here would write back whatever this
    // page happens to be holding rather than what is stored.
    if (file) formData.append('avatar', file);
    if (removed) formData.append('deleteAvatar', 'true');
    formData.append('cropX', String(crop.cropX));
    formData.append('cropY', String(crop.cropY));
    formData.append('zoom', String(crop.zoom));

    try {
      const res = await fetch(apiPaths.me(), { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to update the photo');

      setSaved(crop);
      setFile(undefined);
      setRemoved(false);
      await updateSession();
      // The page reads the user from the session on the server, so ask for it again: without
      // this, leaving the tab and coming back would show the photo as it was before the save.
      router.refresh();
      showToast.updated('Profile photo');
    } catch {
      showToast.error('Could not save your photo. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title="Profile photo"
      description="Shown beside your name in AFCT. Only you can change it."
      className={SETTINGS_COMPACT}
      /* Destructive, but secondary: as a full-width red bar above the picture it was the
         first thing on the page. It stays outline-destructive, just not dominant. */
      action={
        preview ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive text-destructive hover:bg-destructive/10 flex items-center gap-2"
            onClick={removePhoto}
          >
            <Trash2 className="h-4 w-4" />
            Delete Avatar
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col items-center gap-3">
        <Label className="sr-only">Avatar Image</Label>
        {/* No separate preview: the crop editor below shows the current image. */}
        <input
          id={uploadId}
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-invalid={fileError ? true : undefined}
          aria-describedby={fileError ? errorId : undefined}
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        {/*
         * One button at a time: upload when there is no picture, delete when there is.
         * Offering both invites "upload" to mean "replace", which it does not; the picture
         * has to be removed first.
         */}
        {!preview && (
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            aria-describedby={fileError ? errorId : undefined}
            className="flex items-center justify-center gap-2"
          >
            <Upload className="h-4 w-4" />
            Upload Avatar
          </Button>
        )}
        {fileError && (
          <p id={errorId} role="alert" className="text-destructive text-xs">
            {fileError}
          </p>
        )}
      </div>

      {preview ? (
        <AvatarCrop
          avatarPreview={preview}
          editorRef={editorRef}
          cropX={crop.cropX}
          cropY={crop.cropY}
          zoom={crop.zoom}
          onPositionChange={(position) =>
            setCrop((prev) => ({ ...prev, cropX: position.x, cropY: position.y }))
          }
          onZoomChange={(zoom) => setCrop((prev) => ({ ...prev, zoom }))}
        />
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={resetChanges}
          disabled={saving || !dirty}
        >
          Reset
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Saving...' : 'Save photo'}
        </Button>
      </div>
    </SettingsSection>
  );
}

export default AvatarSection;
