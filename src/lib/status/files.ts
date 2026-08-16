import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import type {
  AbandonedFile,
  AbandonedFileCategory,
  AbandonedFilesSummary,
  FilesStatusResponse,
} from '@/lib/status/types';

const UPLOADS_ROOT = path.join('/private', 'uploads');

/**
 * The upload directories, and what tells us a file in each is still in use.
 *
 * Every category needs a label a person can read. An admin cleaning up disk space is a
 * professor, not the developer who named the folders, and "pfps" is not a word.
 */
type CategorySpec = {
  category: string;
  label: string;
  folder: string;
  /** Every filename the database still points at for this category. */
  referenced: () => Promise<Array<string | null>>;
};

const CATEGORIES: CategorySpec[] = [
  {
    category: 'submissions',
    label: 'Student submissions',
    folder: 'submissions',
    referenced: async () =>
      (await prisma.submission.findMany({ select: { fileName: true } })).map((r) => r.fileName),
  },
  {
    category: 'solutions',
    label: 'Reference solutions',
    folder: 'solutions',
    referenced: async () =>
      (await prisma.problem.findMany({ select: { fileName: true } })).map((r) => r.fileName),
  },
  {
    category: 'pfps',
    label: 'Profile photos',
    folder: 'pfps',
    referenced: async () =>
      (await prisma.user.findMany({ select: { avatar: true } })).map((r) => r.avatar),
  },
  {
    // A trial upload is usually a real student's submission, re-run to look into a grading
    // complaint, and it is deleted after an hour precisely so it does not become a lasting
    // second copy of that work outside the access controls around the original. A file left
    // behind here is therefore the one an admin most needs told about.
    category: 'trials',
    label: 'Evaluator trials',
    folder: 'trials',
    referenced: async () =>
      (
        await prisma.evaluatorTrial.findMany({
          // Two uploads per trial, either of which can be cleared on its own. Reading one
          // column would report the other's file as abandoned and offer to delete a file a
          // running trial still needs.
          select: { answerFileName: true, submissionFileName: true },
        })
      ).flatMap((r) => [r.answerFileName, r.submissionFileName]),
  },
  {
    // Nothing in the app writes here today, but `/api/files/problems/[file]` still serves the
    // directory against this same column, so it is scanned rather than dropped: a category
    // nobody looks at is how a file goes unreported. It is hidden on screen while it is empty.
    category: 'problems',
    label: 'Problem files',
    folder: 'problems',
    referenced: async () =>
      (await prisma.problem.findMany({ select: { fileName: true } })).map((r) => r.fileName),
  },
];

const CATEGORY_BY_NAME = new Map(CATEGORIES.map((c) => [c.category, c]));

/**
 * How many files are listed individually.
 *
 * The counts and totals are always complete; this bounds only the list, because a volume that
 * has never been cleaned holds thousands and sending them all would be megabytes of JSON to
 * render a table nobody scrolls to the end of. The per-category "delete all" works from the
 * server's own scan, not from this list, so a cap never limits what can be cleaned up.
 */
const MAX_LISTED = 500;

type DirListing = { names: string[]; error?: string };

const readFiles = async (dir: string): Promise<DirListing> => {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return { names: entries.filter((e) => e.isFile()).map((e) => e.name) };
  } catch (err) {
    // A missing directory is normal (nothing has been uploaded yet); anything else is a fault
    // worth surfacing, because a directory that cannot be read contributes no files and would
    // otherwise read on screen as a directory with nothing wrong with it.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { names: [] };
    return { names: [], error: 'This folder could not be read.' };
  }
};

/** Size and last-changed time, or zeroes if the file went away between listing and reading. */
const describe = async (full: string) => {
  try {
    const stat = await fs.promises.stat(full);
    return { sizeBytes: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString() };
  } catch {
    return { sizeBytes: 0, modifiedAt: new Date(0).toISOString() };
  }
};

/** Every file in one category that no row points at, with its size. */
async function scanCategory(
  spec: CategorySpec,
): Promise<{ summary: AbandonedFileCategory; files: AbandonedFile[] }> {
  const folder = path.join(UPLOADS_ROOT, spec.folder);
  const [listing, referenced] = await Promise.all([readFiles(folder), spec.referenced()]);

  const keep = new Set(referenced.filter((n): n is string => !!n));
  const orphans = listing.names.filter((name) => !keep.has(name));

  const files = await Promise.all(
    orphans.map(async (fileName) => ({
      category: spec.category,
      fileName,
      path: path.join(folder, fileName),
      ...(await describe(path.join(folder, fileName))),
    })),
  );

  const summary: AbandonedFileCategory = {
    category: spec.category,
    label: spec.label,
    count: files.length,
    sizeBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
  };
  if (listing.error) summary.error = listing.error;

  return { summary, files };
}

/**
 * Report of orphaned uploads: files on disk under /private/uploads/<category> that no database
 * row references.
 *
 * A failure is reported as a failure. This used to answer every error with a summary of zeroes,
 * which the page rendered as "No abandoned files found", so a database that could not be reached
 * and a volume with nothing to clean up looked exactly alike. That is also how a whole missing
 * category survived: the report came back clean instead of coming back broken.
 */
export async function collectAbandonedFiles(): Promise<FilesStatusResponse> {
  try {
    const scans = await Promise.all(CATEGORIES.map((spec) => scanCategory(spec)));
    const files = scans.flatMap((s) => s.files);
    // Biggest first: the reason to look at this page is disk, so the row that would free the
    // most space is the one to show at the top.
    files.sort((a, b) => b.sizeBytes - a.sizeBytes);

    return {
      abandonedFiles: {
        total: files.length,
        totalSizeBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
        categories: scans.map((s) => s.summary),
        files: files.slice(0, MAX_LISTED),
        listLimit: MAX_LISTED,
      },
    };
  } catch (err) {
    const failed: AbandonedFilesSummary = {
      total: 0,
      totalSizeBytes: 0,
      categories: [],
      files: [],
      listLimit: MAX_LISTED,
      error:
        err instanceof Error && err.message
          ? `The check could not be completed: ${err.message}`
          : 'The check could not be completed.',
    };
    return { abandonedFiles: failed };
  }
}

// Reject anything that could escape the category folder (traversal or separators).
const isSafeFileName = (name: string) =>
  !!name && !name.includes('..') && !name.includes('/') && !name.includes('\\');

export type DeleteResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };
export type PurgeResult =
  { ok: true; deleted: number; freedBytes: number } | { ok: false; status: 400; error: string };

/** Whether any row still names this file, asked of the one category's own source. */
async function isReferenced(spec: CategorySpec, fileName: string): Promise<boolean> {
  const referenced = await spec.referenced();
  return referenced.some((name) => name === fileName);
}

/** The absolute path, or null when the name resolves outside its category folder. */
function resolveInCategory(spec: CategorySpec, fileName: string): string | null {
  const baseDir = path.join(UPLOADS_ROOT, spec.folder);
  const resolvedBase = path.resolve(baseDir);
  const resolvedFile = path.resolve(path.join(baseDir, fileName));
  if (resolvedFile !== resolvedBase && !resolvedFile.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedFile;
}

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
  const spec = category ? CATEGORY_BY_NAME.get(category) : undefined;

  if (!spec || !fileName || !isSafeFileName(fileName)) {
    return { ok: false, status: 400, error: 'Invalid request' };
  }
  if (await isReferenced(spec, fileName)) {
    return { ok: false, status: 409, error: 'File is still referenced' };
  }

  const resolvedFile = resolveInCategory(spec, fileName);
  if (!resolvedFile) return { ok: false, status: 400, error: 'Invalid path' };
  if (!fs.existsSync(resolvedFile)) return { ok: false, status: 404, error: 'File not found' };

  await fs.promises.unlink(resolvedFile);
  return { ok: true };
}

/**
 * Delete every orphaned upload in one category.
 *
 * Deleting one file at a time through a confirmation dialog is fine for a handful and useless
 * for the thousands a volume accumulates, which is the state this page actually finds. The list
 * is rescanned here rather than taken from the client, so nothing the browser sends decides what
 * gets deleted, and each file is re-checked against the database immediately before it goes: a
 * file that gained a row since the page was drawn is skipped rather than removed.
 */
export async function deleteAbandonedFilesInCategory(
  categoryRaw: string | undefined,
): Promise<PurgeResult> {
  const category = categoryRaw?.trim();
  const spec = category ? CATEGORY_BY_NAME.get(category) : undefined;
  if (!spec) return { ok: false, status: 400, error: 'Invalid request' };

  const { files } = await scanCategory(spec);
  const keep = new Set((await spec.referenced()).filter((n): n is string => !!n));

  let deleted = 0;
  let freedBytes = 0;
  for (const file of files) {
    if (!isSafeFileName(file.fileName) || keep.has(file.fileName)) continue;
    const resolvedFile = resolveInCategory(spec, file.fileName);
    if (!resolvedFile) continue;
    try {
      await fs.promises.unlink(resolvedFile);
      deleted += 1;
      freedBytes += file.sizeBytes;
    } catch {
      // Already gone, or not ours to remove. Keep going: a partial clean-up is still a
      // clean-up, and the count returned says what actually happened.
    }
  }

  return { ok: true, deleted, freedBytes };
}
