# Editor setup (VS Code)

VS Code is what the team uses. Nothing here is required to build or run AFCT, but it is the
difference between finding a problem as you type and finding it when CI fails.

The repository ships two files, so most of this is automatic:

- `.vscode/extensions.json`: the recommended extensions.
- `.vscode/settings.json`: settings that keep the editor agreeing with `npm run lint` and
  `npm run typecheck:all`.

You do not need to copy anything. Open the folder and VS Code picks them up.

:::tip Windows
Set up [WSL](./development-windows.md) first and open the project from inside Ubuntu. Working
from `C:\` is many times slower, and extensions have to be installed into WSL separately.
:::

## First open

1. **Trust the folder.** A banner asks on first open. Until you click Trust, VS Code runs in
   Restricted Mode and neither ESLint nor Prettier will run.
2. **Install the recommended extensions.** A notification offers them. If you miss it, open
   the Extensions panel and type `@recommended`, then install the workspace list.
3. **On WSL, install them again inside Ubuntu.** Extensions that read your code run where the
   code is. Look for the blue **Install in WSL: Ubuntu** buttons and click them. The bottom
   left of the window must read `WSL: Ubuntu`; if it does not, you have opened the Windows
   copy of the repository.

## What the recommended extensions are for

| Extension | Why |
| --- | --- |
| **WSL** | Opens the project from inside Ubuntu. Windows only, and the important one. |
| **ESLint** | The same rules CI runs. CI fails on warnings, so seeing them early matters. |
| **Prettier** | Formatting, applied only to lines you change (see below). |
| **Prisma** | Syntax and formatting for `prisma/schema.prisma`. |
| **Tailwind CSS IntelliSense** | Class-name completion and hover previews. |
| **Vitest** | Run and debug a single test from the editor gutter. |
| **Playwright** | Same, for the browser suite in `e2e/`. |
| **ShellCheck** | Catches shell bugs in `deploy/`, which has broken deployments before. |
| **Markdown Mermaid** | Previews the diagrams in `docs-site/`, including the schema ERD. |
| **GitHub Pull Requests** | Review and check CI without leaving the editor. |

## Settings worth understanding

The settings file is commented, but two choices surprise people:

**Formatting only touches the lines you changed.** `editor.formatOnSaveMode` is set to
`modifications`, not the default. `src/` is deliberately not Prettier-clean, and the Prettier
config loads the Tailwind class-sorting plugin, so formatting a whole file would reorder every
class list in it and bury your actual change in the diff.

**The editor uses the repository's TypeScript**, not whichever version VS Code ships, so what
you see matches `npm run typecheck:all`. If VS Code prompts you to use the workspace version,
say yes.

Also set: LF line endings everywhere. CRLF has broken deployment scripts before, because an
extensionless file such as `deploy/unix/bin/afctctl` saved with CRLF stops being runnable by
`sh`, and the failure only shows up inside a container.

## Running things from the editor

- **Tests**: the Vitest extension puts a run arrow next to each test. Faster than re-running
  the whole suite for one file.
- **Terminal**: `` Ctrl+` `` opens a shell already in the right place. On WSL that is a shell
  inside Ubuntu, in the repository.
- **The full check before pushing** still belongs in a terminal, and is described in
  [Contributing](../reference/contributing.md). The editor catches your own slips; it does not replace
  the checks CI runs.

## If you use something else

Nothing here is mandatory. If you use another editor, the things worth reproducing are: run
ESLint with the repository config, format only changed lines, use the repository's TypeScript
version, and write LF line endings.
