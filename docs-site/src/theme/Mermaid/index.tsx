import React from 'react';
import Mermaid from '@theme-original/Mermaid';
import type MermaidType from '@theme/Mermaid';
import type { WrapperProps } from '@docusaurus/types';

type Props = WrapperProps<typeof MermaidType>;

/**
 * Wraps every Mermaid diagram in a scrollable region, so a big one stays readable.
 *
 * The theme renders a diagram with `max-width: 100%` on its SVG, which sounds harmless and is
 * the reason the database schema diagrams could not be read: an entity-relationship diagram
 * with a dozen tables is naturally a few thousand pixels wide, and squeezing that into a prose
 * column shrinks the type along with it until nothing on it can be made out. Nothing is
 * clipped; it is simply too small.
 *
 * So the diagram is allowed its natural size (see `custom.css`) and this supplies the box to
 * scroll it in. A wrapper rather than a full swizzle: the theme's own component is untouched,
 * which is what keeps this working across Docusaurus upgrades.
 *
 * `tabIndex` and the label are not decoration. A scrollable region that can only be reached
 * with a mouse fails WCAG 2.1 SC 2.1.1, and browsers only recently began making scroll
 * containers focusable on their own, inconsistently. Giving it a role and a name means a
 * keyboard or screen-reader user is told there is a diagram here and can scroll it.
 */
export default function MermaidWrapper(props: Props): React.ReactElement {
  return (
    <div className="diagramScroll" role="region" aria-label="Diagram, scrollable" tabIndex={0}>
      <Mermaid {...props} />
    </div>
  );
}
