import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Set one {@link DateTimeField} from a test.
 *
 * The field is two native inputs, not one `datetime-local` (see the component for why), so
 * a test that used to fire a single change now has two to make. This keeps that detail in
 * one place: pass the field's visible label and the `YYYY-MM-DDTHH:mm` value it used to
 * set, and both halves are filled in the order a person would.
 */
export function setDateTimeField(label: string, value: string, container?: HTMLElement) {
  const scope = container ? within(container) : screen;
  const [date, time] = value.split('T');
  fireEvent.change(scope.getByLabelText(`${label}, date`), { target: { value: date } });
  if (time) {
    fireEvent.change(scope.getByLabelText(`${label}, time`), { target: { value: time } });
  }
}

/**
 * The same, for a label that appears more than once on the page (an override row beside the
 * assignment's own dates, say). `index` counts fields, not inputs.
 */
export function setNthDateTimeField(label: string, index: number, value: string) {
  const [date, time] = value.split('T');
  const nth = (suffix: string) => {
    const el = screen.getAllByLabelText(`${label}, ${suffix}`)[index];
    if (!el) throw new Error(`No ${suffix} input at index ${index} for "${label}"`);
    return el;
  };
  fireEvent.change(nth('date'), { target: { value: date } });
  if (time) fireEvent.change(nth('time'), { target: { value: time } });
}
