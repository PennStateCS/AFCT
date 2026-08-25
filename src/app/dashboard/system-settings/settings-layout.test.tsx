/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SettingsSection, SettingsStatusLayout, SettingsStatusPanel } from './settings-layout';

describe('SettingsSection', () => {
  it('names its section from the heading, so the panel is a labelled region', () => {
    render(
      <SettingsSection title="Server Configuration" description="Where AFCT lives.">
        <p>fields</p>
      </SettingsSection>,
    );

    const section = screen.getByRole('region', { name: 'Server Configuration' });
    expect(section).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Server Configuration' })).toBeVisible();
    expect(screen.getByText('Where AFCT lives.')).toBeInTheDocument();
    expect(section).toContainElement(screen.getByText('fields'));
  });

  it('keeps the heading with its content when the panel is dropped', () => {
    render(
      <SettingsSection title="Current status" boxed={false}>
        <p>panel</p>
      </SettingsSection>,
    );

    expect(screen.getByRole('region', { name: 'Current status' })).toContainElement(
      screen.getByText('panel'),
    );
  });
});

describe('SettingsStatusLayout', () => {
  function renderLayout() {
    return render(
      <SettingsStatusLayout
        statusTitle="Current status"
        status={
          <SettingsStatusPanel>
            <p>Mail is on.</p>
          </SettingsStatusPanel>
        }
      >
        <SettingsSection title="Email configuration">
          <label htmlFor="host">Mail server</label>
          <input id="host" />
        </SettingsSection>
      </SettingsStatusLayout>,
    );
  }

  it('exposes the status as its own labelled complementary region', () => {
    renderLayout();

    const status = screen.getByRole('complementary', { name: 'Current status' });
    expect(status).toContainElement(screen.getByText('Mail is on.'));
    expect(screen.getByRole('heading', { level: 2, name: 'Current status' })).toBeVisible();
  });

  it('keeps the form outside the status region, with its controls intact', () => {
    renderLayout();

    const status = screen.getByRole('complementary', { name: 'Current status' });
    const field = screen.getByLabelText('Mail server');
    expect(status).not.toContainElement(field);
    expect(screen.getByRole('region', { name: 'Email configuration' })).toContainElement(field);
  });

  /*
   * The status is first in the DOM on purpose: stacked on a phone that is the order you
   * want, and on a wide screen the grid places it into column two. A refactor that moved
   * it after the form would silently flip what a screen reader and a phone hear first,
   * with nothing visible changing on the desktop layout that gets looked at.
   */
  it('puts the status before the form in reading order', () => {
    const { container } = renderLayout();

    const status = screen.getByRole('complementary', { name: 'Current status' });
    const form = screen.getByRole('region', { name: 'Email configuration' });

    expect(status.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('aside')).toBe(status);
  });
});
