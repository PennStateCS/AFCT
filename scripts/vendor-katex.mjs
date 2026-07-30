/**
 * Copy KaTeX's stylesheet and fonts into public/ so the app self-hosts them.
 *
 * This follows KaTeX's documented browser setup (https://katex.org/docs/browser): put
 * katex.min.css and a fonts directory next to each other and the stylesheet's relative font urls
 * resolve on their own.
 *
 * Why not import the stylesheet through the bundler: its font urls become bundler modules in the
 * chunk graph of every route that renders maths, which turned a dev page compile into a
 * multi-minute stall. Served from public/ and linked in the root layout, the bundler never sees
 * it. The fonts are ours, never fetched from a CDN.
 *
 * WOFF2 ONLY. Upstream ships each face three times (woff2, woff, ttf) and declares all three in
 * one `src` list. A browser picks the first format it supports, so every browser AFCT supports
 * takes the woff2 and the other two are dead weight: 20 of 60 files carry all the glyphs, and
 * dropping the rest takes public/katex from about 1.2 MB to about 400 KB in the repo and in every
 * Docker image built from it.
 *
 * Browser support assumption: WOFF2 has been supported since Chrome 36, Firefox 39, Safari 10,
 * and Edge 14 (2016). AFCT is a TLS-only Next.js 16 app whose supported browsers all clear that
 * bar by a wide margin. A browser too old for WOFF2 would fail on far more than the maths. If
 * that assumption ever changes, set KEEP_FORMATS below back to all three and re-run this script.
 *
 * Run after changing the katex dependency, then commit the result:  npm run vendor:katex
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Font formats kept in the vendored copy. See the note above before changing this. */
const KEEP_FORMATS = ['woff2'];

const dist = join(process.cwd(), 'node_modules', 'katex', 'dist');
const out = join(process.cwd(), 'public', 'katex');
const version = JSON.parse(
  readFileSync(join(process.cwd(), 'node_modules', 'katex', 'package.json'), 'utf8'),
).version;

/**
 * Drop the `url(...) format(...)` entries for formats we no longer ship.
 *
 * Each `src` is a comma-separated preference list, so removing an entry is a delete rather than a
 * rewrite: the remaining url keeps its original text and still resolves relative to the
 * stylesheet. Leaving them in would point at files that are not there, which is the one thing the
 * verification below must never see.
 */
function keepOnlyKeptFormats(css) {
  const dropped = /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g;
  return css.replace(dropped, '');
}

/** Every font file the stylesheet actually asks for. */
function referencedFonts(css) {
  return [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].replace(/^["']|["']$/g, ''));
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

const css = keepOnlyKeptFormats(readFileSync(join(dist, 'katex.min.css'), 'utf8'));
writeFileSync(join(out, 'katex.min.css'), css);

const wanted = referencedFonts(css);
for (const ref of wanted) {
  // The stylesheet references fonts as `fonts/NAME.woff2`, relative to itself.
  copyFileSync(join(dist, ref), join(out, ref));
}

// Verify before declaring success, so a KaTeX upgrade that renames or drops a face fails loudly
// here instead of shipping a stylesheet pointing at missing files.
const missing = wanted.filter((ref) => {
  try {
    readFileSync(join(out, ref));
    return false;
  } catch {
    return true;
  }
});
if (missing.length > 0) {
  console.error(`[vendor-katex] referenced fonts are missing: ${missing.join(', ')}`);
  process.exit(1);
}

const copied = readdirSync(join(out, 'fonts'));
const orphans = copied.filter((name) => !wanted.includes(`fonts/${name}`));
if (orphans.length > 0) {
  // A stale file left behind by a previous version is how a "byte-identical" copy quietly stops
  // matching the installed package.
  console.error(`[vendor-katex] unreferenced font files were written: ${orphans.join(', ')}`);
  process.exit(1);
}

const unexpectedFormat = wanted.filter(
  (ref) => !KEEP_FORMATS.some((ext) => ref.endsWith(`.${ext}`)),
);
if (unexpectedFormat.length > 0) {
  console.error(
    `[vendor-katex] stylesheet still references dropped formats: ${unexpectedFormat.join(', ')}`,
  );
  process.exit(1);
}

console.log(
  `[vendor-katex] katex ${version}: stylesheet + ${copied.length} ${KEEP_FORMATS.join('/')} fonts written to public/katex`,
);
