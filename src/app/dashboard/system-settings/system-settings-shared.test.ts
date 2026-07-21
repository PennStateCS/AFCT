import { describe, it, expect } from 'vitest';
import { deriveUpgradeSteps, deriveAcmeSteps, upgradePhaseLabel } from './system-settings-shared';

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
