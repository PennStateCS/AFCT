import { prisma } from '@/lib/prisma';

export type UploadLimit = {
  maxMb: number;
  maxBytes: number;
};

export async function getSystemUploadLimit(): Promise<UploadLimit> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const rawMb = Number(settings?.maxUploadSizeMb ?? 25);
  const maxMb = Math.max(1, Math.min(1024, Math.trunc(rawMb)));
  return { maxMb, maxBytes: maxMb * 1024 * 1024 };
}
