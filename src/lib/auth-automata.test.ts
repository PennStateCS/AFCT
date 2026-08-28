import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The loader reads `public/auth-automata` under the process's working directory, so each case
 * gets a throwaway directory and points cwd at it. Importing fresh per test rather than once at
 * the top, because the module resolves that path when it loads and caches what it read.
 */
let root: string;
let folder: string;

const load = async () => {
  const loader = await import('./auth-automata');
  loader.resetAuthAutomataCache();
  return loader;
};

const write = (name: string, contents: string) => writeFile(path.join(folder, name), contents);

/** A minimal drawing: a viewBox, one shape, and a marker referenced by id. */
const drawing = (id = 'arrow') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
  `<defs><marker id="${id}"><path d="M0 0 10 5 0 10Z" /></marker></defs>` +
  `<line x1="0" y1="0" x2="10" y2="10" marker-end="url(#${id})" /></svg>`;

beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(path.join(tmpdir(), 'afct-automata-'));
  folder = path.join(root, 'public', 'auth-automata');
  await mkdir(folder, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  // The loader logs what it skips, which is the point of the checks; the suite does not need
  // to read it.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('loading the login page decoration', () => {
  it('reads every svg in the folder, in filename order', async () => {
    await write('b-second.svg', drawing());
    await write('a-first.svg', drawing());
    const { loadAuthAutomata } = await load();

    const loaded = await loadAuthAutomata();

    // Sorted, so the rotation is the same order on every machine. readdir order is not.
    expect(loaded.map((a) => a.id)).toEqual(['a-first', 'b-second']);
  });

  it('ignores anything that is not an svg', async () => {
    await write('README.md', '# not a drawing');
    await write('notes.txt', 'nor this');
    await write('real.svg', drawing());
    const { loadAuthAutomata } = await load();

    expect(await loadAuthAutomata()).toHaveLength(1);
  });

  it('returns nothing when the folder is missing, rather than throwing', async () => {
    await rm(folder, { recursive: true });
    const { loadAuthAutomata } = await load();

    // A missing decoration folder must not be able to take the sign-in page down.
    await expect(loadAuthAutomata()).resolves.toEqual([]);
  });

  it('namespaces ids so two files cannot collide', async () => {
    // The realistic way to hit this: copy a drawing, rename the file, edit the shapes, and
    // leave the marker id alone. Both are mounted at once for the crossfade.
    await write('one.svg', drawing());
    await write('two.svg', drawing());
    const { loadAuthAutomata } = await load();

    const [first, second] = await loadAuthAutomata();

    expect(first.markup).toContain('id="one-arrow"');
    expect(first.markup).toContain('url(#one-arrow)');
    expect(second.markup).toContain('id="two-arrow"');
    expect(second.markup).toContain('url(#two-arrow)');
    // The bug this prevents is the two sharing one marker, so the ids must really differ.
    expect(first.markup).not.toContain('#two-arrow');
  });

  it('leaves a reference to an id it does not own alone', async () => {
    await write(
      'external.svg',
      '<svg viewBox="0 0 10 10"><line marker-end="url(#somewhere-else)" /></svg>',
    );
    const { loadAuthAutomata } = await load();

    const [only] = await loadAuthAutomata();

    expect(only.markup).toContain('url(#somewhere-else)');
  });

  it('drops the xml declaration, which is a parse error inside html', async () => {
    await write('declared.svg', `<?xml version="1.0" encoding="UTF-8"?>\n${drawing()}`);
    const { loadAuthAutomata } = await load();

    const [only] = await loadAuthAutomata();

    expect(only.markup).not.toContain('<?xml');
    expect(only.markup.trimStart().startsWith('<svg')).toBe(true);
  });

  it('strips a width and height so the panel decides the size', async () => {
    await write('sized.svg', '<svg viewBox="0 0 10 10" width="400" height="200"></svg>');
    const { loadAuthAutomata } = await load();

    const [only] = await loadAuthAutomata();

    expect(only.markup).not.toMatch(/\swidth="400"/);
    expect(only.markup).not.toMatch(/\sheight="200"/);
    expect(only.markup).toContain('viewBox="0 0 10 10"');
  });

  it('skips a drawing with no viewBox, since it cannot be fitted', async () => {
    await write('no-viewbox.svg', '<svg width="10" height="10"><circle r="4" /></svg>');
    await write('fine.svg', drawing());
    const { loadAuthAutomata } = await load();

    expect((await loadAuthAutomata()).map((a) => a.id)).toEqual(['fine']);
  });

  it('skips a file that is not an svg at all', async () => {
    await write('wrong-root.svg', '<html><body>hello</body></html>');
    const { loadAuthAutomata } = await load();

    expect(await loadAuthAutomata()).toEqual([]);
  });

  it.each([
    ['a script element', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'],
    ['an event handler', '<svg viewBox="0 0 1 1"><circle onload="alert(1)" r="1" /></svg>'],
    ['a javascript: url', '<svg viewBox="0 0 1 1"><a href="javascript:alert(1)" /></svg>'],
    ['a foreignObject', '<svg viewBox="0 0 1 1"><foreignObject><b>x</b></foreignObject></svg>'],
  ])('refuses a drawing carrying %s', async (_label, contents) => {
    await write('hostile.svg', contents);
    const { loadAuthAutomata } = await load();

    // This markup is inlined into the one page every user reaches before authenticating, so a
    // drawing that would become script there is left out rather than cleaned up and used.
    expect(await loadAuthAutomata()).toEqual([]);
  });

  it('reads the folder once and serves the rest from memory', async () => {
    await write('one.svg', drawing());
    const { loadAuthAutomata } = await load();

    await loadAuthAutomata();
    // The files are baked into the image, so a new drawing needs a redeploy either way. This
    // is what stops the busiest unauthenticated page in the app hitting the disk per request.
    await write('two.svg', drawing());

    expect(await loadAuthAutomata()).toHaveLength(1);
  });
});
