# Confirmation dialogs

AFCT uses one shared component for every "are you sure?" prompt:
`ConfirmDialog` in `src/components/dialogs/ConfirmDialog.tsx`. This page covers when an
action should ask for confirmation and how to wire the component up.

## When to require confirmation

Add a confirmation when the action is one of:

- **Permanent deletion**: deleting a user, course, assignment, problem, comment, group, or
  backup file.
- **Removing access**: removing a student from a roster, deactivating an account, or
  dropping a student.
- **Affecting other users**: changing HTTPS for every visitor, publishing or unpublishing
  work, or re-running the autograder over many submissions at once.
- **Hard to reverse**: archiving a course, changing an assignment's type, or downgrading the
  application to an older version.

Do **not** add a confirmation to routine, easily reversible actions. Saving a form,
enrolling a user, moving a group member, and re-running a single submission all run
immediately. An extra click on a safe action is friction, not safety.

Match the tone to the consequence:

- Use `variant="destructive"` (the red button) only for permanent or access-removing
  actions.
- Leave the default styling for reversible actions so the interface is not needlessly
  alarming.
- Write a title that names the action, a one-sentence description of what happens, and a
  specific confirm label like "Delete course" rather than a bare "Delete".

## Using the component

Import it and render it alongside the control that triggers it. Track an `open` flag in
state and pass handlers for confirm and cancel.

```tsx
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

const [open, setOpen] = useState(false);

<ConfirmDialog
  open={open}
  variant="destructive"
  title="Delete course?"
  description="If the course has no data it is removed permanently. Otherwise it is hidden."
  confirmText="Delete course"
  onConfirm={() => deleteCourse(id)}
  onCancel={() => setOpen(false)}
/>;
```

### Props

| Prop                       | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `open`                     | Whether the dialog is visible.                                             |
| `title`                    | Short question naming the action.                                          |
| `description`              | One sentence on the consequence. Accepts a React node.                     |
| `confirmText`              | Action-specific confirm label. Defaults to "Confirm".                      |
| `cancelText`               | Defaults to "Cancel".                                                      |
| `variant`                  | `'default'` or `'destructive'`. Defaults to `'default'`.                   |
| `busy`                     | Externally tracked pending flag; disables the buttons and shows a spinner. |
| `requireTypedConfirmation` | Requires the user to type this exact string before confirming.             |
| `typedConfirmationLabel`   | Help text shown above the type-to-confirm field.                           |
| `onConfirm`                | Runs on confirm. May return a Promise.                                     |
| `onCancel`                 | Runs on cancel, Escape, or dismissal.                                      |

### Preventing repeated submissions

The component blocks double submissions on its own. There are two ways to feed it a pending
state, and you can use either:

1. **Return a Promise from `onConfirm`.** The dialog disables both buttons and shows a
   spinner until the promise settles, so a second click does nothing.

   ```tsx
   onConfirm={() => deleteCourse(id)} // deleteCourse returns a Promise
   ```

2. **Pass a `busy` flag** when the call site already tracks its own pending state (for
   example a mutation's `isPending`).

   ```tsx
   <ConfirmDialog busy={isPending} onConfirm={() => mutateAsync(vars)} /* ... */ />
   ```

### Type-to-confirm

For the most consequential actions, require the user to type a value before the confirm
button enables. AFCT uses this for the version downgrade, which discards data.

```tsx
<ConfirmDialog
  open={open}
  variant="destructive"
  title={`Restore and downgrade to ${version}?`}
  description="Everything created since that backup is permanently lost."
  requireTypedConfirmation={version}
  typedConfirmationLabel={`Type ${version} to enable the restore button.`}
  confirmText="Restore and downgrade"
  onConfirm={() => downgrade(version)}
  onCancel={() => setOpen(false)}
/>
```

## Accessibility

The dialog is built on the shared Radix dialog, so focus is trapped while it is open and
returned to the trigger on close. Beyond that, the component:

- Focuses the Cancel button by default (or the typed field when present), so pressing Enter
  does not immediately run a destructive action.
- Closes on Escape or Cancel, and never on an outside click, so an accidental click cannot
  discard the prompt.
- Locks the dialog while an action is running: the buttons disable and Escape is ignored
  until it finishes.

For a case where the triggering control becomes disabled while a long action runs (so the
default focus return would drop to the page body), pass `onCloseAutoFocus` to redirect
focus. The Updates tab uses this to send focus to its progress panel.

## After the action runs

The dialog asks; it does not report. Whatever the confirm handler does still has to say
whether it worked. See [Toast messages](./toast-messages.md) for who shows that message and
how to word it.
