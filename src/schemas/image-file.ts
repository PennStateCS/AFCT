import { z } from 'zod';

/**
 * The optional avatar field, shared by the two profile schemas that used to hold a copy
 * each.
 *
 * There is deliberately **no size limit here**. The limit is an admin setting
 * (`maxUploadSizeMb`), so a schema built once at module load cannot know it. Both copies
 * of this used to hardcode 5MB, which meant an installation that raised the limit still
 * had the browser refusing anything larger, with the server perfectly willing to accept
 * it. Size is checked where the real number is available: `FileUploadInput` enforces it in
 * the form, and `readAndValidateAvatar` enforces it on the server, which is the one that
 * counts.
 *
 * What is left here is the part that does not depend on configuration: it has to be a
 * file, and it has to be an image.
 */
export const ImageFileOptional = (() => {
  // `File` does not exist when these schemas are imported on the server.
  if (typeof File !== 'undefined') {
    return z
      .instanceof(File, { message: 'Invalid file.' })
      .refine((f) => f.type.startsWith('image/'), 'Avatar must be an image.')
      .optional();
  }

  return z
    .any()
    .refine((f) => {
      if (f && typeof f === 'object' && 'type' in f) {
        return typeof f.type === 'string' && f.type.startsWith('image/');
      }
      return true; // Nothing file-shaped to check; the route validates the real upload.
    }, 'Avatar must be an image.')
    .optional();
})();
