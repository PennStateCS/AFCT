import * as React from 'react';

import { renderDescriptionMath } from './render-math';

export type DescriptionMathProps = {
  /** Already checked against the shared latex policy by the caller. */
  latex: string;
  displayMode: boolean;
};

/**
 * One rendered equation.
 *
 * Split out of the walker so KaTeX has a single import site in the read path. That is what makes
 * the bundle question tractable: everything KaTeX-shaped lives behind this module boundary, so
 * moving it server-side or behind a lazy import is a change to one file rather than to the
 * document walker.
 *
 * Deliberately synchronous and free of browser APIs, so a description containing maths still
 * renders on the server (see RichDescription.server.test.tsx).
 */
export function DescriptionMath({ latex, displayMode }: DescriptionMathProps) {
  const html = renderDescriptionMath(latex, displayMode);

  // Even the error path failed. Showing the source beats showing nothing.
  if (html === null) return <code>{latex}</code>;

  const Tag = displayMode ? 'div' : 'span';
  return (
    <Tag
      data-type={displayMode ? 'block-math' : 'inline-math'}
      // The one dangerouslySetInnerHTML in this feature, and it is narrow: the input is a
      // policy-checked latex string bounded to MAX_LATEX_LENGTH, and KaTeX renders it with
      // trust: false, which refuses the commands that can emit markup or fetch resources
      // (\href, \url, \includegraphics, \html*). Nothing user-supplied reaches the DOM as HTML;
      // only KaTeX's own output does.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default DescriptionMath;
