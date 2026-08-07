'use client';

import * as React from 'react';

import { isMathRendererReady, loadMathRenderer, renderDescriptionMath } from './render-math';

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
 * loading it on demand is a change to two files rather than to the document walker.
 *
 * The only client component in the read path, and only because of that on-demand load. KaTeX is
 * ~700 KB, most descriptions have no equations, and a static import put it on every route that
 * renders a description. So the first equation to reach the screen asks for the renderer, and
 * until it arrives the LaTeX source stands in for it. Server-side that stand-in is what gets
 * rendered, unless the caller awaited `loadMathRenderer()` first: see RichDescription.server.test.
 *
 * The source is also the failure fallback, so an equation that can never render and one that has
 * not rendered YET look the same. That is deliberate: both say "here is the equation, unrendered"
 * rather than showing a spinner or a gap where the maths should be.
 */
export function DescriptionMath({ latex, displayMode }: DescriptionMathProps) {
  // Seeded from the module, not from `false`: once the renderer is loaded, every later equation on
  // the page renders on its first pass with no placeholder at all.
  const [ready, setReady] = React.useState(isMathRendererReady);

  React.useEffect(() => {
    if (ready) return;
    let active = true;
    void loadMathRenderer().then(() => {
      // A failed load leaves the renderer unavailable; re-rendering into the same fallback would
      // just be churn, so only wake up when there is something new to draw.
      if (active && isMathRendererReady()) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [ready]);

  const html = ready ? renderDescriptionMath(latex, displayMode) : null;

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
