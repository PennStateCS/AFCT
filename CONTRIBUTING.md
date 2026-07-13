# Contributing to AFCT Dashboard

Thanks for your interest in contributing. This guide covers the essentials; the
[developer guide](docs/guides/developer.md) has the deeper detail on architecture,
the authorization model, and conventions.

## Getting set up

The project runs in Docker — there is no bare-metal dev mode. See the
[development setup](docs/setup/development.md) for the full walkthrough. In short:

```sh
npm install
npm run docker:dev
```

## Making a change

1. Branch off `main` — do not commit directly to `main`.
2. Make your change, with tests. This codebase keeps a high test bar; new behavior
   should come with unit/route tests, and bug fixes with a regression test.
3. Run the same gates CI runs, and make them all pass locally:
   ```sh
   npm run lint -- --max-warnings=0
   npm run typecheck
   npm test
   npm run docs      # regenerate the API types if you touched a route's @openapi block
   ```
   If you edited an `@openapi` annotation, commit the regenerated `src/types/api.ts`
   too — CI fails if it drifts.
4. Open a pull request against `main` and fill in the template. Keep the PR focused;
   unrelated cleanups belong in their own PR.

## Style

- Match the surrounding code — naming, structure, and comment density.
- Keep commit messages short and human: a sentence or a few of plain language, not a
  structured changelog.
- Access-control rules have one home, [roles and permissions](docs/reference/roles-and-permissions.md);
  link to it rather than restating a rule.

## Reporting bugs and security issues

- Regular bugs: open an issue using the bug-report template.
- **Security vulnerabilities: do not open a public issue.** Follow [SECURITY.md](SECURITY.md).
