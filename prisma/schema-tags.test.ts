import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The comment tags that decide what the generated ER diagrams look like.
 *
 * `docs-site/docs/reference/database-schema.md` is produced by prisma-markdown from
 * `/// @namespace` and `/// @erd` tags. Both failure modes are silent: the generator does not
 * complain, the build passes, and the only symptom is a diagram nobody notices is wrong.
 *
 * Both have happened. Three models once drifted into a chapter literally called `default`, and
 * `LtiDeepLink` was tagged `@namespace lti` in lowercase while its ten siblings said something
 * else, which produced a chapter of one orphaned table. Neither was found by a test; they were
 * found by reading the rendered page months later.
 */
const schema = readFileSync(join(__dirname, 'schema.prisma'), 'utf8');

/** The chapters this schema is organised into. A new one is a decision, not a typo. */
const CHAPTERS = ['Identity', 'LTI', 'Courses', 'Assignments', 'Submissions', 'System'];

type Model = { name: string; namespaces: string[]; erds: string[] };

/** Every model, with the tags in the doc comment directly above it. */
function models(): Model[] {
  const found: Model[] = [];
  const re = /((?:^\/\/\/.*\n)*)model (\w+) \{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) {
    const [, doc = '', name = ''] = m;
    found.push({
      name,
      namespaces: [...doc.matchAll(/@namespace (\S+)/g)].map((x) => x[1]!),
      erds: [...doc.matchAll(/@erd (\S+)/g)].map((x) => x[1]!),
    });
  }
  return found;
}

describe('ERD comment tags', () => {
  it('finds the models at all, so an empty pass cannot look like success', () => {
    expect(models().length).toBeGreaterThan(30);
  });

  /**
   * A model with no `@namespace` lands in a chapter called `default`, drawn as an isolated
   * table whose foreign keys point at nothing.
   */
  it('gives every model a namespace', () => {
    const untagged = models()
      .filter((m) => m.namespaces.length === 0)
      .map((m) => m.name);
    expect(untagged, `models with no /// @namespace tag: ${untagged.join(', ')}`).toEqual([]);
  });

  /**
   * Chapter names are matched as written, so `lti` and `LTI` are two different chapters and
   * one of them holds a single table. This is the check that would have caught that.
   */
  it('uses only the chapters this schema is organised into', () => {
    const stray = models()
      .flatMap((m) => [...m.namespaces, ...m.erds])
      .filter((chapter) => !CHAPTERS.includes(chapter));
    expect([...new Set(stray)], 'unknown chapter names (a typo, or a deliberate new chapter)').toEqual(
      [],
    );
  });

  it('does not put a model in a chapter twice', () => {
    for (const model of models()) {
      const all = [...model.namespaces, ...model.erds];
      expect(new Set(all).size, `${model.name} repeats a chapter`).toBe(all.length);
    }
  });
});
