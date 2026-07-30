import { describe, it, expect } from 'vitest';
import {
  projectDescription,
  projectPlainDescriptionOnly,
  assignmentDescriptionSelect,
  problemDescriptionSelect,
  type DescriptionProjection,
} from './projection';

const RICH = {
  version: 1,
  document: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
};

const row = {
  description: 'Build an RE.',
  descriptionFormat: 'TIPTAP_JSON' as const,
  descriptionJson: RICH,
};

/**
 * The bug this file exists to prevent: a serializer that returns `description` and forgets
 * `descriptionJson`, so a read surface silently renders plain text forever. It shipped twice.
 * These assert the contract structurally rather than by matching source text.
 */
describe('projectDescription', () => {
  const KEYS = ['description', 'descriptionFormat', 'descriptionJson'] as const;

  it('always returns all three fields, unlocked', () => {
    expect(Object.keys(projectDescription(row)).sort()).toEqual([...KEYS].sort());
  });

  it('always returns all three fields, locked', () => {
    expect(Object.keys(projectDescription(row, { locked: true })).sort()).toEqual([...KEYS].sort());
  });

  it('passes every field through when unlocked', () => {
    expect(projectDescription(row)).toEqual({
      description: 'Build an RE.',
      descriptionFormat: 'TIPTAP_JSON',
      descriptionJson: RICH,
    });
  });

  it('masks the rich copy whenever it masks the plain copy', () => {
    const locked = projectDescription(row, { locked: true });
    expect(locked.description).toBeNull();
    expect(locked.descriptionJson).toBeNull();
    // The format must not advertise that a rich document exists behind the lock.
    expect(locked.descriptionFormat).toBe('PLAIN_TEXT');
    expect(JSON.stringify(locked)).not.toContain('Build an RE.');
  });

  it('never leaks the locked document through any field', () => {
    const secret = 'SECRET-PROMPT-TEXT';
    const locked = projectDescription(
      {
        description: secret,
        descriptionFormat: 'TIPTAP_JSON',
        descriptionJson: {
          version: 1,
          document: { type: 'doc', content: [{ type: 'text', text: secret }] },
        },
      },
      { locked: true },
    );
    expect(JSON.stringify(locked)).not.toContain(secret);
  });

  it('defaults a record with no rich document to plain text', () => {
    const out = projectDescription({ description: 'just text' });
    expect(out).toEqual({
      description: 'just text',
      descriptionFormat: 'PLAIN_TEXT',
      descriptionJson: null,
    });
  });

  it('normalizes missing fields to null rather than undefined', () => {
    const out = projectDescription({});
    expect(out.description).toBeNull();
    expect(out.descriptionJson).toBeNull();
  });
});

describe('projectPlainDescriptionOnly', () => {
  it('returns only the plain text, for the Java client paths', () => {
    const out = projectPlainDescriptionOnly(row);
    expect(Object.keys(out)).toEqual(['description']);
    // The rich document must not reach a client that cannot render it and has not agreed to it.
    expect(JSON.stringify(out)).not.toContain('version');
  });

  it('honours the lock too', () => {
    expect(projectPlainDescriptionOnly(row, { locked: true }).description).toBeNull();
  });
});

describe('prisma selections', () => {
  // If a column is ever added or renamed, these fail here rather than in a route nobody reruns.
  it('select the same three columns for both models', () => {
    expect(assignmentDescriptionSelect).toEqual({
      description: true,
      descriptionFormat: true,
      descriptionJson: true,
    });
    expect(problemDescriptionSelect).toEqual(assignmentDescriptionSelect);
  });

  it('name exactly the fields the projection returns', () => {
    const projected = Object.keys(projectDescription(row)).sort();
    expect(Object.keys(assignmentDescriptionSelect).sort()).toEqual(projected);
  });
});

describe('type contract', () => {
  it('is assignable to the declared projection type', () => {
    // Compile-time guard: a field dropped from the return value fails typecheck here.
    const out: DescriptionProjection = projectDescription(row);
    expect(out).toBeTruthy();
  });
});
