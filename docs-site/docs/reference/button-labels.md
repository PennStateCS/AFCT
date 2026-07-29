# Button labels

This page covers how to word action buttons: triggers, dialog footers, and row actions. For
when an action needs a confirmation dialog at all, see [Confirmation dialogs](./confirmation-dialogs.md).

Two buttons that do the same kind of thing should say the same thing, and a button that
changes or removes data should say what it changes or removes. A reviewer who has never
seen the feature should be able to tell, from the label alone, what happens when they
click it.

## Pick the verb for the action, not the mechanism

Name the button after what the user is trying to do, not after the underlying API call.
"Reset Password" tells the admin what happens; "Save" does not, even though both end in a
`PATCH` request.

- **Saving edits to a multi-field form**: `Save Changes` (`Saving…` while busy).
- **Renaming a single item**: plain `Save` is fine, since the dialog title already names
  the thing being renamed.
- **A more specific verb exists**: use it instead of `Save`. `Change Password`,
  `Change Email`, `Reset Password`, and `Save Grade` all beat a generic save, and the busy
  label should match the verb (`Changing…`, `Resetting…`) rather than default to `Saving…`.
- **Creating a record**: `Create <Object>`, e.g. `Create Course` (`Creating…`).
- **Copying a record**: `Duplicate <Object>`, e.g. `Duplicate Assignment` (`Duplicating…`).
- **Adding to a collection**: `Add <Object>`, e.g. `Add group`, `Enroll User` (`Adding…`,
  or something action-specific like `Enrolling…`).
- **Opening an editor**: `Edit <Object>`. It just opens a dialog, so there's no busy state
  to label.

## Destructive buttons name what they affect

A button that deletes, removes, or otherwise discards data must name the object in its own
visible text. Never ship a bare `Delete`, `Remove`, or `Clear`, even if an `aria-label` or
surrounding row makes the target clear to a sighted mouse user; a value read out of context
(a browser "confirm navigation" prompt, a password manager, a screen reader jumping
button-to-button) should still make sense on its own.

```tsx
// Avoid: only the aria-label says what is being deleted
<Button aria-label={`Delete abandoned file ${f.fileName}`}>Delete</Button>

// Prefer: the visible label carries the object too
<Button aria-label={`Delete abandoned file ${f.fileName}`}>Delete File</Button>
```

Follow the object named in the button through to the `ConfirmDialog` that follows it.
`confirmText` should use the same object, not a broader or narrower one:

```tsx
// Avoid: the trigger says "Delete Inactive User", the dialog says "Delete user"
confirmText="Delete user"

// Prefer: trigger and confirmation agree
confirmText="Delete inactive user"
```

See [Confirmation dialogs](./confirmation-dialogs.md#using-the-component) for the full
`ConfirmDialog` API, including `variant="destructive"` and type-to-confirm for the most
consequential actions.

## Match the object's own name, not a shortened version

If the feature calls the object a "group set" everywhere else (the page heading, the
dialog titles, the `ConfirmDialog` text), the dropdown menu that triggers those actions
should say "group set" too, not "set". A shortened label saves a few characters and costs
the reader a moment of "wait, a set of what?"

## Casing

- **Triggers and menu items** (a button or `DropdownMenuItem` that opens a dialog) use
  Title Case: `Delete Course`, `Duplicate Assignment`, `Create Problem`.
- **Dialog footer buttons**, including `ConfirmDialog`'s `confirmText`, use sentence case:
  `Delete course`, `Save Changes`, `Cancel`. (`Save Changes` and `Create <Object>` are the
  established exceptions inside dialogs, matching the trigger that opened them.)

This mirrors the existing split in the codebase: a user clicks a Title Case menu item and
gets a sentence-case confirmation, the same way a Title Case link on a page opens a
sentence-case paragraph. Keep new dialogs consistent with whichever position they are in
rather than inventing a third casing style.

## Busy-state text

- Use an ellipsis character (`…`), not three periods (`...`).
- Match the busy label's verb to the idle label's verb. If the idle label is
  `Change Password`, the busy label is `Changing…`, not `Saving…`.

## Cancel, not a synonym

Every dialog's dismiss button says `Cancel`. Do not introduce `Discard`, `Back`, or `Close`
for a form that has unsaved input; `Close` is reserved for read-only viewers where nothing
can be lost (for example, a problem description preview). `ConfirmDialog` defaults
`cancelText` to `Cancel` and no call site should need to override it.

## Words that mean more than one thing

"Reset" and "Clear" each cover multiple, semantically different actions across the app:
discarding unsaved form edits, regenerating a TLS certificate, issuing a new password,
clearing a search box, and clearing an administrative rate limit. Reusing one of these
words for a new action is fine, but check what else on the same page or in the same
feature area already uses it. If the new action is destructive or administrative and the
existing use is cosmetic (or vice versa), prefer a more specific verb instead of adding a
third meaning.
