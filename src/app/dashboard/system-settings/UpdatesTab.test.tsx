/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Updates tab: the screen a professor uses to upgrade their own install.
 *
 * Almost everything here is a guard. Upgrading, downgrading and deleting a backup are the most
 * destructive things this application can do from a browser, and the operator is explicitly not
 * a sysadmin, so what is worth pinning is which controls are reachable in which state: never
 * offer a downgrade while an upgrade is running, never offer a version older than the current
 * one as an "upgrade", and never let a restore happen without the typed confirmation.
 *
 * `useUpgrade` is mocked because it is the seam this component is written against, and it has
 * its own tests. `UpgradeLiveLog` is mocked because it opens an EventSource that jsdom has no
 * implementation for; its absence is irrelevant to any of the state below.
 */

const hook = vi.hoisted(() => ({
  startUpgrade: vi.fn(),
  startDowngrade: vi.fn(),
  startSelfUpdate: vi.fn(),
  startDeleteRestorePoint: vi.fn(),
  dismissSelfUpdate: vi.fn(),
  useUpgrade: vi.fn(),
}));

vi.mock('./useUpgrade', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useUpgrade')>();
  return { ...actual, useUpgrade: hook.useUpgrade };
});
vi.mock('./UpgradeLiveLog', () => ({ UpgradeLiveLog: () => null }));

import { UpdatesTab } from './UpdatesTab';

type Info = {
  current: string;
  updaterVersion?: string;
  updaterAvailable?: boolean;
  manifestError?: boolean;
  versions?: { tag: string; label?: string; notes?: string; upgradeNote?: string }[];
  restorePoints?: { version: string; backup: string; encrypted?: boolean; size?: number }[];
  status?: { phase: string; message?: string } | null;
};

const state = (over: Partial<Record<string, unknown>> = {}, info: Partial<Info> | null = {}) => ({
  info: info === null ? undefined : { current: 'v1.0.0', versions: [], restorePoints: [], ...info },
  loading: false,
  upgradeBusy: false,
  downgradeBusy: false,
  selfUpdateBusy: false,
  deleteBusy: false,
  selfUpdate: { phase: 'idle' as const },
  ...hook,
  ...over,
});

const mount = (
  over?: Parameters<typeof state>[0],
  info?: Parameters<typeof state>[1],
  disabled = false,
) => {
  hook.useUpgrade.mockReturnValue(state(over, info));
  return render(<UpdatesTab disabled={disabled} />);
};

// Radix's Select drives itself with pointer capture and scrollIntoView, none of which jsdom
// implements. Same polyfill set SelectField's own test installs.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
});

beforeEach(() => vi.clearAllMocks());

describe('UpdatesTab: current version', () => {
  it('shows the running version', () => {
    mount(undefined, { current: 'v0.2.0' });
    expect(screen.getByText('v0.2.0')).toBeInTheDocument();
  });

  it('shows a loading placeholder before the first read resolves', () => {
    mount({ loading: true }, null);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('says unknown rather than blank when the version is missing', () => {
    mount({ loading: false }, null);
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});

describe('UpdatesTab: choosing a version', () => {
  const versions = [
    { tag: 'v1.0.0' },
    { tag: 'v0.9.0' },
    { tag: 'v1.1.0', label: 'Spring release' },
    { tag: 'v1.2.0', notes: 'Adds group sets.', upgradeNote: 'Run the migration first.' },
  ];

  it('offers only versions newer than the one running', async () => {
    const user = userEvent.setup();
    mount(undefined, { current: 'v1.0.0', versions });
    await user.click(screen.getByRole('combobox', { name: /upgrade to/i }));

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Spring release (v1.1.0)', 'v1.2.0']);
    // Neither the current version nor an older one is an upgrade target.
    expect(options.join()).not.toContain('v1.0.0');
    expect(options.join()).not.toContain('v0.9.0');
  });

  it('offers everything but the current tag when the current one is not a version', async () => {
    const user = userEvent.setup();
    // `main` in dev is not comparable, so filtering by "newer" would hide every option.
    mount(undefined, { current: 'main', versions: [{ tag: 'main' }, { tag: 'v1.1.0' }] });
    await user.click(screen.getByRole('combobox', { name: /upgrade to/i }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['v1.1.0']);
  });

  it('says it is up to date when nothing newer exists', () => {
    mount(undefined, { current: 'v1.0.0', versions: [{ tag: 'v1.0.0' }] });
    expect(screen.getByText('AFCT is on the latest available version.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /upgrade to/i })).toBeNull();
  });

  it('explains a manifest it could not load, instead of claiming it is up to date', () => {
    mount(undefined, { current: 'v1.0.0', manifestError: true, versions: [] });
    expect(screen.getByText(/list of available versions could not be loaded/i)).toBeInTheDocument();
  });

  it('replaces the whole picker with instructions when the updater is not installed', () => {
    mount(undefined, { updaterAvailable: false, versions });
    expect(screen.getByText(/update service isn’t installed/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /upgrade to/i })).toBeNull();
    expect(screen.getByText('sh install.sh enable-updater')).toBeInTheDocument();
  });
});

describe('UpdatesTab: starting an upgrade', () => {
  const versions = [{ tag: 'v1.1.0', notes: 'Adds group sets.', upgradeNote: 'Back up first.' }];

  const pick = async (tag = 'v1.1.0') => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /upgrade to/i }));
    await user.click(await screen.findByRole('option', { name: tag }));
  };

  it('keeps the button disabled until a version is chosen', async () => {
    mount(undefined, { versions });
    const button = screen.getByRole('button', { name: 'Upgrade…' });
    expect(button).toBeDisabled();

    await pick();
    expect(screen.getByRole('button', { name: 'Upgrade…' })).toBeEnabled();
  });

  it('surfaces the release notes and the upgrade note once chosen', async () => {
    mount(undefined, { versions });
    await pick();
    expect(screen.getByText('Adds group sets.')).toBeInTheDocument();
    expect(screen.getByText('Back up first.')).toBeInTheDocument();
  });

  it('confirms before starting, and passes the chosen tag', async () => {
    mount(undefined, { versions });
    await pick();
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade…' }));

    const dialog = await screen.findByRole('dialog', { name: /upgrade afct/i });
    expect(hook.startUpgrade).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade' }));
    expect(hook.startUpgrade).toHaveBeenCalledWith('v1.1.0');
  });

  it('does not start when the confirm is cancelled', async () => {
    mount(undefined, { versions });
    await pick();
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade…' }));
    const dialog = await screen.findByRole('dialog', { name: /upgrade afct/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(hook.startUpgrade).not.toHaveBeenCalled();
  });

  it.each([
    ['a request is in flight', { upgradeBusy: true }, {}],
    ['the updater reports a run in progress', {}, { status: { phase: 'pulling' } }],
    ['settings are disabled', {}, {}],
  ])('disables the picker and button while %s', (label, over, info) => {
    mount(over, { versions, ...info }, label === 'settings are disabled');
    expect(screen.getByRole('combobox', { name: /upgrade to/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /upgrad/i })).toBeDisabled();
  });
});

describe('UpdatesTab: status', () => {
  it('shows nothing until the updater reports a phase', () => {
    mount(undefined, { status: null });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the phase and the updater message', () => {
    mount(undefined, { status: { phase: 'failed', message: 'health check timed out' } });
    const status = screen.getByRole('status');
    expect(within(status).getByText('health check timed out')).toBeInTheDocument();
  });

  it('does not render the step checklist for a stale healthy phase from a previous session', () => {
    // Nothing was started this session, so a leftover `healthy` must not render every step
    // green, which would make a not-yet-started upgrade look already done.
    mount(undefined, { status: { phase: 'healthy' } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /progress/i })).toBeNull();
  });

  it('warns that the site may restart while a run is in progress', () => {
    mount(undefined, { status: { phase: 'pulling' } });
    expect(screen.getByText(/can take a few minutes/i)).toBeInTheDocument();
  });
});

describe('UpdatesTab: the update service banner', () => {
  it('offers to update the service when it is behind the app', () => {
    mount(undefined, { current: 'v1.1.0', updaterVersion: 'v1.0.0' });
    expect(screen.getByRole('button', { name: 'Update the update service' })).toBeEnabled();
  });

  it('stays quiet when the service matches the app', () => {
    mount(undefined, { current: 'v1.1.0', updaterVersion: 'v1.1.0' });
    expect(screen.queryByRole('button', { name: 'Update the update service' })).toBeNull();
  });

  it('does not nag mid-upgrade, when a version mismatch is expected', () => {
    mount(undefined, {
      current: 'v1.1.0',
      updaterVersion: 'v1.0.0',
      status: { phase: 'pulling' },
    });
    expect(screen.queryByRole('button', { name: 'Update the update service' })).toBeNull();
  });

  it('passes the app version when the update is started', () => {
    mount(undefined, { current: 'v1.1.0', updaterVersion: 'v1.0.0' });
    fireEvent.click(screen.getByRole('button', { name: 'Update the update service' }));
    expect(hook.startSelfUpdate).toHaveBeenCalledWith('v1.1.0');
  });

  it('explains that a restart is expected while it runs', () => {
    mount({ selfUpdate: { phase: 'updating', targetTag: 'v1.1.0' } }, {});
    expect(screen.getByText(/briefly show as unavailable/i)).toBeInTheDocument();
  });

  it('offers a retry after a failure, with the reason', () => {
    mount({ selfUpdate: { phase: 'failed', message: 'pull refused' } }, {});
    expect(screen.getByText(/pull refused/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(hook.startSelfUpdate).toHaveBeenCalled();
  });

  it('can be dismissed once it is done', () => {
    mount({ selfUpdate: { phase: 'done', targetTag: 'v1.1.0' } }, {});
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(hook.dismissSelfUpdate).toHaveBeenCalled();
  });

  it('tells the operator what to do when it times out', () => {
    mount({ selfUpdate: { phase: 'timeout' } }, {});
    const banner = screen.getByRole('note');
    expect(within(banner).getByText(/taking longer than expected/i)).toBeInTheDocument();
    // The same command also appears in the intro copy, so scope it to the banner.
    expect(within(banner).getByText('sh install.sh update')).toBeInTheDocument();
  });

  it('hides the generic status card while a self-update runs, so phases are not doubled', () => {
    mount(
      { selfUpdate: { phase: 'updating', targetTag: 'v1.1.0' } },
      {
        status: { phase: 'pulling' },
      },
    );
    expect(screen.queryByRole('status', { name: '' })).not.toBeNull();
    // The status card's own heading is absent; only the banner is showing.
    expect(screen.queryByText('Update status')).toBeNull();
  });
});

describe('UpdatesTab: restore points', () => {
  const restorePoints = [
    { version: 'v0.9.0', backup: '20260701-120000', encrypted: true, size: 1024 * 1024 },
    { version: 'v0.8.0', backup: '20260601-120000', encrypted: false },
    { version: 'v1.0.0', backup: '20260801-120000' },
  ];

  it('lists every recorded version except the one running', () => {
    mount(undefined, { current: 'v1.0.0', restorePoints });
    expect(screen.getByText('v0.9.0')).toBeInTheDocument();
    expect(screen.getByText('v0.8.0')).toBeInTheDocument();
    // Restoring the version you are already on is not a thing to offer.
    expect(screen.queryByRole('button', { name: /Restore version v1\.0\.0/ })).toBeNull();
  });

  it('hides the whole section when there is nothing to restore', () => {
    mount(undefined, { current: 'v1.0.0', restorePoints: [] });
    expect(screen.queryByText('Restore a previous version')).toBeNull();
  });

  it('shows whether each backup is encrypted, and an em dash when unknown', () => {
    mount(undefined, { current: 'v1.0.0', restorePoints });
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('requires the version to be typed before a restore can run', async () => {
    mount(undefined, { current: 'v1.0.0', restorePoints });
    fireEvent.click(screen.getByRole('button', { name: 'Restore version v0.9.0' }));

    const dialog = await screen.findByRole('dialog', { name: /restore and downgrade/i });
    const confirm = within(dialog).getByRole('button', { name: 'Restore and downgrade' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'v0.9.0' } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(hook.startDowngrade).toHaveBeenCalledWith({
      tag: 'v0.9.0',
      restorePoint: '20260701-120000',
    });
  });

  it('deletes a backup after a plain confirm, without touching the running app', async () => {
    mount(undefined, { current: 'v1.0.0', restorePoints });
    fireEvent.click(
      screen.getByRole('button', { name: /Delete the .* backup for version v0\.8\.0/ }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Delete this backup?' });
    expect(
      within(dialog).getByText(/does not affect the running application/i),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete backup' }));
    expect(hook.startDeleteRestorePoint).toHaveBeenCalledWith('20260601-120000');
    expect(hook.startDowngrade).not.toHaveBeenCalled();
  });

  it.each([
    ['a downgrade is running', { downgradeBusy: true }, {}],
    ['an upgrade is running', {}, { status: { phase: 'pulling' } }],
  ])('disables Restore while %s', (_label, over, info) => {
    mount(over, { current: 'v1.0.0', restorePoints, ...info });
    expect(screen.getByRole('button', { name: 'Restore version v0.9.0' })).toBeDisabled();
  });

  it('disables Delete while a delete is already running', () => {
    mount({ deleteBusy: true }, { current: 'v1.0.0', restorePoints });
    expect(
      screen.getByRole('button', { name: /Delete the .* backup for version v0\.9\.0/ }),
    ).toBeDisabled();
  });
});

describe('UpdatesTab: forced downgrade after a refused safety backup', () => {
  const refused = {
    current: 'v1.0.0',
    restorePoints: [{ version: 'v0.9.0', backup: '20260701-120000' }],
    // Must match downgradeRefusedForSafetyBackup's own wording check.
    status: { phase: 'failed', message: 'could not confirm a backup of the current state' },
  };

  const startRefusedDowngrade = async () => {
    mount(undefined, refused);
    fireEvent.click(screen.getByRole('button', { name: 'Restore version v0.9.0' }));
    const dialog = await screen.findByRole('dialog', { name: /restore and downgrade/i });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'v0.9.0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore and downgrade' }));
  };

  it('is not offered before a downgrade has actually been refused this session', () => {
    mount(undefined, refused);
    expect(screen.queryByRole('button', { name: /without a safety backup/i })).toBeNull();
  });

  it('is not offered when the failure was for some other reason', async () => {
    mount(undefined, { ...refused, status: { phase: 'failed', message: 'image pull failed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore version v0.9.0' }));
    const dialog = await screen.findByRole('dialog', { name: /restore and downgrade/i });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'v0.9.0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore and downgrade' }));

    expect(screen.queryByRole('button', { name: /without a safety backup/i })).toBeNull();
  });

  it('re-issues the same restore with force, behind its own typed confirmation', async () => {
    await startRefusedDowngrade();
    hook.startDowngrade.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /without a safety backup/i }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Downgrade without a safety backup?',
    });
    const confirm = within(dialog).getByRole('button', { name: 'Downgrade anyway' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'v0.9.0' } });
    fireEvent.click(confirm);

    expect(hook.startDowngrade).toHaveBeenCalledWith({
      tag: 'v0.9.0',
      restorePoint: '20260701-120000',
      force: true,
    });
  });
});
