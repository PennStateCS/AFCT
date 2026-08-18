/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LaunchNotice } from './LaunchNotice';

describe('LaunchNotice', () => {
  it('says nothing when the dashboard was reached normally', () => {
    const { container } = render(<LaunchNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it('ignores a reason it does not know, so a made-up link cannot post a message', () => {
    const { container } = render(
      <LaunchNotice notice="anything-at-all" courseTitle="Theory" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('explains an unpublished course and says it will appear here', () => {
    render(<LaunchNotice notice="not-published" courseTitle="Theory of Computation" />);

    expect(screen.getByRole('status')).toHaveTextContent(/Theory of Computation/);
    expect(screen.getByRole('status')).toHaveTextContent(/appear here/);
  });

  it('places an LMS course name as text, never as markup', () => {
    render(<LaunchNotice notice="not-linked" courseTitle="<img src=x onerror=alert(1)>" />);

    expect(screen.getByRole('status')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});
