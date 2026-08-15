// Fingerprint submissions that were stored before the server started doing it.
//
// The Similarity tab reads `Submission.contentHash` and `shapeHash`, both written when a
// file arrives. Anything submitted earlier has neither and would never match anything, so
// this reads each stored file once and fills them in. Safe to run more than once: it only touches rows that
// have a file and no hash yet, and it never changes a hash that already exists.
//
// Run it where the uploads volume is mounted, which is the app container:
//   docker exec afct-dev sh -c 'cd /app && node scripts/backfill-content-hashes.mjs'
//
// Pass --dry-run to see what it would do without writing anything.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Both the hashing rule and the database client are loaded from the app's own TypeScript
// through tsx, so there is one definition of a submission's fingerprint and one place that
// knows how to connect (Prisma 7 needs the driver adapter this client already sets up).
const require = createRequire(import.meta.url);
require('tsx/cjs');
const { submissionContentHash, submissionShapeHash } = require('../src/lib/similarity/content-hash.ts');
const { extractProvenanceFeatures } = require('../src/lib/similarity/provenance.ts');
const { prisma } = require('../src/lib/prisma.ts');

const UPLOAD_DIR = path.join('/private', 'uploads', 'submissions');
const SOLUTION_DIR = path.join('/private', 'uploads', 'solutions');
const BATCH = 200;
const dryRun = process.argv.includes('--dry-run');

let scanned = 0;
let hashed = 0;
let missing = 0;
// Rows this pass looked at but did not write: a file that could not be hashed, and every
// row during a dry run. They stay eligible for the next query, so the window has to step
// past them or the loop reads the same batch forever.
let leftBehind = 0;

try {
  for (;;) {
    const batch = await prisma.submission.findMany({
      where: { contentHash: null, fileName: { not: null } },
      select: { id: true, fileName: true },
      orderBy: { submittedAt: 'asc' },
      take: BATCH,
      skip: leftBehind,
    });
    if (batch.length === 0) break;

    for (const submission of batch) {
      scanned++;
      try {
        const buffer = await readFile(path.join(UPLOAD_DIR, submission.fileName));
        const contentHash = submissionContentHash(buffer);
        const shapeHash = submissionShapeHash(buffer);
        if (!contentHash) {
          missing++;
          leftBehind++;
          continue;
        }
        if (dryRun) {
          leftBehind++;
        } else {
          await prisma.submission.update({
            where: { id: submission.id },
            data: {
              contentHash,
              shapeHash,
              provenanceFeatures: extractProvenanceFeatures(buffer) ?? undefined,
            },
          });
        }
        hashed++;
      } catch (error) {
        // A submission whose file is gone (an old prune, a restore) simply never matches.
        missing++;
        leftBehind++;
        console.warn(`  skipped ${submission.id}: ${error.message}`);
      }
    }

    console.log(`  ${scanned} scanned, ${hashed} hashed, ${missing} skipped`);
  }

  console.log(
    dryRun
      ? `Dry run: ${hashed} submissions would be fingerprinted, ${missing} skipped.`
      : `Done: ${hashed} submissions fingerprinted, ${missing} skipped.`,
  );

  // Reference solutions too: without these the tab cannot say when matching work is simply
  // the answer the instructor posted.
  const problems = await prisma.problem.findMany({
    where: { fileName: { not: null }, answerContentHash: null },
    select: { id: true, fileName: true },
  });
  let answers = 0;
  for (const problem of problems) {
    try {
      const buffer = await readFile(path.join(SOLUTION_DIR, problem.fileName));
      const answerContentHash = submissionContentHash(buffer);
      if (!answerContentHash) continue;
      if (!dryRun) {
        await prisma.problem.update({
          where: { id: problem.id },
          data: { answerContentHash, answerShapeHash: submissionShapeHash(buffer) },
        });
      }
      answers++;
    } catch (error) {
      console.warn(`  skipped problem ${problem.id}: ${error.message}`);
    }
  }
  console.log(
    dryRun
      ? `Dry run: ${answers} answer files would be fingerprinted.`
      : `Done: ${answers} answer files fingerprinted.`,
  );
} finally {
  await prisma.$disconnect();
}
