'use client';

import { PulseLoader } from 'react-spinners';

/**
 * The loading animation, defined once.
 *
 * A page, a card and a table all wait in the same way, so there is one of these rather than one
 * per surface. It used to be otherwise: the data table pulsed in one colour while everything else
 * spun a grey ring, which read as two different products.
 *
 * The primary colour is set rather than inherited so the dots look the same wherever they are
 * drawn, including on a card whose text colour is muted. It is a decoration, hidden from screen
 * readers: the wrapper carries the live region and the words somebody actually hears.
 *
 * `size="sm"` is the same animation scaled to fit inside a control, which is why it is a size on
 * this component rather than a second spinner somewhere else. At around 21px wide it sits in an
 * input's adornment slot next to a password toggle without crowding it.
 */
export default function Spinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const compact = size === 'sm';

  return (
    <span aria-hidden="true" className="text-primary">
      <PulseLoader
        color="currentColor"
        size={compact ? 4 : 8}
        margin={compact ? 1.5 : 3}
        speedMultiplier={0.65}
      />
    </span>
  );
}
