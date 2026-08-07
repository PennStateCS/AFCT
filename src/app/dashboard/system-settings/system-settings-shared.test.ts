import { describe, it, expect } from 'vitest';
import {
  deriveUpgradeSteps,
  deriveAcmeSteps,
  upgradePhaseLabel,
  parseVersionTag,
  isNewerThan,
  parseBackupTs,
  formatBackupTsLocal,
  downgradeRefusedForSafetyBackup,
} from './system-settings-shared';

describe('parseBackupTs', () => {
  it('parses a backup timestamp as UTC', () => {
    expect(parseBackupTs('20260115-030201')?.toISOString()).toBe('2026-01-15T03:02:01.000Z');
  });
  it('returns null for a string that is not a timestamp', () => {
    expect(parseBackupTs('nope')).toBeNull();
    expect(parseBackupTs('2026-01-15')).toBeNull();
  });
});

describe('downgradeRefusedForSafetyBackup', () => {
  it('matches the updater refusal message', () => {
    expect(
      downgradeRefusedForSafetyBackup(
        'Could not confirm a backup of the current state before downgrading, so the downgrade was refused to avoid unrecoverable data loss. Try again, or force it if you accept discarding the current state.',
      ),
    ).toBe(true);
  });
  it('does not match other failures or empty messages', () => {
    expect(downgradeRefusedForSafetyBackup('the database restore did not complete')).toBe(false);
    expect(downgradeRefusedForSafetyBackup(undefined)).toBe(false);
    expect(downgradeRefusedForSafetyBackup('')).toBe(false);
  });
});

describe('formatBackupTsLocal', () => {
  it('renders a parseable timestamp with date and time', () => {
    const out = formatBackupTsLocal('20260115-030201');
    expect(out).toContain('2026');
    // Minutes/seconds are fixed regardless of the runner's timezone.
    expect(out).toMatch(/\d{1,2}:02:01/);
  });
  it('falls back to the raw server string when it cannot be parsed', () => {
    expect(formatBackupTsLocal('nope')).toBe('nope');
  });
});

describe('parseVersionTag', () => {
  it('parses tags with and without a v prefix', () => {
    expect(parseVersionTag('v0.1.19')).toEqual([0, 1, 19]);
    expect(parseVersionTag('1.2.3')).toEqual([1, 2, 3]);
  });
  it('returns null for non-version tags', () => {
    expect(parseVersionTag('main')).toBeNull();
    expect(parseVersionTag('v1.2')).toBeNull();
    expect(parseVersionTag('sha-abc123')).toBeNull();
  });
});

describe('isNewerThan', () => {
  it('compares each part of the version', () => {
    expect(isNewerThan('v0.1.20', 'v0.1.19')).toBe(true);
    expect(isNewerThan('v0.2.0', 'v0.1.99')).toBe(true);
    expect(isNewerThan('v1.0.0', 'v0.9.9')).toBe(true);
    expect(isNewerThan('v0.1.19', 'v0.1.20')).toBe(false);
    expect(isNewerThan('v0.1.19', 'v0.1.19')).toBe(false);
  });
  it('returns null when either side is not comparable', () => {
    expect(isNewerThan('v0.1.19', 'main')).toBeNull();
    expect(isNewerThan('latest', 'v0.1.19')).toBeNull();
  });
});

describe('deriveUpgradeSteps', () => {
  it('returns null for phases without a step list', () => {
    expect(deriveUpgradeSteps(null)).toBeNull();
    expect(deriveUpgradeSteps(undefined)).toBeNull();
    expect(deriveUpgradeSteps('failed')).toBeNull();
    expect(deriveUpgradeSteps('rolled_back')).toBeNull();
    expect(deriveUpgradeSteps('nonsense')).toBeNull();
  });

  it('marks earlier steps done, the current phase current, and later steps pending (upgrade)', () => {
    const steps = deriveUpgradeSteps('pulling', 'upgrade')!;
    expect(steps.map((s) => s.state)).toEqual(['done', 'current', 'pending', 'pending']);
    expect(steps[1].label).toBe('Download the new version');
  });

  it('marks every step done when healthy', () => {
    const steps = deriveUpgradeSteps('healthy', 'upgrade')!;
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('uses the downgrade flow for downgrade-only phases even without an action hint', () => {
    const steps = deriveUpgradeSteps('restoring')!;
    expect(steps.map((s) => s.label)).toContain('Restore the database');
    const restoring = steps.find((s) => s.label === 'Restore the database')!;
    expect(restoring.state).toBe('current');
  });

  it('routes to the downgrade flow when the action says so', () => {
    const steps = deriveUpgradeSteps('backing_up', 'downgrade')!;
    expect(steps[0].label).toBe('Back up current state');
    expect(steps[0].state).toBe('current');
  });
});

describe('deriveAcmeSteps', () => {
  it('returns null for error / idle / unknown phases', () => {
    expect(deriveAcmeSteps(null)).toBeNull();
    expect(deriveAcmeSteps('error')).toBeNull();
    expect(deriveAcmeSteps('idle')).toBeNull();
  });

  it('collapses "starting" into the first (current) step', () => {
    const steps = deriveAcmeSteps('starting')!;
    expect(steps[0].state).toBe('current');
    expect(steps.slice(1).every((s) => s.state === 'pending')).toBe(true);
  });

  it('marks earlier steps done and the current phase current', () => {
    const steps = deriveAcmeSteps('validating')!;
    expect(steps.map((s) => s.state)).toEqual(['done', 'current', 'pending']);
  });

  it('marks all steps done when the cert is installed', () => {
    const steps = deriveAcmeSteps('done')!;
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });
});

describe('upgradePhaseLabel', () => {
  it('maps known phases and humanizes unknown ones', () => {
    expect(upgradePhaseLabel('rolled_back')).toBe('Rolled back');
    expect(upgradePhaseLabel('some_new_phase')).toBe('some new phase');
  });
});
