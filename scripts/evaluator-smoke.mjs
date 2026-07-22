// Golden smoke test for the shipped evaluator jar (jars/afct-evaluator.jar).
//
// WHY: the evaluator is the grading oracle. This test runs the *exact* jar that
// ships in the build against a set of known submission/answer pairs and asserts the
// correct/incorrect verdict, so a regressed, mis-swapped, or mis-invoked evaluator
// fails the build instead of silently mis-grading students. It deliberately reuses
// the production invocation (lib/java-runner.js) so it exercises the same JVM flags,
// env allowlist, timeout, and output cap the worker uses.
//
// ADD CASES: drop the .jff files in test/evaluator/cases and add an entry to
// test/evaluator/manifest.json. See test/evaluator/README.md.
//
// RUN: `npm run test:evaluator` (needs a JRE; the CI `evaluator` job sets one up).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaRunner from '../lib/java-runner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_DIR = path.join(ROOT, 'test', 'evaluator');
const CASES_DIR = path.join(EVAL_DIR, 'cases');
const JAR = path.join(ROOT, 'jars', 'afct-evaluator.jar');
const CFGANALYZER = path.join(ROOT, 'bin', 'cfganalyzer');

// Per-type CLI args appended after `--json <answer> <submission>`. Mirrors
// buildEvaluatorArgs() in src/lib/submission-worker.ts so this matches production.
function typeArgs(c) {
  if (c.type === 'FA') return [String(c.maxStates ?? -1), String(c.deterministic ?? false)];
  if (c.type === 'PDA') return [String(c.maxStates ?? -1)];
  return [];
}

// The jar prints only the result JSON on stdout in --json mode, but be tolerant of
// any stray leading output by falling back to the last JSON object.
function parseFeedback(stdout) {
  const trimmed = (stdout ?? '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}\s*$/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`no JSON in evaluator output: ${trimmed.slice(0, 200)}`);
  }
}

const manifest = JSON.parse(await readFile(path.join(EVAL_DIR, 'manifest.json'), 'utf8'));
const runner = new JavaRunner(JAR);
const evalEnv = {
  CFGANALYZER_BINARY: CFGANALYZER,
  CFGANALYZER_LIMIT: String(manifest.analyzerLimit ?? 15),
};

console.log(`Evaluating ${manifest.cases.length} golden case(s) against ${path.relative(ROOT, JAR)}\n`);

let failures = 0;
for (const c of manifest.cases) {
  const answer = path.join(CASES_DIR, c.answer);
  const submission = path.join(CASES_DIR, c.submission);
  const args = ['--json', answer, submission, ...typeArgs(c)];

  try {
    const { stdout } = await runner.execute(args, {
      timeout: 60_000,
      maxMemoryMb: 512,
      env: evalEnv,
    });
    const feedback = parseFeedback(stdout);
    if (typeof feedback.correct !== 'boolean') {
      throw new Error(`evaluator returned no boolean 'correct' (feedback: ${feedback.feedback ?? '?'})`);
    }
    if (feedback.correct === c.expectCorrect) {
      console.log(`  ok    ${c.name}  (correct=${feedback.correct})`);
    } else {
      failures++;
      console.error(
        `  FAIL  ${c.name}\n        expected correct=${c.expectCorrect}, got ${feedback.correct}` +
          `\n        feedback: ${feedback.feedback ?? ''}`,
      );
    }
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${c.name}\n        evaluator error: ${err.message}`);
  }
}

const passed = manifest.cases.length - failures;
console.log(`\n${passed}/${manifest.cases.length} evaluator cases passed`);
process.exit(failures ? 1 : 0);
