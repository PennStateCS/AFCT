/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RoleBadge } from './RoleBadge';
import { ROLE_BADGE } from '@/lib/badge-presets';

/**
 * What matters here is the mapping, not the class string.
 *
 * Roles used to be solid red, blue, slate and green, which put a roster's identities into the
 * same colour language as success and failure. They are categorical hues now, and no role may
 * take a semantic variant again.
 */
const variantOf = (container: HTMLElement) => container.firstElementChild?.className ?? '';

describe('RoleBadge', () => {
  it('gives each role its own categorical hue', () => {
    for (const [role, expected] of Object.entries(ROLE_BADGE)) {
      const { container, unmount } = render(<RoleBadge userRole={role} />);
      expect(variantOf(container)).toContain(`badge-${expected.replace('category-', 'category-')}`);
      unmount();
    }
  });

  it('never uses a semantic status colour for an identity', () => {
    for (const role of Object.keys(ROLE_BADGE)) {
      const { container, unmount } = render(<RoleBadge userRole={role} />);
      const cls = variantOf(container);
      for (const semantic of ['badge-success', 'badge-warning', 'badge-danger', 'badge-info']) {
        expect(cls).not.toContain(semantic);
      }
      unmount();
    }
  });

  it('writes the role out, keeping TA an initialism', () => {
    render(<RoleBadge userRole="ADMIN" />);
    render(<RoleBadge userRole="TA" />);
    render(<RoleBadge userRole="STUDENT" />);

    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('TA')).toBeInTheDocument();
    expect(screen.getByText('Student')).toBeInTheDocument();
  });

  it('accepts whatever casing the caller has to hand', () => {
    const { container } = render(<RoleBadge userRole="faculty" />);

    expect(screen.getByText('Faculty')).toBeInTheDocument();
    expect(variantOf(container)).toContain('badge-category-blue');
  });

  it('falls back to the plain treatment for a role it does not know', () => {
    const { container } = render(<RoleBadge userRole="OBSERVER" />);

    // Still renders the label rather than vanishing, and takes no categorical hue.
    expect(screen.getByText('OBSERVER')).toBeInTheDocument();
    expect(variantOf(container)).not.toContain('badge-category');
  });

  it('lets a caller override the label', () => {
    render(<RoleBadge userRole="STUDENT">Auditing</RoleBadge>);

    expect(screen.getByText('Auditing')).toBeInTheDocument();
  });

  it('takes the shared badge geometry rather than its own pill', () => {
    const { container } = render(<RoleBadge userRole="ADMIN" />);
    const cls = variantOf(container);

    expect(container.firstElementChild).toHaveAttribute('data-slot', 'badge');
    expect(cls).toContain('rounded-md');
    expect(cls).not.toContain('rounded-full');
  });
});
