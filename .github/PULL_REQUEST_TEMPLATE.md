<!-- Keep PRs focused; unrelated cleanups belong in their own PR. -->

## What and why

<!-- What does this change, and why? Link any related issue (e.g. Closes #123). -->

## How it was tested

<!-- Tests added/updated, and how you verified the change. -->

## Checklist

- [ ] Branched off `main` (no direct commits to `main`)
- [ ] `npm run lint -- --max-warnings=0` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Ran `npm run docs` and committed `src/types/api.ts` if an `@openapi` block changed
- [ ] Access-control changes reflected in [roles and permissions](../docs/reference/roles-and-permissions.md)
