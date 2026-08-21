# Development Tests

The **Development Tests** page is a small interface test area for developers and administrators working on a non-production build.

The page has four tabs:

- **Toast Message**: a button for every toast style AFCT uses, including a loading message that
  resolves to success, toasts carrying an action such as Undo, and the common success,
  validation, network, authorization and server-error messages.
- **Design Tokens**: the colour and spacing tokens as they render under the current theme.
- **Fonts**: a comparison panel for the type in use.
- **Rich Description**: a live instance of the description editor, so a change to it can be
  exercised without creating a problem first.

Use it after changing shared interface styles or notification behavior. Confirm that each message appears, uses the expected styling, and remains readable with the current theme.

This page is not a server health check and does not test the evaluator, database, or submission queue. Use [System Status](../admin/system-status.md) for operational checks.

**Development Tests** is hidden in production. Its absence from a production Administration menu is expected.
