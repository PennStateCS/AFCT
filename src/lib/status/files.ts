import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import type {
  AbandonedFile,
  AbandonedFileCategory,
  AbandonedFilesSummary,
  FilesStatusResponse,
  StorageUsage,
  UploadCategoryUsage,
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
  /**
   * Whether this folder is the only place its column's files live.
   *
   * It decides one thing: whether a name in the database with no file here means a file is
   * missing. Two folders are served from `Problem.fileName`, so the reference list alone cannot
   * say which of them a given file should be in, and treating a reference satisfied by the other
   * folder as missing reported thirteen imaginary missing files on a healthy install. Abandoned
   * files are unaffected, because a file present on disk and named nowhere is unambiguous.
   */
  ownsReferences: boolean;
};

const CATEGORIES: CategorySpec[] = [
  {
    category: 'submissions',
    label: 'Student submissions',
    folder: 'submissions',
    ownsReferences: true,
    referenced: async () =>
      (await prisma.submission.findMany({ select: { fileName: true } })).map((r) => r.fileName),
  },
  {
    category: 'solutions',
    label: 'Reference solutions',
    folder: 'solutions',
    ownsReferences: true,
    referenced: async () =>
      (await prisma.problem.findMany({ select: { fileName: true } })).map((r) => r.fileName),
  },
  {
    category: 'pfps',
    label: 'Profile photos',
    folder: 'pfps',
    ownsReferences: true,
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
    ownsReferences: true,
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
    // Reads the same column as `solutions`, which is where those files actually are, so a name
    // with nothing here says nothing about whether a file is missing.
    ownsReferences: false,
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

/** How many of a category's missing files are named on screen before it becomes a wall. */
const MAX_MISSING_SAMPLES = 5;

/**
 * One category, in a single pass: what is in use, what is abandoned, and what is missing.
 *
 * All three come from the same comparison, so they are worked out together. The third is the
 * one nothing else in AFCT reports and the only one that is bad news: a row naming a file that
 * is not on disk is a submission that cannot be downloaded, re-graded or appealed.
 */
async function scanCategory(spec: CategorySpec): Promise<{
  summary: AbandonedFileCategory;
  usage: UploadCategoryUsage;
  files: AbandonedFile[];
}> {
  const folder = path.join(UPLOADS_ROOT, spec.folder);
  const [listing, referenced] = await Promise.all([readFiles(folder), spec.referenced()]);

  const keep = new Set(referenced.filter((n): n is string => !!n));
  const present = new Set(listing.names);

  // Everything on disk is measured, not just the orphans: the working set is the number an
  // admin needs to judge whether the volume is filling up because of real work or because of
  // rubbish, and those two call for opposite responses.
  const sized = await Promise.all(
    listing.names.map(async (fileName) => ({
      fileName,
      inUse: keep.has(fileName),
      ...(await describe(path.join(folder, fileName))),
    })),
  );

  const files: AbandonedFile[] = sized
    .filter((f) => !f.inUse)
    .map((f) => ({
      category: spec.category,
      fileName: f.fileName,
      path: path.join(folder, f.fileName),
      sizeBytes: f.sizeBytes,
      modifiedAt: f.modifiedAt,
    }));

  const total = (items: { sizeBytes: number }[]) =>
    items.reduce((sum, item) => sum + item.sizeBytes, 0);
  const inUse = sized.filter((f) => f.inUse);
  // Only meaningful when this folder is the one those files belong in, and only when it could
  // be read at all: an unreadable folder would otherwise report every file in the database as
  // missing, which turns one permissions problem into a page-wide false alarm.
  const missing =
    listing.error || !spec.ownsReferences
      ? []
      : [...keep].filter((name) => !present.has(name)).sort();

  const summary: AbandonedFileCategory = {
    category: spec.category,
    label: spec.label,
    count: files.length,
    sizeBytes: total(files),
  };
  const usage: UploadCategoryUsage = {
    category: spec.category,
    label: spec.label,
    inUseCount: inUse.length,
    inUseBytes: total(inUse),
    abandonedCount: files.length,
    abandonedBytes: total(files),
    missingCount: missing.length,
    missingSamples: missing.slice(0, MAX_MISSING_SAMPLES),
  };
  if (listing.error) {
    summary.error = listing.error;
    usage.error = listing.error;
  }

  return { summary, usage, files };
}

/**
 * Space on the filesystem holding the uploads.
 *
 * Sizes only mean something against what is left. Disk is the binding constraint on the deploy
 * VM, which filled up after about seven upgrades, so "2 GB of rubbish" reads very differently
 * with 30 GB free than with 3 GB free.
 */
async function readVolume(): Promise<StorageUsage['volume']> {
  try {
    const stats = await fs.promises.statfs(UPLOADS_ROOT);
    return {
      totalBytes: stats.blocks * stats.bsize,
      freeBytes: stats.bavail * stats.bsize,
    };
  } catch {
    // Not every platform or mount supports it, and a missing number is better than a wrong one.
    return undefined;
  }
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
    const [scans, volume] = await Promise.all([
      Promise.all(CATEGORIES.map((spec) => scanCategory(spec))),
      readVolume(),
    ]);
    const files = scans.flatMap((s) => s.files);
    // Biggest first: the reason to look at this page is disk, so the row that would free the
    // most space is the one to show at the top.
    files.sort((a, b) => b.sizeBytes - a.sizeBytes);

    const usage = scans.map((s) => s.usage);
    return {
      storage: {
        categories: usage,
        inUseCount: usage.reduce((sum, c) => sum + c.inUseCount, 0),
        inUseBytes: usage.reduce((sum, c) => sum + c.inUseBytes, 0),
        missingCount: usage.reduce((sum, c) => sum + c.missingCount, 0),
        ...(volume ? { volume } : {}),
      },
      abandonedFiles: {
        total: files.length,
        totalSizeBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
        categories: scans.map((s) => s.summary),
        files: files.slice(0, MAX_LISTED),
        listLimit: MAX_LISTED,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? `The check could not be completed: ${err.message}`
        : 'The check could not be completed.';
    const failed: AbandonedFilesSummary = {
      total: 0,
      totalSizeBytes: 0,
      categories: [],
      files: [],
      listLimit: MAX_LISTED,
      error: message,
    };
    return {
      storage: { categories: [], inUseCount: 0, inUseBytes: 0, missingCount: 0 },
      abandonedFiles: failed,
    };
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
