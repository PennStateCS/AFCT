import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

/**
 * Everything the worker reaches at runtime must be a production dependency.
 *
 * The submission worker is the one process that runs the TypeScript source directly
 * (`npx tsx src/worker.ts`), rather than a bundle. The web app is compiled by Next while dev
 * packages are installed, so it can import anything and still ship; the worker cannot. Its image
 * is built with `npm ci --omit=dev`, so a static import of a devDependency anywhere in its graph
 * resolves at startup and kills the process.
 *
 * That is not hypothetical. v0.9.4 could not be deployed because `chalk` moved to
 * devDependencies while `lib/prisma.ts` still imported it at module scope: the worker crash
 * looped and the updater rolled the release back three times. Nothing caught it first, because
 * both vitest and `npm run build` run with dev packages present and so cannot see the problem.
 * This test can, because it reads the manifest rather than the installed tree.
 *
 * Dynamic imports are deliberately NOT followed. `import()` inside a development-only branch is
 * the sanctioned way to use a dev package from shared code, and is how the original fix works.
 */

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src/worker.ts');

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const productionDeps = new Set(Object.keys(pkg.dependencies ?? {}));
const devDeps = new Set(Object.keys(pkg.devDependencies ?? {}));
const builtins = new Set(builtinModules);

/** Static specifiers only: `import x from 'y'`, `export * from 'y'`, bare `import 'y'`. */
const SPECIFIER = /(?:^|\n)\s*(?:import|export)(?:[\s\S]*?from)?\s*['"]([^'"]+)['"]/g;
/** `import type ... ` / `export type ...` vanish at compile time, so they cannot crash anything. */
const TYPE_ONLY = /(?:^|\n)\s*(?:import|export)\s+type\b/;

/** Turn a package specifier into the name that appears in package.json. */
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Resolve a relative or `@/` specifier to a file on disk, or null if it is a package. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(ROOT, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Walk the static import graph from the worker entrypoint. */
function walk(entry: string) {
  const seen = new Set<string>();
  const packages = new Map<string, string[]>(); // package -> files importing it
  const unresolved: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      // matchAll gives the whole statement in [0]; skip the type-only forms.
      if (TYPE_ONLY.test(match[0])) continue;
      const specifier = match[1];

      const local = resolveLocal(file, specifier);
      if (local) {
        queue.push(local);
        continue;
      }
      if (specifier.startsWith('.') || specifier.startsWith('@/')) {
        unresolved.push(`${path.relative(ROOT, file)} -> ${specifier}`);
        continue;
      }
      const name = packageName(specifier);
      const importers = packages.get(name) ?? [];
      importers.push(path.relative(ROOT, file));
      packages.set(name, importers);
    }
  }
  return { files: seen, packages, unresolved };
}

describe('the submission worker runs without dev dependencies', () => {
  const graph = walk(ENTRY);

  it('reaches a meaningful part of the codebase, so a pass is not vacuous', () => {
    // If the walker silently resolved nothing, every other assertion here would pass by default.
    expect(graph.files.size).toBeGreaterThan(10);
    expect(graph.packages.size).toBeGreaterThan(3);
  });

  it('resolves every relative and aliased import it finds', () => {
    // An unresolved local import is a hole in the walk, which would hide packages beyond it.
    expect(graph.unresolved).toEqual([]);
  });

  it('imports no devDependency anywhere in its static graph', () => {
    const offenders = [...graph.packages.entries()]
      .filter(([name]) => devDeps.has(name) && !productionDeps.has(name))
      .map(([name, importers]) => `${name} (imported by ${[...new Set(importers)].join(', ')})`);

    // The failure message names the file to fix, because the runtime error this prevents points
    // at a require stack rather than at the package.json line that actually moved.
    expect(offenders).toEqual([]);
  });

  it('imports nothing that is missing from package.json altogether', () => {
    const unknown = [...graph.packages.keys()].filter(
      (name) =>
        !productionDeps.has(name) &&
        !devDeps.has(name) &&
        !builtins.has(name) &&
        !name.startsWith('node:'),
    );

    expect(unknown).toEqual([]);
  });
});
