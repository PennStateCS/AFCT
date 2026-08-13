'use client';

import { PulseLoader } from 'react-spinners';

/**
 * The loading animation, defined once.
 *
 * A page, a card and a table all wait in the same way, so there is one of these rather than one
 * per surface. It used to be otherwise: the data table pulsed in brand teal while everything else
 * spun a grey ring, which read as two different products.
 *
 * Brand teal is pinned rather than inherited so the dots look the same wherever they are drawn,
 * including on a card whose text colour is muted. It is a decoration, hidden from screen readers:
 * the wrapper carries the live region and the words somebody actually hears.
 */
export default function Spinner() {
  return (
    <span aria-hidden="true" className="text-brand-teal">
      <PulseLoader color="currentColor" size={8} margin={3} speedMultiplier={0.65} />
    </span>
  );
}
