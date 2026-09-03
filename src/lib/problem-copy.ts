/**
 * Copying a problem into a course.
 *
 * Two routes do this: **Duplicate** copies within a course, and **Import** copies from
 * another course the caller also runs. What they copy is identical, and it used to be
 * written out twice, byte for byte including the comments. That is the shape of bug this
 * project can least afford: add a column to Problem, update one route, and the other
 * silently drops it on every copy, with the row still looking fine.
 *
 * The routes keep what genuinely differs, which is who is allowed to do it and what gets
 * logged. Everything about *what a copy is* lives here.
 */

import fs from 'fs';
import path from 'path';
import type { PrismaClient, Problem } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { descriptionCopyData, descriptionWriteData } from '@/lib/description-write';

// Solution files live here; the URL to serve them is /api/files/solutions/[file].
const uploadsDir = path.join('/private', 'uploads', 'solutions');

/** The parts of the source problem a copy carries over. */
type CopyableSource = Pick<
  Problem,
  | 'fileName'
  | 'originalFileName'
  | 'type'
  | 'maxStates'
  | 'isDeterministic'
  // The fingerprints of the answer key, carried with the file they describe.
  | 'answerContentHash'
  | 'answerShapeHash'
>;

export type ProblemCopyResult = {
  created: Problem;
  /** The new name of the answer-key file on disk, or null when the source had none. */
  copiedFileName: string | null;
};

/**
 * Copy the answer key to a fresh name, if the source has one and it is actually on disk.
 *
 * A fresh name matters: sharing the file would mean deleting one problem takes the other
 * problem's answer key with it. A source row pointing at a missing file is not an error
 * here, it just means the copy has no answer key either.
 */
async function copyAnswerKey(
  source: Pick<Problem, 'fileName' | 'originalFileName'>,
): Promise<{
  newFileName: string | null;
  copiedPath: string | null;
}> {
  if (!source.fileName) return { newFileName: null, copiedPath: null };

  const src = resolveInsideDir(uploadsDir, source.fileName);
  if (!fs.existsSync(src)) return { newFileName: null, copiedPath: null };

  const newFileName = safeStoredFilename(source.originalFileName ?? source.fileName);
  const dest = resolveInsideDir(uploadsDir, newFileName);
  await fs.promises.copyFile(src, dest);
  return { newFileName, copiedPath: dest };
}

/**
 * Create a copy of `source` in `courseId`, answer key and all.
 *
 * The title and description come from the caller, because both dialogs let you edit them
 * before confirming. Everything else is carried from the source and stays editable after.
 *
 * Throws if the row cannot be created, having first removed the file it copied, so a
 * failure leaves nothing orphaned in the uploads volume.
 */
export async function copyProblemInto(opts: {
  source: CopyableSource;
  courseId: string;
  title: string;
  description?: string | null;
  descriptionJson?: unknown;
}): Promise<ProblemCopyResult> {
  const { newFileName, copiedPath } = await copyAnswerKey(opts.source);

  try {
    const created = await prisma.problem.create({
      data: {
        title: opts.title,
        // The dialog can edit the description, so the body wins; rich JSON (when sent)
        // is authoritative and the plain text is derived from it.
        ...descriptionWriteData({
          description: opts.description,
          descriptionJson: opts.descriptionJson,
        }),
        type: opts.source.type,
        maxStates: opts.source.maxStates,
        isDeterministic: opts.source.isDeterministic,
        fileName: newFileName,
        // Only carry the display name when a file was actually copied.
        originalFileName: newFileName ? (opts.source.originalFileName ?? null) : null,
        // Likewise the fingerprints: they describe that file, and they are what lets the
        // similarity check recognise a student handing in the instructor's own answer. A copy
        // without them is a solution the check cannot see.
        answerContentHash: newFileName ? (opts.source.answerContentHash ?? null) : null,
        answerShapeHash: newFileName ? (opts.source.answerShapeHash ?? null) : null,
        courseId: opts.courseId,
      },
    });

    return { created, copiedFileName: newFileName };
  } catch (dbErr) {
    // The new row was not created, so the copied file would be orphaned; remove it.
    if (copiedPath) {
      await fs.promises.unlink(copiedPath).catch(() => undefined);
    }
    throw dbErr;
  }
}

/** What a copied problem's answer key becomes: a fresh stored name, or nothing. */
export type CopiedAnswerKey = { fileName: string | null; originalFileName: string | null };

/**
 * Copy the answer keys for a whole assignment's worth of problems.
 *
 * Used when duplicating or importing an assignment with copies of its problems, rather
 * than links to the originals. The copying happens **before** the database transaction on
 * purpose: the transaction then holds nothing but database writes, and a failure can
 * unlink the files afterwards. That is why the copied paths come back to the caller.
 *
 * A problem with no stored file, or whose file has gone missing on disk, is recorded with
 * a null name. The copy is left without an answer key rather than pointing at nothing.
 */
export async function copyAnswerKeysForProblems(
  problems: Array<Pick<Problem, 'id' | 'fileName' | 'originalFileName'>>,
): Promise<{ byProblemId: Map<string, CopiedAnswerKey>; copiedPaths: string[] }> {
  const byProblemId = new Map<string, CopiedAnswerKey>();
  const copiedPaths: string[] = [];

  for (const problem of problems) {
    const originalFileName = problem.originalFileName ?? null;
    const { newFileName, copiedPath } = await copyAnswerKey(problem);
    if (copiedPath) copiedPaths.push(copiedPath);
    byProblemId.set(problem.id, { fileName: newFileName, originalFileName });
  }

  return { byProblemId, copiedPaths };
}

/** The problem fields a copied assignment needs from its source. */
export const assignmentProblemSelect = {
  maxPoints: true,
  maxSubmissions: true,
  autograderEnabled: true,
  showFeedback: true,
  problem: {
    select: {
      id: true,
      title: true,
      description: true,
      descriptionFormat: true,
      descriptionJson: true,
      type: true,
      maxStates: true,
      isDeterministic: true,
      fileName: true,
      originalFileName: true,
      // The fingerprints of the answer key, carried with the file they describe. Without
      // them a copied problem has a solution on disk that the similarity check cannot
      // recognise, so a student handing in the instructor's own answer would go unnoticed
      // in every copied or imported course.
      answerContentHash: true,
      answerShapeHash: true,
    },
  },
} as const;

/** One source problem link, as selected by `assignmentProblemSelect`. */
type SourceProblemLink = {
  maxPoints: number;
  maxSubmissions: number;
  autograderEnabled: boolean;
  showFeedback: boolean;
  problem: Pick<
    Problem,
    | 'id'
    | 'title'
    | 'description'
    | 'descriptionFormat'
    | 'descriptionJson'
    | 'type'
    | 'maxStates'
    | 'isDeterministic'
    | 'fileName'
    | 'originalFileName'
    | 'answerContentHash'
    | 'answerShapeHash'
  >;
};

/**
 * Attach copies of the source assignment's problems to a newly created one.
 *
 * Runs inside the caller's transaction, so either the whole assignment appears with its
 * problems or none of it does. The answer keys were copied to disk beforehand by
 * `copyAnswerKeysForProblems`; this only writes rows, and takes the resulting names from
 * that map.
 *
 * A problem missing from the map gets no answer key rather than inheriting the source's
 * file name, which would leave two rows pointing at one file.
 */
export async function attachCopiedProblems(
  tx: Pick<PrismaClient, 'problem' | 'assignmentProblem'>,
  opts: {
    links: SourceProblemLink[];
    assignmentId: string;
    courseId: string;
    answerKeys: Map<string, CopiedAnswerKey>;
  },
): Promise<void> {
  for (const link of opts.links) {
    const p = link.problem;
    const key = opts.answerKeys.get(p.id) ?? {
      fileName: null,
      originalFileName: p.originalFileName ?? null,
    };

    const newProblem = await tx.problem.create({
      data: {
        title: p.title,
        // Carry the rich description verbatim so a copy is not silently downgraded.
        ...descriptionCopyData(p),
        type: p.type,
        maxStates: p.maxStates,
        isDeterministic: p.isDeterministic,
        fileName: key.fileName,
        originalFileName: key.originalFileName,
        // Only alongside a file that was actually copied. A fingerprint on a problem with no
        // answer key would describe a file this row does not have.
        ...(key.fileName
          ? {
              answerContentHash: p.answerContentHash,
              answerShapeHash: p.answerShapeHash,
            }
          : {}),
        courseId: opts.courseId,
      },
    });

    await tx.assignmentProblem.create({
      data: {
        assignmentId: opts.assignmentId,
        problemId: newProblem.id,
        maxPoints: link.maxPoints,
        maxSubmissions: link.maxSubmissions,
        autograderEnabled: link.autograderEnabled,
        // Carried, not defaulted. The column defaults to true, so omitting it here turns
        // feedback back on for every copied problem, and this is a study condition.
        showFeedback: link.showFeedback,
      },
    });
  }
}
