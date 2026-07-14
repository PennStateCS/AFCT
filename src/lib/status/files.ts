import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import type { AbandonedFilesSummary, FilesStatusResponse } from '@/lib/status/types';

const UPLOADS_ROOT = path.join('/private', 'uploads');

const CATEGORY_FOLDERS: Record<string, string> = {
  solutions: 'solutions',
  submissions: 'submissions',
  pfps: 'pfps',
  problems: 'problems',
};

const readFiles = async (dir: string): Promise<string[]> => {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
};

/**
 * Report of orphaned uploads: files on disk under /private/uploads/<category>
 * that no DB row references. Samples are capped at 50. Any unreadable directory
 * contributes nothing (the whole report degrades to empty on total failure).
 */
export async function collectAbandonedFiles(): Promise<FilesStatusResponse> {
  const empty: AbandonedFilesSummary = {
    total: 0,
    byCategory: { solutions: 0, submissions: 0, pfps: 0, problems: 0 },
    samples: [],
  };
  try {
    const [solutionFiles, submissionFiles, pfpFiles, problemFiles] = await Promise.all([
      readFiles(path.join(UPLOADS_ROOT, 'solutions')),
      readFiles(path.join(UPLOADS_ROOT, 'submissions')),
      readFiles(path.join(UPLOADS_ROOT, 'pfps')),
      readFiles(path.join(UPLOADS_ROOT, 'problems')),
    ]);

    const [problemRows, submissionRows, userRows] = await Promise.all([
      prisma.problem.findMany({ select: { fileName: true } }),
      prisma.submission.findMany({ select: { fileName: true } }),
      prisma.user.findMany({ select: { avatar: true } }),
    ]);

    const problemNames = new Set(
      problemRows.map((r) => r.fileName).filter((n): n is string => !!n),
    );
    const submissionNames = new Set(
      submissionRows.map((r) => r.fileName).filter((n): n is string => !!n),
    );
    const avatarNames = new Set(userRows.map((r) => r.avatar).filter((n): n is string => !!n));

    const missingSolutions = solutionFiles.filter((f) => !problemNames.has(f));
    const missingSubmissions = submissionFiles.filter((f) => !submissionNames.has(f));
    const missingPfps = pfpFiles.filter((f) => !avatarNames.has(f));
    const missingProblems = problemFiles.filter((f) => !problemNames.has(f));

    const samples: AbandonedFilesSummary['samples'] = [];
    const pushSamples = (category: string, files: string[], folder: string) => {
      for (const f of files) {
        if (samples.length >= 50) break;
        samples.push({ category, fileName: f, path: path.join(folder, f) });
      }
    };
    pushSamples('solutions', missingSolutions, '/private/uploads/solutions');
    pushSamples('submissions', missingSubmissions, '/private/uploads/submissions');
    pushSamples('pfps', missingPfps, '/private/uploads/pfps');
    pushSamples('problems', missingProblems, '/private/uploads/problems');

    return {
      abandonedFiles: {
        total:
          missingSolutions.length +
          missingSubmissions.length +
          missingPfps.length +
          missingProblems.length,
        byCategory: {
          solutions: missingSolutions.length,
          submissions: missingSubmissions.length,
          pfps: missingPfps.length,
          problems: missingProblems.length,
        },
        samples,
      },
    };
  } catch {
    return { abandonedFiles: empty };
  }
}

// Reject anything that could escape the category folder (traversal or separators).
const isSafeFileName = (name: string) =>
  !!name && !name.includes('..') && !name.includes('/') && !name.includes('\\');

export type DeleteResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Delete one orphaned upload, guarding every axis: known category, separator-free
 * name, still-unreferenced by the DB, and a resolved path that stays inside the
 * category folder. Returns a typed result the route maps to a status code.
 */
export async function deleteAbandonedFile(
  categoryRaw: string | undefined,
  fileNameRaw: string | undefined,
): Promise<DeleteResult> {
  const category = categoryRaw?.trim();
  const fileName = fileNameRaw?.trim();

  if (!category || !fileName || !CATEGORY_FOLDERS[category] || !isSafeFileName(fileName)) {
    return { ok: false, status: 400, error: 'Invalid request' };
  }

  if (category === 'solutions' || category === 'problems') {
    if (await prisma.problem.findFirst({ where: { fileName } }))
      return { ok: false, status: 409, error: 'File is still referenced' };
  } else if (category === 'submissions') {
    if (await prisma.submission.findFirst({ where: { fileName } }))
      return { ok: false, status: 409, error: 'File is still referenced' };
  } else if (category === 'pfps') {
    if (await prisma.user.findFirst({ where: { avatar: fileName } }))
      return { ok: false, status: 409, error: 'File is still referenced' };
  }

  const baseDir = path.join(UPLOADS_ROOT, CATEGORY_FOLDERS[category]);
  const resolvedBase = path.resolve(baseDir);
  const resolvedFile = path.resolve(path.join(baseDir, fileName));

  if (resolvedFile !== resolvedBase && !resolvedFile.startsWith(resolvedBase + path.sep)) {
    return { ok: false, status: 400, error: 'Invalid path' };
  }
  if (!fs.existsSync(resolvedFile)) {
    return { ok: false, status: 404, error: 'File not found' };
  }

  await fs.promises.unlink(resolvedFile);
  return { ok: true };
}
