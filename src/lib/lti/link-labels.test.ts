import { describe, it, expect } from 'vitest';
import { platformLabel, lmsBadgeLabel, lmsLinkDescription } from '@/lib/lti/link-labels';

describe('platformLabel', () => {
  it('uses the registration name when it has one', () => {
    expect(platformLabel({ name: 'Canvas (test)', issuer: 'https://canvas.instructure.com' })).toBe(
      'Canvas (test)',
    );
  });

  it('falls back to the host, because a blank badge helps nobody', () => {
    expect(platformLabel({ name: null, issuer: 'https://moodle.demovm.dev' })).toBe(
      'moodle.demovm.dev',
    );
    expect(platformLabel({ name: '   ', issuer: 'https://moodle.demovm.dev' })).toBe(
      'moodle.demovm.dev',
    );
  });

  it('shows an unparseable issuer rather than throwing', () => {
    expect(platformLabel({ name: null, issuer: 'not-a-url' })).toBe('not-a-url');
  });
});

describe('lmsBadgeLabel', () => {
  it('says nothing when nothing is linked', () => {
    expect(lmsBadgeLabel([])).toBeNull();
  });

  it('names the LMS when there is one link', () => {
    expect(lmsBadgeLabel([{ platform: 'Canvas' }])).toBe('In Canvas');
  });

  it('counts rather than repeating the same name', () => {
    expect(lmsBadgeLabel([{ platform: 'Canvas' }, { platform: 'Canvas' }])).toBe(
      'In 2 Canvas courses',
    );
  });

  it('stays generic when the platforms differ', () => {
    expect(lmsBadgeLabel([{ platform: 'Canvas' }, { platform: 'Moodle' }])).toBe(
      'In 2 LMS courses',
    );
  });
});

describe('lmsLinkDescription', () => {
  it('names the LMS course when the launch told us', () => {
    expect(
      lmsLinkDescription([
        { platform: 'Canvas', context: 'CMPSC 464 Fall 2026' },
        { platform: 'Moodle', context: null },
      ]),
    ).toEqual(['CMPSC 464 Fall 2026 in Canvas', 'Moodle']);
  });
});
