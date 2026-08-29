// Fill in when grading finished, for submissions graded before that was recorded.
//
// `Submission.evaluatedAt` is stamped in the write that lands an evaluation result. Rows
// graded before the column existed have none, and the Similarity tab reads it to say whether
// one student's work had ALREADY been marked correct when another student submitted the same
// work. Without a result time it says nothing, which is correct but loses the signal on
// everything already in the database.
//
// The activity log is the safe way back: the worker writes SUBMISSION_EVALUATION_SUCCESS when
// an evaluation completes, with the submission id and the time. That is a record of the
// moment, not a guess from `updatedAt`, which moves for reasons that have nothing to do with
// grading. A submission the log says nothing about keeps a null result time and is left alone.
//
// Run it where the database is reachable, which is the app container:
//   docker exec afct-dev sh -c 'cd /app && node scripts/backfill-evaluated-at.mjs'
//
// Pass --dry-run to see what it would do without writing anything.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('tsx/cjs');
const { prisma } = require('../src/lib/prisma.ts');

const BATCH = 500;
const dryRun = process.argv.includes('--dry-run');

let scanned = 0;
let stamped = 0;
let cursor = null;

try {
  for (;;) {
    // Newest first, so a submission that was graded more than once (a rerun) takes the time
    // of its latest evaluation. The `evaluatedAt: null` guard below makes the first write for
    // a given submission the one that sticks.
    const logs = await prisma.activityLog.findMany({
      where: { action: 'SUBMISSION_EVALUATION_SUCCESS', submissionId: { not: null } },
      select: { id: true, submissionId: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (logs.length === 0) break;
    cursor = logs[logs.length - 1].id;

    for (const log of logs) {
      scanned++;
      if (dryRun) {
        // Count what would be written, without writing: a row that still has no result time
        // and does have a result.
        const pending = await prisma.submission.count({
          where: { id: log.submissionId, evaluatedAt: null, correct: { not: null } },
        });
        stamped += pending;
        continue;
      }
      // `correct: { not: null }` keeps a rerun honest: a submission put back on the queue has
      // had its result cleared, and stamping it from an old log would claim a result that no
      // longer exists.
      const written = await prisma.submission.updateMany({
        where: { id: log.submissionId, evaluatedAt: null, correct: { not: null } },
        data: { evaluatedAt: log.timestamp },
      });
      stamped += written.count;
    }

    console.log(`  ${scanned} evaluation entries read, ${stamped} submissions stamped`);
  }

  console.log(
    dryRun
      ? `Dry run: ${stamped} submissions would get a result time, from ${scanned} log entries.`
      : `Done: ${stamped} submissions stamped, from ${scanned} log entries.`,
  );
} finally {
  await prisma.$disconnect();
}
