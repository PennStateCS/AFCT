/**
 * Copy KaTeX's stylesheet and fonts into public/ so the app self-hosts them.
 *
 * This is KaTeX's documented browser setup (https://katex.org/docs/browser): put katex.min.css
 * and the fonts directory next to each other and the stylesheet's relative font urls resolve on
 * their own. Nothing is rewritten here, so the vendored copy is byte-identical to upstream.
 *
 * Why not import the stylesheet through the bundler: its 60 relative font urls become 60 webpack
 * modules in the chunk graph of every route that renders maths, which turned a dev page compile
 * into a multi-minute stall. Served from public/ and linked in the root layout, the bundler
 * never sees it. The fonts are still ours, never fetched from a CDN.
 *
 * Run after changing the katex dependency:  npm run vendor:katex
 */
import { readFileSync, mkdirSync, cpSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'node_modules', 'katex', 'dist');
const out = join(process.cwd(), 'public', 'katex');
const version = JSON.parse(
  readFileSync(join(process.cwd(), 'node_modules', 'katex', 'package.json'), 'utf8'),
).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(join(dist, 'katex.min.css'), join(out, 'katex.min.css'));
cpSync(join(dist, 'fonts'), join(out, 'fonts'), { recursive: true });

console.log(`[vendor-katex] katex ${version} stylesheet + fonts copied to public/katex`);
