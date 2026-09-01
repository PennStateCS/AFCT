import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import path from 'node:path';

/**
 * Every place that renders a viewer dialog has to offer the standalone window.
 *
 * This exists because the first version of the feature missed two screens. The dialogs are
 * rendered from four components, not one, and wiring only the shared dispatcher left the
 * course Problems tab and the problem details panel without a button, which is exactly
 * where somebody looked first. A grep is a blunt instrument, but the failure was structural
 * rather than logical: nothing was wrong with the code that existed, there was simply less
 * of it than there needed to be.
 */

const ROOT = path.resolve(__dirname, '../../..');
const DIALOGS = ['<JffViewerDialog', '<RegexViewerDialog', '<CfgViewerDialog'];

/** Files that render a viewer dialog, excluding the dispatcher's own definition and tests. */
function callSites(): string[] {
  const files = globSync('src/**/*.tsx', { cwd: ROOT })
    .filter((f) => !f.includes('.test.'))
    .filter((f) => !f.endsWith('SubmissionViewerDialog.tsx'));
  return files.filter((f) => {
    const source = readFileSync(path.join(ROOT, f), 'utf8');
    return DIALOGS.some((d) => source.includes(d));
  });
}

describe('the standalone window is offered everywhere a viewer dialog is opened', () => {
  const sites = callSites();

  it('finds the call sites at all, so the check cannot pass by finding nothing', () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it.each(callSites())('%s passes a windowTarget', (file) => {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    expect(source).toContain('windowTarget');
  });
});

/**
 * Every dispatcher call site should also hand over the file's own name.
 *
 * Not a correctness rule, a completeness one: without it the standalone window's tab falls
 * back to the composed heading ("answer.jff - Three Consecutive 1s") rather than the file
 * name. That is not broken, so nothing fails, which is exactly why it went unnoticed on four
 * screens until somebody opened one of them.
 */
describe('the standalone window is told the file name', () => {
  const dispatcherSites = () =>
    globSync('src/**/*.tsx', { cwd: ROOT })
      .filter((f) => !f.includes('.test.'))
      .filter((f) => !f.endsWith('SubmissionViewerDialog.tsx'))
      .filter((f) => readFileSync(path.join(ROOT, f), 'utf8').includes('<SubmissionViewerDialog'));

  it('finds the call sites at all', () => {
    expect(dispatcherSites().length).toBeGreaterThan(0);
  });

  it.each(dispatcherSites())('%s passes a fileName', (file) => {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    // Read the element itself, so a fileName belonging to some other component nearby does
    // not make this pass.
    const start = source.indexOf('<SubmissionViewerDialog');
    const element = source.slice(start, source.indexOf('/>', start));
    expect(element).toContain('fileName=');
  });
});
