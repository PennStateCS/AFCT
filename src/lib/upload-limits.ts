import { prisma } from '@/lib/prisma';
import {
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  MIN_UPLOAD_SIZE_MB,
  MAX_UPLOAD_SIZE_MB,
} from '@/lib/system-settings';

export type UploadLimit = {
  maxMb: number;
  maxBytes: number;
};

export async function getSystemUploadLimit(): Promise<UploadLimit> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const rawMb = Number(settings?.maxUploadSizeMb ?? DEFAULT_MAX_UPLOAD_SIZE_MB);
  // Clamp to the same ceiling as the settings validator so a stale/oversized stored
  // value can't exceed the nginx body-size limit.
  const maxMb = Math.max(MIN_UPLOAD_SIZE_MB, Math.min(MAX_UPLOAD_SIZE_MB, Math.trunc(rawMb)));
  return { maxMb, maxBytes: maxMb * 1024 * 1024 };
}
