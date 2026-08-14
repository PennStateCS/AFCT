/**
 * Merge the unit and database coverage runs into one picture.
 *
 * Neither run alone is the truth. The unit suite mocks Prisma, so anything whose tests live in a
 * `.db.test.ts` file reads as almost untested there: `src/lib/lti/launch.ts` measures 5.6% from
 * the unit run and 87.5% once merged. Reporting a file as uncovered without checking for a
 * database sibling is how a well-tested file gets "fixed".
 *
 * Usage, after running each suite with --coverage.reporter=json into its own directory:
 *   node merge-coverage.mjs coverage-unit coverage-db
 *
 * Lives in the repo root rather than scripts/ so the istanbul import resolves.
 */
// CommonJS, so the default import rather than a named one.
import istanbul from 'istanbul-lib-coverage';
const { createCoverageMap } = istanbul;
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node merge-coverage.mjs <dir> [dir...]');
  process.exit(1);
}

/**
 * The database config declares no coverage excludes, so merging pulls in files the unit config
 * deliberately ignores: the vendored `lib/java-runner.js`, and every `page.tsx`/`layout.tsx`
 * (Next server components the unit suite cannot render). Left in, they read as huge gaps that no
 * test was ever meant to fill, which buries the real ones.
 */
const EXCLUDED = [
  /^lib\/[^/]+\.js$/,
  /^src\/app\/.*\/(page|layout)\.tsx$/,
  /^src\/app\/(page|layout)\.tsx$/,
  /^src\/types\//,
  /^src\/env\.mjs$/,
  /^src\/app\/fonts\.ts$/,
  /^prisma\//,
];
const excluded = (rel) => EXCLUDED.some((re) => re.test(rel));

const map = createCoverageMap({});
for (const dir of dirs) {
  const file = path.join(dir, 'coverage-final.json');
  map.merge(JSON.parse(readFileSync(file, 'utf8')));
}

const rows = [];
let totals = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };

for (const file of map.files()) {
  const s = map.fileCoverageFor(file).toSummary();
  const rel = path.relative(process.cwd(), file);
  if (excluded(rel)) continue;
  rows.push({
    file: rel,
    lines: s.lines.pct,
    uncovered: s.lines.total - s.lines.covered,
    total: s.lines.total,
    branches: s.branches.pct,
    functions: s.functions.pct,
  });
  totals.lines[0] += s.lines.covered;
  totals.lines[1] += s.lines.total;
  totals.branches[0] += s.branches.covered;
  totals.branches[1] += s.branches.total;
  totals.functions[0] += s.functions.covered;
  totals.functions[1] += s.functions.total;
}

const pct = ([c, t]) => (t === 0 ? 100 : (c / t) * 100).toFixed(2);
console.log(
  `MERGED  lines ${pct(totals.lines)}%  branches ${pct(totals.branches)}%  functions ${pct(totals.functions)}%  (${rows.length} files)`,
);

// Ranked by uncovered LINE COUNT, not percentage: a 40% file with 20 lines is noise next to a
// 60% file with 90.
console.log('\nBiggest gaps by uncovered lines:\n');
rows
  .filter((r) => r.uncovered > 0)
  .sort((a, b) => b.uncovered - a.uncovered)
  .slice(0, 30)
  .forEach((r) =>
    console.log(
      `  ${String(r.uncovered).padStart(4)} uncovered  ${r.lines.toFixed(1).padStart(5)}%  ${r.file}`,
    ),
  );

const zero = rows.filter((r) => r.lines === 0 && r.total > 5).sort((a, b) => b.total - a.total);
console.log(`\nZero coverage, more than 5 lines (${zero.length} files):\n`);
zero.slice(0, 25).forEach((r) => console.log(`  ${String(r.total).padStart(4)} lines  ${r.file}`));
