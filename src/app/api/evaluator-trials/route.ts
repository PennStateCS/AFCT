import { NextResponse } from 'next/server';
import fs from 'fs';
import type { ProblemType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { withStaffAuth } from '@/lib/api/with-auth';
import { readFormData } from '@/lib/api/request';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';
import { safeStoredFilename, resolveInsideDir, safeUnlinkInDir } from '@/lib/safe-upload';
import { ALLOWED_PROBLEM_EXTENSIONS, isAllowedProblemExtension } from '@/schemas/problem';
import { EvaluatorTrialCreateApiSchema } from '@/schemas/evaluator-trial';
import { TRIALS_DIR, trialExpiresAt, pruneExpiredTrials } from '@/lib/evaluator-trials';
import { serializeTrial } from '@/lib/evaluator-trial-view';

/**
 * Starts an evaluator trial: an answer file and a submitted file, queued to be run
 * through the real evaluator. Course staff (faculty or TAs) or a system admin.
 *
 * Nothing here is graded and nothing is kept: the uploads are deleted as soon as the run
 * finishes and the result expires within the hour. A caller may only have one trial in
 * flight at a time, which is also what stops the queue filling with them.
 * @openapi
 * summary: Start an evaluator trial
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [type, answerFile, submissionFile]
 *         properties:
 *           type: { type: string, description: "Problem type (FA, PDA, RE, CFG, TM)" }
 *           maxStates: { type: string, description: FA/PDA only }
 *           isDeterministic: { type: string, enum: ['true', 'false'], description: FA only }
 *           answerFile: { type: string, format: binary }
 *           submissionFile: { type: string, format: binary }
 * responses:
 *   201: { description: The queued trial. }
 *   400: { description: "Missing files, or a file failed structure validation." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   409: { description: The caller already has a trial in flight. }
 *   413: { description: A file exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
export const POST = withStaffAuth(
  async (req, _ctx, { user }) => {
    const written: string[] = [];
    try {
      const parsed = await readFormData(req, EvaluatorTrialCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const { type, maxStates, isDeterministic } = parsed.data;

      const answerFile = parsed.form.get('answerFile') as File | null;
      const submissionFile = parsed.form.get('submissionFile') as File | null;
      if (!answerFile?.size || !submissionFile?.size) {
        return apiError(400, 'Both an answer file and a submission file are required.');
      }

      for (const file of [answerFile, submissionFile]) {
        if (!isAllowedProblemExtension(file.name)) {
          return apiError(400, `Allowed file types: .${ALLOWED_PROBLEM_EXTENSIONS.join(', .')}`);
        }
      }

      const { maxBytes, maxMb } = await getSystemUploadLimit();
      if (answerFile.size > maxBytes || submissionFile.size > maxBytes) {
        return apiError(413, `File exceeds max upload size (${maxMb} MB).`);
      }

      // One trial per person at a time. Checked before anything is written so a caller
      // who is already waiting does not leave a second pair of files behind.
      const inFlight = await prisma.evaluatorTrial.findFirst({
        where: { requestedById: user.id, state: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true },
      });
      if (inFlight) {
        return apiError(409, 'You already have a trial running. Wait for it to finish.');
      }

      // Same structure check a real upload gets, which is also what keeps the evaluator
      // away from hostile XML (see xmlStructureValidate).
      const uploads: { file: File; buffer: Buffer }[] = [];
      for (const [label, file] of [
        ['answer', answerFile],
        ['submission', submissionFile],
      ] as const) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const validation = validateStructureXML(buffer.toString('utf8'), type);
        if (!validation.isValid) {
          return apiError(400, `The ${label} file could not be read: ${validation.error}`);
        }
        uploads.push({ file, buffer });
      }

      await fs.promises.mkdir(TRIALS_DIR, { recursive: true });
      const storedNames: string[] = [];
      for (const { file, buffer } of uploads) {
        const name = safeStoredFilename(file.name);
        await fs.promises.writeFile(resolveInsideDir(TRIALS_DIR, name), buffer, { mode: 0o644 });
        storedNames.push(name);
        written.push(name);
      }
      const [answerStoredName, submissionStoredName] = storedNames;

      const trial = await prisma.evaluatorTrial.create({
        data: {
          requestedById: user.id,
          problemType: type as ProblemType,
          maxStates: type === 'FA' || type === 'PDA' ? (maxStates ?? null) : null,
          isDeterministic: type === 'FA' ? (isDeterministic ?? false) : null,
          answerFileName: answerStoredName,
          submissionFileName: submissionStoredName,
          answerOriginalName: answerFile.name,
          submissionOriginalName: submissionFile.name,
          expiresAt: trialExpiresAt(),
        },
      });

      // Cheap moment to take out the rubbish: this is the only route that runs often
      // enough to matter and rarely enough not to.
      void pruneExpiredTrials().catch(() => {});

      return NextResponse.json(serializeTrial(trial), { status: 201 });
    } catch (error) {
      // Files with no row behind them would never be read and never be removed by the
      // usual path, so take them back out on the way past.
      for (const name of written) await safeUnlinkInDir(TRIALS_DIR, name);
      console.error('Error starting evaluator trial:', error);
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'EVALUATOR_TRIAL_ACCESS_DENIED' },
);
