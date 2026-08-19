import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The generated API types, checked for a failure that is invisible at every other layer.
 *
 * The generator binds an `@openapi` block to the declaration that follows it. Putting a helper
 * function between the block and its route export silently detaches the two: the route keeps
 * working, the tests keep passing, and the published reference quietly loses the response it
 * documented, leaving `content?: never` where a schema used to be. That happened to
 * `GET /api/admin/settings`, and nothing caught it because nothing looks at this file.
 *
 * Read as text on purpose. The point is to notice a documented response disappearing, and the
 * file this asserts on is the one that is committed and shipped.
 */

const generated = readFileSync(path.join(process.cwd(), 'src/types/api.ts'), 'utf8');

/** The body of one generated operation, from its name to the start of the next. */
function operation(name: string): string {
  const start = generated.indexOf(`    ${name}: {`);
  expect(start, `no generated operation called ${name}`).toBeGreaterThan(-1);
  const next = generated.indexOf('\n    };\n', start);
  return generated.slice(start, next === -1 ? undefined : next);
}

describe('operations that answer with JSON', () => {
  /**
   * One per family rather than all of them: enough that a detached block on a busy route is
   * caught, without turning this into a copy of the route list.
   */
  const answersWithJson = [
    'getAdminSettings',
    'getAdminUsers',
    'getCourses',
    'getMe',
  ];

  it.each(answersWithJson)('%s documents a response body', (name) => {
    const body = operation(name);

    expect(body).toContain('"application/json"');
    // `content?: never` is what a detached documentation block leaves behind.
    expect(body).not.toContain('content?: never');
  });

  /** The fields this settings screen reads to tell "enabled" from "enabled but unusable". */
  it('describes whether each stored secret can be read', () => {
    const body = operation('getAdminSettings');

    expect(body).toContain('oidcClientSecretReadable');
    expect(body).toContain('smtpPasswordReadable');
  });
});
