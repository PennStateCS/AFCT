// The decorative drawings on the sign-in page's brand panel, read from a folder of SVG files
// rather than written as components.
//
// The point is that the decoration is content, not code: someone can add a diagram by dropping
// a file into public/auth-automata and removing one by deleting it, without touching TypeScript
// or knowing how the crossfade works. public/ rather than somewhere under src/ because the
// runtime image copies public/ wholesale, so the files are there without a Dockerfile change.
//
// Node-only: this reads the filesystem, so it must be imported from a Server Component. Today
// that is src/app/login/page.tsx, which passes the markup down as props. LoginBrandPanel cannot
// do the read itself, because it is pulled into the client bundle by LoginForm.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';

export type AuthAutomaton = {
  /** The file's base name, used as the React key and as the id prefix. */
  id: string;
  /** Inlined into the page, so it is sanitised and its ids are namespaced. See below. */
  markup: string;
};

const FOLDER = path.join(process.cwd(), 'public', 'auth-automata');

/**
 * Elements and attributes that never belong in decoration.
 *
 * These files ship inside the image, so whoever can change them can already change the
 * application: this is not a security boundary and it would be dishonest to present it as one.
 * It is here because the markup is inlined into the login page, which is the one page every
 * user reaches before authenticating, and a stray onload from a drawing exported by some
 * editor should fail loudly at load rather than quietly become script on that page.
 */
const FORBIDDEN_TAGS = ['script', 'foreignObject', 'iframe'];

/**
 * Read once per process.
 *
 * The files are baked into the image, so they cannot change while the server is running: a new
 * drawing needs a redeploy either way. Without this the login page would re-read the folder on
 * every request, and it is the busiest unauthenticated page in the app.
 */
let cached: AuthAutomaton[] | undefined;

/**
 * The drawings, in filename order, ready to inline.
 *
 * Never throws. A missing folder, an unreadable file or a drawing that fails a check is logged
 * and left out, because a decoration must not be able to take the sign-in page down. An empty
 * list simply means the panel draws nothing.
 */
export async function loadAuthAutomata(): Promise<AuthAutomaton[]> {
  if (cached) return cached;

  let names: string[];
  try {
    names = (await readdir(FOLDER))
      .filter((name) => name.toLowerCase().endsWith('.svg'))
      // Sorted so the rotation order is the same on every machine; readdir order is not.
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error('login decoration: cannot read public/auth-automata:', error);
    cached = [];
    return cached;
  }

  const loaded: AuthAutomaton[] = [];
  for (const name of names) {
    const id = name.replace(/\.svg$/i, '');
    try {
      const prepared = prepareAutomaton(await readFile(path.join(FOLDER, name), 'utf8'), id);
      if (prepared) loaded.push({ id, markup: prepared });
    } catch (error) {
      console.error(`login decoration: skipping ${name}:`, error);
    }
  }

  cached = loaded;
  return cached;
}

/** Only for tests, which write files into a temporary folder between cases. */
export function resetAuthAutomataCache(): void {
  cached = undefined;
}

/**
 * One file, checked and rewritten into something safe to inline. Returns null if it cannot be
 * used, having said why.
 */
function prepareAutomaton(raw: string, id: string): string | null {
  let doc: XmlDocument;
  try {
    doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  } catch (error) {
    console.error(`login decoration: ${id} is not parseable XML:`, error);
    return null;
  }

  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') {
    console.error(`login decoration: ${id} has no <svg> root`);
    return null;
  }

  // The panel is one fixed box that every drawing is fitted into, which is what keeps the
  // crossfade free of layout shift. Without a viewBox the browser has no idea what to scale.
  if (!root.getAttribute('viewBox')) {
    console.error(`login decoration: ${id} has no viewBox, so it cannot be fitted to the panel`);
    return null;
  }

  const offence = findOffence(root);
  if (offence) {
    console.error(`login decoration: ${id} rejected, it contains ${offence}`);
    return null;
  }

  // A width or height on the root would fight the wrapper, which sizes the drawing from the
  // panel's aspect box. The viewBox above is what decides the shape.
  root.removeAttribute('width');
  root.removeAttribute('height');

  namespaceIds(root, id);

  // The XML declaration a drawing editor writes is legal in a .svg file and a parse error in
  // the middle of an HTML document, so serialise the element rather than the document.
  return new XMLSerializer().serializeToString(root);
}

/** The first thing in this subtree that must not be inlined, described, or null if it is clean. */
function findOffence(root: XmlElement): string | null {
  for (const tag of FORBIDDEN_TAGS) {
    if (root.getElementsByTagName(tag).length > 0) return `a <${tag}> element`;
  }

  for (const element of walk(root)) {
    for (let i = 0; i < element.attributes.length; i += 1) {
      const attribute = element.attributes.item(i);
      if (!attribute) continue;
      const name = attribute.name.toLowerCase();
      // Every event handler is spelled on-something, so the prefix catches the ones no list
      // would have thought of.
      if (name.startsWith('on')) return `an ${attribute.name} handler`;
      if (/javascript:/i.test(attribute.value)) return `a javascript: url in ${attribute.name}`;
    }
  }

  return null;
}

/**
 * Prefix every id in the drawing with the file's name, and repoint the references to match.
 *
 * All of the drawings are mounted at once so they can crossfade, which puts them in one
 * document: two files that both define `#arrow` would leave one marker, and whichever lost
 * would draw its arrowheads with the other's shape. Two copies of the same drawing under
 * different names is the obvious way to hit this, and it would look like a rendering bug
 * rather than a name clash.
 */
function namespaceIds(root: XmlElement, prefix: string): void {
  const renamed = new Map<string, string>();

  for (const element of walk(root)) {
    const id = element.getAttribute('id');
    if (id) {
      const scoped = `${prefix}-${id}`;
      renamed.set(id, scoped);
      element.setAttribute('id', scoped);
    }
  }
  if (renamed.size === 0) return;

  for (const element of walk(root)) {
    for (let i = 0; i < element.attributes.length; i += 1) {
      const attribute = element.attributes.item(i);
      if (!attribute) continue;

      // `fill="url(#arrow)"`, `marker-end="url(#arrow)"`, `clip-path="url(#mask)"` and the
      // rest all take the same shape, so rewrite the reference rather than listing attributes.
      const rewritten = attribute.value.replace(
        /url\(\s*#([^)\s]+)\s*\)/g,
        (whole, name: string) => {
          const scoped = renamed.get(name);
          return scoped ? `url(#${scoped})` : whole;
        },
      );
      if (rewritten !== attribute.value) attribute.value = rewritten;

      // href="#gradient" on a gradient that inherits another one's stops.
      if (attribute.name === 'href' || attribute.name === 'xlink:href') {
        const target = attribute.value.startsWith('#') ? attribute.value.slice(1) : null;
        const scoped = target ? renamed.get(target) : undefined;
        if (scoped) attribute.value = `#${scoped}`;
      }
    }
  }
}

/** Every element in the subtree, the element itself included. */
function* walk(element: XmlElement): Generator<XmlElement> {
  yield element;
  const children = element.childNodes;
  for (let i = 0; i < children.length; i += 1) {
    const child = children.item(i);
    // 1 is ELEMENT_NODE. Named rather than imported because xmldom's Node constants are on
    // instances, not on the module.
    if (child && child.nodeType === 1) yield* walk(child as XmlElement);
  }
}
