# Development Tests

The **Development Tests** page is a small interface test area for developers and administrators working on a non-production build.

The page currently includes:

- Buttons for every toast message style used by AFCT
- A loading message that updates to success
- Toasts with actions, such as an Undo button
- Common success, validation, network, authorization, and server-error messages
- A font comparison panel

Use it after changing shared interface styles or notification behavior. Confirm that each message appears, uses the expected styling, and remains readable with the current theme.

This page is not a server health check and does not test the evaluator, database, or submission queue. Use [System Status](system-status.md) for operational checks.

**Development Tests** is hidden in production. Its absence from a production Admin Menu is expected.
