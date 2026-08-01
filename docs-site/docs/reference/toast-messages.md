# Toast messages

Toasts are the short confirmations and failures that appear in the corner of the screen
after an action. Every one of them goes through one module, `showToast` in
`src/lib/toast.ts`, which owns both the wording and the accessibility behaviour. This page
covers when to show a toast, who shows it, and how to word it.

## Never import sonner directly

`sonner` is the underlying library, but it is off limits outside `src/lib/toast.ts` and the
`<Toaster>` mount, and a lint rule enforces that.

The wrapper is what puts `role="alert"` and `aria-live="assertive"` on error toasts and
`role="status"` with `aria-live="polite"` on everything else. Importing sonner directly gets
sonner's defaults instead, which means a failed save is announced politely and can sit
behind whatever a screen reader is already reading. Errors have to interrupt; routine
successes must not.

```tsx
import { showToast } from '@/lib/toast';
```

## Who shows the toast

**The component that performs the write shows the toast.** If a dialog does the POST, the
dialog reports the result; its `onCreated` / `onSaved` callback updates the parent's state,
invalidates queries, and navigates, but does not toast.

This rule exists because the alternative produced real bugs. When both a dialog and its
caller toasted, creating one assignment showed two messages. When neither did (the same
dialog opened from a second page whose callback did not toast), creating a problem showed
none at all. The component doing the work is also the only one that knows whether _all_ of
the work succeeded, which is what makes a partial-success message possible:

```tsx
if (linked) {
  showToast.created('Problem', { name: created?.title });
} else {
  showToast.warning('Problem created, but it was not added to this assignment', {
    description: 'Add it from the assignment’s Problems tab.',
  });
}
```

## When to show one

Show a toast when the result of an action would otherwise be invisible:

- A write succeeded but the screen barely changes.
- A write failed. Never let a failure be silent, and never let a `console.error` stand in
  for telling the user.
- A long-running job was queued rather than finished. Say that it was queued.

Do **not** add a toast when:

- The change is already obvious on screen (a row appears, a switch flips, a page navigates).
- A form shows the problem inline next to the field it belongs to. Inline validation is
  better than a toast, because it stays put while the user fixes it. A toast alongside the
  inline message is only worth it when the field can be scrolled out of view.
- A read failed on a surface that already renders its own empty or error state.

## Lifecycle helpers own the wording

For the ordinary add / edit / delete outcomes, call a helper rather than writing a string.
The helper decides the verb, the casing and the punctuation, so the same operation cannot
say "Problem created!" on one page and "Problem updated." on another.

```tsx
showToast.created('Problem'); // -> Problem created
showToast.updated('Course');
showToast.deleted('Assignment', { name: assignment.title }); // -> "Pumping Lemma" deleted
showToast.added('Problem'); // attached something that already existed
showToast.removed('Problem', { name: problem.title }); // unlinked, not destroyed
showToast.duplicated('Group set');
showToast.imported('Assignment');
showToast.saved('Grades'); // -> Grades saved
```

Pass the item's own name whenever you have it. It is quoted and truncated for you, and it
is what makes the message useful: working down a list of problems, "Problem deleted" cannot
tell you which one went.

`added` and `removed` are deliberately distinct from `created` and `deleted`. Removing a
problem from an assignment leaves the problem in the course; deleting it does not.

## House style

Applies to helper output and to the one-off strings you still write by hand.

- Sentence case, no trailing punctuation on the main line: `Password changed`, not
  `Password changed successfully!`.
- No "successfully". A success toast already says that by being a success toast.
- No exclamation marks.
- Plain language, not implementation vocabulary. "Could not load the assignment", not
  "Failed to load assignment context".

## Error messages say the cause and the next step

A user reading "Failed to save" learns nothing they did not already know. Write the cause,
then what to do about it:

| Instead of                                | Write                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `Failed to save course`                   | `Could not save the course. Check your connection and try again.`                       |
| `Failed to load grades`                   | `Could not load grades. Refresh the page to try again.`                                 |
| `Failed to load roster entry`             | `Could not load this roster entry. Close and reopen this dialog to try again.`          |
| `Cannot remove user from archived course` | `This course is archived, so its roster cannot be changed. Unarchive the course first.` |

The three standard next steps are "Check your connection and try again." for a write,
"Refresh the page to try again." for a page-level read, and "Close and reopen this dialog to
try again." for a read inside a dialog. When the cause is a rule rather than a fault, say
what would change it instead.

When the API returns its own message, prefer that message: it is more specific than anything
the client can infer. Fall back to a written-out sentence only when the failure is not an
`ApiError`.

```tsx
showToast.error(
  err instanceof ApiError
    ? err.message
    : 'Could not change the assignment type. Check your connection and try again.',
);
```

## Warnings and info

`showToast.warning` is for a partial success: the action mostly worked, and there is
something left for the user to do. Give it a `description` naming that something.

`showToast.info` is rare. If a message is worth interrupting for, it is usually an error;
if it is not, it is usually not worth a toast.

## Testing

Mock the module with the shared double rather than hand-rolling an object literal, so a new
helper does not break unrelated suites:

```tsx
vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
import { toastMock } from '@/test/mocks/toast';

expect(toastMock.created).toHaveBeenCalledWith('Assignment', { name: 'Homework 1' });
```

Assert the helper and its arguments, not the rendered sentence. The sentence lives in
`src/lib/toast.ts`, and a test that pins it there and here has to be edited twice.
