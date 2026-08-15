import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { withStaffAuth } from '@/lib/api/with-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { isAdmin } from '@/lib/permissions';
import { deleteTrialInputs } from '@/lib/evaluator-trials';
import { serializeTrial, isTrialFinished } from '@/lib/evaluator-trial-view';

type Ctx = { params: Promise<{ id: string }> };

/**
 * The state of one evaluator trial, polled by the page while it runs.
 *
 * Only the person who started it (or a system admin) may read it back. Reading a
 * finished trial is also what deletes its uploads: they were somebody's coursework, and
 * the moment the result exists there is no reason to keep them. The janitor in
 * `evaluator-trials.ts` is the backstop for a run nobody comes back to.
 * @openapi
 * summary: Read an evaluator trial
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The trial and its result so far. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: "No such trial, or it belongs to somebody else." }
 *   500: { description: Server error. }
 */
export const GET = withStaffAuth<Ctx>(
  async (_req, ctx, { user }) => {
    try {
      const { id } = await ctx.params;
      const trial = await prisma.evaluatorTrial.findUnique({ where: { id } });

      // Somebody else's trial is masked as missing rather than refused: a staff member
      // has no business knowing another's exists.
      if (!trial || (trial.requestedById !== user.id && !isAdmin(user))) {
        return apiError(404, 'Not found');
      }

      const view = serializeTrial(trial);
      if (isTrialFinished(trial.state)) {
        await deleteTrialInputs(trial);
      }
      return NextResponse.json(view);
    } catch (error) {
      console.error('Error reading evaluator trial:', error);
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'EVALUATOR_TRIAL_ACCESS_DENIED' },
);

/**
 * Discards a trial: its uploads and its row go now rather than at expiry. The page calls
 * this when the user clears a result or starts another run.
 * @openapi
 * summary: Discard an evaluator trial
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   204: { description: Gone. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: "No such trial, or it belongs to somebody else." }
 *   500: { description: Server error. }
 */
export const DELETE = withStaffAuth<Ctx>(
  async (req, ctx, { user }) => {
    try {
      const { id } = await ctx.params;
      const trial = await prisma.evaluatorTrial.findUnique({ where: { id } });
      if (!trial || (trial.requestedById !== user.id && !isAdmin(user))) {
        return apiError(404, 'Not found');
      }

      await deleteTrialInputs(trial);
      await prisma.evaluatorTrial.delete({ where: { id } });
      // Recorded because the row and its uploads are gone afterwards: without this there
      // is nothing left to say the run happened at all.
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'EVALUATOR_TRIAL_DISCARDED',
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: { trialId: id, state: trial.state, discardedForOwner: trial.requestedById },
      });
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      console.error('Error discarding evaluator trial:', error);
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'EVALUATOR_TRIAL_ACCESS_DENIED' },
);
