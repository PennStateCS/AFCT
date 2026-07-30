'use client';

import * as React from 'react';

type Props = {
  children: React.ReactNode;
  /** Shown instead of the rich content when rendering throws. Normally the plain description. */
  fallback: React.ReactNode;
};

type State = { failed: boolean };

/**
 * Last line of defence around a rendered description.
 *
 * `RichDescription` validates before it walks, and `validateRichDescription` is total, so this
 * should never trigger. It exists because of what is on the other side of the boundary: these
 * surfaces show assignment prompts and problem statements, and a thrown render takes out the
 * whole client tree, not just the description. Losing one description's formatting is a much
 * better failure than a student seeing a blank assignment page near a deadline.
 *
 * The fallback is supplied by the caller rather than invented here, so the words still reach the
 * reader through the plain-text column.
 *
 * A class component because React has no hook equivalent: `getDerivedStateFromError` and
 * `componentDidCatch` are only available this way. This is the one place in the feature that
 * needs one.
 */
export class RichDescriptionBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Never silent: a throw here means the validator let something through, which is a real
    // defect worth seeing. Console only, matching the rest of the feature; the project has no
    // structured client logger, and this is not an operational event to page anyone about.
    if (process.env.NODE_ENV !== 'production') {
      console.error('[rich-description] rendering threw; showing plain text instead', error);
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default RichDescriptionBoundary;
