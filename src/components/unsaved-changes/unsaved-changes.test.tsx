/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const pushMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

import {
  UnsavedChangesProvider,
  useUnsavedChangesGuard,
  useConfirmIfDirty,
} from './UnsavedChangesProvider';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * A stand-in form: a text field whose dirtiness is "not empty", the way a real form's dirtiness
 * is "differs from stored". Cheap enough that these tests need no editor.
 */
function TestForm() {
  const [text, setText] = React.useState('');
  useUnsavedChangesGuard(text.length > 0);
  return (
    <input aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />
  );
}

function Probe({ onResult }: { onResult: (proceed: boolean) => void }) {
  const confirmIfDirty = useConfirmIfDirty();
  return (
    <button type="button" onClick={() => void confirmIfDirty().then(onResult)}>
      Probe navigation
    </button>
  );
}

function mount(children?: React.ReactNode) {
  return render(
    <UnsavedChangesProvider>
      <TestForm />
      <a href="/dashboard/elsewhere">Elsewhere</a>
      <a href="https://example.com/away">External</a>
      {children}
    </UnsavedChangesProvider>,
  );
}

const makeDirty = () =>
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'pending edit' } });
const makePristine = () =>
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: '' } });
const dialog = () => screen.queryByRole('dialog', { name: 'Discard unsaved changes?' });

beforeEach(() => vi.clearAllMocks());

describe('while pristine', () => {
  it('lets link clicks through untouched', () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));

    expect(dialog()).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('resolves programmatic guards immediately', async () => {
    const onResult = vi.fn();
    mount(<Probe onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Probe navigation' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(dialog()).toBeNull();
  });

  it('registers no beforeunload listener', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    mount();

    expect(spy.mock.calls.map(([type]) => type)).not.toContain('beforeunload');
  });
});

describe('while dirty', () => {
  it('intercepts an internal link and asks', async () => {
    mount();
    makeDirty();
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));

    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('Stay on page keeps the edits and does not navigate', async () => {
    mount();
    makeDirty();
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    await waitFor(() => expect(dialog()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Stay on page' }));

    await waitFor(() => expect(dialog()).toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Draft')).toHaveValue('pending edit');
  });

  it('Discard changes completes the navigation exactly once', async () => {
    mount();
    makeDirty();
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    await waitFor(() => expect(dialog()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith('/dashboard/elsewhere');
  });

  it('treats Escape as Stay, never as discard', async () => {
    mount();
    makeDirty();
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    const open = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });

    fireEvent.keyDown(open, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(dialog()).toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Draft')).toHaveValue('pending edit');
  });

  it('puts initial focus on Stay on page', async () => {
    mount();
    makeDirty();
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stay on page' })),
    );
  });

  it('opens one dialog for concurrent askers and gives both the same answer', async () => {
    const first = vi.fn();
    const second = vi.fn();
    mount(
      <>
        <Probe onResult={first} />
        <Probe onResult={second} />
      </>,
    );
    makeDirty();
    const probes = screen.getAllByRole('button', { name: 'Probe navigation' });
    fireEvent.click(probes[0]);
    fireEvent.click(probes[1]);

    expect(screen.getAllByRole('dialog', { name: 'Discard unsaved changes?' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    await waitFor(() => expect(first).toHaveBeenCalledWith(true));
    expect(second).toHaveBeenCalledWith(true);
  });

  it('ignores external links, which beforeunload owns', async () => {
    mount();
    makeDirty();
    // jsdom throws "not implemented: navigation" if the click actually navigates; preventing
    // that is the browser's job here, so just assert the guard did not claim it.
    const external = screen.getByRole('link', { name: 'External' });
    external.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(external);

    expect(dialog()).toBeNull();
  });

  it('registers beforeunload while dirty and removes it when pristine again', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    mount();
    makeDirty();
    expect(added.mock.calls.map(([type]) => type)).toContain('beforeunload');

    makePristine();
    expect(removed.mock.calls.map(([type]) => type)).toContain('beforeunload');
  });
});

describe('lifecycle', () => {
  it('releases the guard when the dirty form unmounts', async () => {
    const view = render(
      <UnsavedChangesProvider>
        <TestForm />
        <a href="/dashboard/elsewhere">Elsewhere</a>
      </UnsavedChangesProvider>,
    );
    makeDirty();

    view.rerender(
      <UnsavedChangesProvider>
        <a href="/dashboard/elsewhere">Elsewhere</a>
      </UnsavedChangesProvider>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));

    expect(dialog()).toBeNull();
  });

  it('works unguarded outside the provider rather than crashing', async () => {
    const onResult = vi.fn();
    render(<Probe onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Probe navigation' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });
});
