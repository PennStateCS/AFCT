/**
 * Building the answer a student sends.
 *
 * A submission used to be a randomly chosen sample file, so a regular-expression problem was
 * answered with a Turing machine. Nothing about that is wrong in the database, and everything
 * about it is wrong on screen: the type badge disagrees with the file, the evaluator would
 * reject every attempt, and the Similarity report compared machines nobody was asked to build.
 *
 * What follows builds an answer *to the problem set*, starting from the solution file the problem
 * was created with, which is what a correct submission actually looks like.
 *
 * These live apart from `seed-dev-extras.ts` because they are the part worth testing: they are
 * pure, they encode what each of the three similarity fingerprints is supposed to catch, and both
 * bugs found in review were in here rather than in the database work around them. See
 * `seed-answers.test.ts`, which asserts the properties those bugs broke.
 */

import fs from 'fs/promises';
import path from 'path';
import type { ProblemType } from '@prisma/client';

/**
 * The same machine, moved and renamed.
 *
 * This is the ordinary case, not the suspicious one: two students who both solve "three
 * consecutive 1s" correctly have built the same automaton and laid it out differently. It keeps
 * the shape hash and changes the content hash, so it is also what a copied file looks like once
 * somebody has dragged the states around, and the report tells the two apart by how rare the
 * value is rather than by the match itself.
 *
 * A grammar has no layout, so its productions are reordered instead (the shape hash sorts them).
 * A regular expression has neither, so it comes back unchanged, which is the honest answer: two
 * students writing `[0-9]` really have sent the same file.
 *
 * That last case is worth knowing when reading the seeded Similarity report. In a regular
 * expression problem the planted pair is **not** distinguishable from the students who simply
 * wrote the same right answer, because in a file with no layout there is nothing to tell them
 * apart, and most of the class ends up in one large match group. That is not a fault in the seed
 * or in the detector: it is why a match is read against how rare it is, and why the report marks
 * a group that large as common rather than as evidence. The planted pair is legible in the
 * automaton problems, where a file carries layout.
 */
export function redraw(base: string, offset: number): string {
  if (base.includes('<production>')) {
    const productions = base.match(/\t*<production>[\s\S]*?<\/production>\n?/g) ?? [];
    if (productions.length < 2) return base;
    // Never the identity rotation, which would hand back the posted grammar itself and put a
    // student who reordered nothing into the copied pair's match group. A two-production
    // grammar only has one other ordering to offer, so they all share that one, which is what
    // convergence on a small grammar honestly looks like.
    const shift = (offset % (productions.length - 1)) + 1;
    const reordered = [...productions.slice(shift), ...productions.slice(0, shift)].join('');
    return base.replace(/\t*<production>[\s\S]*<\/production>\n?/, reordered);
  }
  return base
    .replace(/<x>([\d.]+)<\/x>/g, (_, x) => `<x>${Number(x) + 13 * offset}</x>`)
    .replace(/<y>([\d.]+)<\/y>/g, (_, y) => `<y>${Number(y) + 7 * offset}</y>`)
    .replace(/<state id="(\d+)" name="[^"]*">/g, (_, id) => `<state id="${id}" name="s${id}">`);
}

/**
 * A copy of somebody else's file with one thing changed.
 *
 * The layout, the state ids and the curve adjustments all stay exactly as they were, which is
 * what `provenanceFeatures` describes and what neither hash can catch on its own. This is the
 * case the third fingerprint exists for.
 */
export function editOneTransition(base: string): string {
  if (base.includes('<expression>')) {
    return base.replace(/<expression>[\s\S]*?<\/expression>/, '<expression>[0-9]*</expression>');
  }
  if (base.includes('<production>')) {
    return base.replace(/<right>([^<]*)<\/right>/, (_, right) => `<right>${right}b</right>`);
  }
  // A transition that reads nothing is written `<read/>`, not `<read></read>`, and the pushdown
  // sample is built entirely from those. Matching only the paired form left the edit a silent
  // no-op there, so the student who was supposed to have altered a copy sent one byte for byte
  // and joined the pair who had not altered anything. Reading a symbol where the original read
  // none is a real change to the machine, which is what this is meant to be.
  if (/<read>[^<]*<\/read>/.test(base)) {
    return base.replace(/<read>([^<]*)<\/read>/, (_, symbol) =>
      symbol === '1' ? '<read>0</read>' : '<read>1</read>',
    );
  }
  return base.replace(/<read\s*\/>/, '<read>a</read>');
}

/**
 * Pick from a list by variant number, spreading consecutive variants apart.
 *
 * `items[variant % items.length]` looks equivalent and is not. The variant numbers advance by a
 * fixed stride per student, so whenever that stride and the list length share a factor the
 * remainder stops depending on the student at all: with five regular expressions and a stride of
 * five, every student's first attempt was the same expression and fourteen of eighteen landed in
 * one match group. Mixing the bits first makes the choice independent of both lengths.
 */
export function choose<T>(items: T[], variant: number): T {
  let h = Math.imul(variant + 1, 2654435761) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  return items[h % items.length]!;
}

/**
 * A different machine: somebody's own attempt, usually an earlier and wrong one.
 *
 * Deliberately not a redraw. If every student sent the same machine the whole cohort would be one
 * match group and the report would have nothing to say, which is the opposite of the problem it
 * solves. `variant` shifts what changes so two independent students do not accidentally agree.
 */
export function ownAttempt(base: string, variant: number): string {
  if (base.includes('<expression>')) {
    // Plausible answers to "a single digit", right and wrong, the way a class actually varies.
    //
    // None of them may be the posted answer itself. `[0-9]` was in this list, so one student in
    // six sent a file byte-identical to the solution and joined the copied pair's exact-match
    // group without having copied anything, which made the planted case impossible to pick out
    // from the ordinary work around it. Students converging on the identical answer is real and
    // is worth seeing; it belongs to the `converged` behaviour, where it is deliberate.
    const expressions = [
      '(0|1|2|3|4|5|6|7|8|9)',
      '[0123456789]',
      '[0-9][0-9]*',
      '[0-9]+',
      '(0+1+2+3+4+5+6+7+8+9)',
    ];
    return base.replace(
      /<expression>[\s\S]*?<\/expression>/,
      `<expression>${choose(expressions, variant)}</expression>`,
    );
  }
  if (base.includes('<production>')) {
    // `a` is the posted grammar's own first production, so it is left out for the reason above.
    const rights = ['aSb', 'aS', 'Sb', 'ab', 'aAb', 'aSbb'];
    return base.replace(/<right>([^<]*)<\/right>/, `<right>${choose(rights, variant)}</right>`);
  }

  // Drop a transition and change a symbol: a machine that is recognisably an attempt at the same
  // problem and is not the same machine.
  const transitions = base.match(/\t*<transition>[\s\S]*?<\/transition>\n?/g) ?? [];
  let mutated = base;
  if (transitions.length > 2) {
    mutated = mutated.replace(choose(transitions, variant), '');
  }
  let seen = 0;
  mutated = mutated.replace(/<read>([^<]*)<\/read>/g, (whole, symbol) => {
    seen += 1;
    if (seen !== 1 + (variant % 2)) return whole;
    return symbol === '1' ? '<read>0</read>' : '<read>1</read>';
  });

  // Laid out this student's own way on top of that. There are only so many ways to break a
  // four-state machine, so without this two people who happened to make the same mistake sent
  // the identical file and turned up as an exact match, which is the one thing in the report
  // that is supposed to be worth reading.
  return redraw(mutated, variant + 3);
}

/** JFLAP's own type tag, mapped to the problem types AFCT stores. */
export const JFF_TYPES: Record<string, ProblemType> = {
  fa: 'FA',
  pda: 'PDA',
  turing: 'TM',
  grammar: 'CFG',
  re: 'RE',
};

/**
 * Every sample file, keyed by the problem type it answers.
 *
 * Read from the file rather than the filename: `collatzUnaryTM.jff` says it is a Turing machine
 * in its own `<type>` tag, and a file renamed later should not change what it is.
 */
export async function loadSamples(): Promise<Map<ProblemType, Map<string, string>>> {
  const dir = path.join(process.cwd(), 'prisma', 'solution_files');
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.jff')).sort();
  const byType = new Map<ProblemType, Map<string, string>>();

  for (const name of names) {
    const content = await fs.readFile(path.join(dir, name), 'utf8');
    const tag = /<type>([^<]*)<\/type>/.exec(content)?.[1]?.trim().toLowerCase() ?? '';
    const type = JFF_TYPES[tag];
    if (!type) continue;
    const forType = byType.get(type) ?? new Map<string, string>();
    forType.set(name, content);
    byType.set(type, forType);
  }
  return byType;
}
