/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  readTabs,
  readActiveIndex,
  tabsToSearch,
  withTab,
  withoutTab,
  MAX_VIEWER_TABS,
  type ViewerTab,
} from './viewer-tabs';

const tab = (file: string, name = file): ViewerTab => ({
  kind: 'submissions',
  file,
  type: 'FA',
  name,
  title: `${name} - Problem`,
});

const params = (s: string) => new URLSearchParams(s);

describe('reading tabs out of a URL', () => {
  it('reads a list', () => {
    const search = tabsToSearch([tab('a.jff'), tab('b.jff')], 1);
    expect(readTabs(params(search)).map((t) => t.file)).toEqual(['a.jff', 'b.jff']);
    expect(readActiveIndex(params(search), 2)).toBe(1);
  });

  it('still opens a link made before tabs existed', () => {
    // Jeff has these bookmarked, and they are what every call site built until now.
    const legacy = 'kind=solutions&file=x.jff&type=FA&title=x.jff+-+Problem&name=x.jff';
    expect(readTabs(params(legacy))).toEqual([
      {
        kind: 'solutions',
        file: 'x.jff',
        type: 'FA',
        name: 'x.jff',
        title: 'x.jff - Problem',
        eps: undefined,
      },
    ]);
  });

  it('drops entries that are not tabs, since the URL is hand-editable', () => {
    const hostile = 'tabs=' + encodeURIComponent(JSON.stringify([
      { kind: 'submissions', file: '../../etc/passwd', type: 'FA', name: 'x', title: 'x' },
      { kind: 'secrets', file: 'a.jff', type: 'FA', name: 'x', title: 'x' },
      { kind: 'submissions', file: 'good.jff', type: 'FA', name: 'g', title: 'g' },
    ]));
    expect(readTabs(params(hostile)).map((t) => t.file)).toEqual(['good.jff']);
  });

  it('survives a truncated or nonsense list rather than throwing', () => {
    expect(readTabs(params('tabs=%7Bnot-json'))).toEqual([]);
  });

  it('clamps an out-of-range active index', () => {
    expect(readActiveIndex(params('active=99'), 2)).toBe(0);
    expect(readActiveIndex(params('active=-1'), 2)).toBe(0);
  });

  it('refuses duplicates, which would double the audit trail for one file', () => {
    const dupes = 'tabs=' + encodeURIComponent(JSON.stringify([tab('a.jff'), tab('a.jff')]));
    expect(readTabs(params(dupes))).toHaveLength(1);
  });
});

describe('adding and removing tabs', () => {
  it('selects the existing tab rather than opening a second copy', () => {
    const open = [tab('a.jff'), tab('b.jff')];
    expect(withTab(open, tab('a.jff'))).toEqual({ tabs: open, activeIndex: 0 });
  });

  it('appends and selects a new one', () => {
    const { tabs, activeIndex } = withTab([tab('a.jff')], tab('b.jff'));
    expect(tabs.map((t) => t.file)).toEqual(['a.jff', 'b.jff']);
    expect(activeIndex).toBe(1);
  });

  it('drops the oldest when full, rather than looking broken', () => {
    const full = Array.from({ length: MAX_VIEWER_TABS }, (_, i) => tab(`f${i}.jff`));
    const { tabs, activeIndex } = withTab(full, tab('new.jff'));
    expect(tabs).toHaveLength(MAX_VIEWER_TABS);
    expect(tabs[0]?.file).toBe('f1.jff');
    expect(tabs[activeIndex]?.file).toBe('new.jff');
  });

  it('selects a neighbour when the active tab is closed', () => {
    const open = [tab('a.jff'), tab('b.jff'), tab('c.jff')];
    expect(withoutTab(open, 1, 1).activeIndex).toBe(1);
    expect(withoutTab(open, 1, 1).tabs.map((t) => t.file)).toEqual(['a.jff', 'c.jff']);
  });

  it('keeps the same tab selected when an earlier one is closed', () => {
    // Closing tab 0 while looking at tab 2 must keep showing tab 2's machine, not slide the
    // selection onto a different student's work.
    const open = [tab('a.jff'), tab('b.jff'), tab('c.jff')];
    const after = withoutTab(open, 0, 2);
    expect(after.tabs[after.activeIndex]?.file).toBe('c.jff');
  });

  it('handles closing the last one', () => {
    expect(withoutTab([tab('a.jff')], 0, 0)).toEqual({ tabs: [], activeIndex: 0 });
  });
});
