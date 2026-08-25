/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Badge } from '@/components/ui/badge';

import {
  SETTINGS_ASIDE_GRID,
  SettingsFormLayout,
  SettingsSection,
  SettingsStatusCard,
  SettingsAsideLayout,
  SettingsStatusNextStep,
  SettingsStatusText,
} from './settings-layout';

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

/*
 * A tab without a rail still has to line up with the tabs that have one.
 *
 * The form column is `workspace - rail - gap`, which is 840px below 2xl and 808px above it,
 * so no fixed max-w-* tracks it. Sharing the grid template is what makes them equal; a
 * refactor back to a max-width would look right at one viewport and drift at the other.
 */
describe('SettingsFormLayout', () => {
  it('uses the same grid template as the aside layout', () => {
    const { container: form } = render(
      <SettingsFormLayout>
        <SettingsSection title="Evaluation limits">
          <p>fields</p>
        </SettingsSection>
      </SettingsFormLayout>,
    );
    const { container: aside } = render(
      <SettingsAsideLayout aside={<p>rail</p>}>
        <SettingsSection title="Email configuration">
          <p>fields</p>
        </SettingsSection>
      </SettingsAsideLayout>,
    );

    for (const root of [form.firstElementChild, aside.firstElementChild]) {
      expect(root?.className).toContain(SETTINGS_ASIDE_GRID);
    }
  });

  it('puts its content in the first column, leaving the rail column empty', () => {
    const { container } = render(
      <SettingsFormLayout>
        <SettingsSection title="Evaluation limits">
          <p>fields</p>
        </SettingsSection>
      </SettingsFormLayout>,
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild?.className).toContain('col-start-1');
    expect(screen.getByRole('region', { name: 'Evaluation limits' })).toBeInTheDocument();
  });
});

describe('SettingsStatusCard', () => {
  function renderCard(tone: 'ok' | 'off' | 'warn' | 'bad' = 'off') {
    return render(
      <SettingsStatusCard
        title="Current status"
        tone={tone}
        badge={<Badge variant="neutral">Disabled</Badge>}
        headline="Bot protection is off"
      >
        <SettingsStatusText>hCaptcha challenges are not shown.</SettingsStatusText>
        <SettingsStatusNextStep>Add both keys to turn protection on.</SettingsStatusNextStep>
      </SettingsStatusCard>,
    );
  }

  it('names itself with a real h2, inside the card', () => {
    renderCard();

    const card = screen.getByRole('complementary', { name: 'Current status' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Current status' });
    // The title has to be IN the card, not floating above it: that is the whole point of
    // this pass, and a heading rendered as a sibling would still pass a name check.
    expect(card).toContainElement(heading);
  });

  it('states the status in words, not only in an icon', () => {
    renderCard();

    expect(screen.getByText('Disabled')).toBeVisible();
    expect(screen.getByText('Bot protection is off')).toBeVisible();
    expect(screen.getByText('hCaptcha challenges are not shown.')).toBeVisible();
    expect(screen.getByText('Add both keys to turn protection on.')).toBeVisible();
  });

  /*
   * The icon repeats what the badge beside it already says, so it must not reach the
   * accessibility tree: otherwise every state is announced twice, once as a shape.
   */
  it('hides the tone icon from assistive tech', () => {
    const { container } = renderCard('bad');

    const svgs = Array.from(container.querySelectorAll('svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  /*
   * The surface stays neutral in every state. A green or red panel would make a standing
   * configuration summary read as a transient alert, and it is the badge and the glyph that
   * are supposed to carry the meaning. Asserted as "no status token on the card", not as a
   * class-string match, so the check survives a change of neutral surface.
   */
  it('never tints the card itself with a status colour', () => {
    for (const tone of ['ok', 'off', 'warn', 'bad'] as const) {
      const { unmount } = renderCard(tone);
      const card = screen.getByRole('complementary', { name: 'Current status' });
      expect(card.className).not.toMatch(/status-|destructive/);
      unmount();
    }
  });

  it('draws a different tone glyph for a healthy state than a failed one', () => {
    const { container: off } = renderCard('off');
    const offIcon = off.querySelector('svg')?.getAttribute('class') ?? '';
    const { container: bad } = renderCard('bad');
    const badIcon = bad.querySelector('svg')?.getAttribute('class') ?? '';

    expect(offIcon).toContain('text-muted-foreground');
    expect(badIcon).toContain('text-destructive');
  });
});

describe('SettingsAsideLayout', () => {
  function renderLayout() {
    return render(
      <SettingsAsideLayout
        aside={
          <SettingsStatusCard
            title="Current status"
            tone="ok"
            badge={<Badge variant="success">Enabled</Badge>}
            headline="Email delivery is configured"
          >
            <SettingsStatusText>Mail is on.</SettingsStatusText>
          </SettingsStatusCard>
        }
      >
        <SettingsSection title="Email configuration">
          <label htmlFor="host">Mail server</label>
          <input id="host" />
        </SettingsSection>
      </SettingsAsideLayout>,
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
    renderLayout();

    const status = screen.getByRole('complementary', { name: 'Current status' });
    const form = screen.getByRole('region', { name: 'Email configuration' });

    expect(status.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
