# Testing the evaluator

Student submissions are graded by a Java program, `jars/afct-evaluator.jar`, which the
build bakes into the image. Because it is the grading **oracle**, a regressed,
mis-swapped, or mis-invoked evaluator would silently mis-grade students rather than fail
loudly. To prevent that, every build runs a set of **golden tests**: known
answer/submission pairs are fed through the real jar and the correct/incorrect verdict is
asserted.

This page explains how the tests work and, most importantly, **how to add your own**.

## How it works

- **Fixtures** live in `test/evaluator/`:
  - `cases/` holds the `.jff` files (answer keys and submissions).
  - `manifest.json` declares each case and its expected verdict.
- **The runner** is `scripts/evaluator-smoke.mjs`. It invokes the jar through the same
  code path production uses (`lib/java-runner.js`), so the test exercises the exact JVM
  flags, environment allow-list, timeout, and output cap the submission worker applies.
  It parses the evaluator's JSON output and checks `correct` against the manifest.
- **CI** runs it. The `evaluator` job in `.github/workflows/ci.yml` sets up a JRE 21
  (matching the runtime image) plus `fontconfig` and a font, then runs
  `npm run test:evaluator` on every push and pull request. The font matters because JFLAP
  initializes Swing even in headless CLI mode and throws `Fontconfig head is null` without
  it. A failing case fails the build.

## Running the tests locally

You need a JRE on your `PATH`, or you can run it inside the worker container, which
already has one:

```bash
# With a local JRE:
npm run test:evaluator

# Or against the image, via the worker container:
docker exec afct-dev-worker sh -c 'cd /app && npm run test:evaluator'
```

## Adding a test case

1. **Add the fixtures.** Put the answer-key `.jff` and the submission `.jff` into
   `test/evaluator/cases/`. The convention is a `*-solution.jff` answer key and one or
   more `*-incorrect-answer-N.jff` submissions, but any names work.

2. **Declare the case** in `test/evaluator/manifest.json`, appending to `cases`:

   ```json
   {
     "name": "Short human-readable description",
     "type": "FA",
     "answer": "my-solution.jff",
     "submission": "my-submission.jff",
     "maxStates": -1,
     "deterministic": false,
     "expectCorrect": true
   }
   ```

   | Field          | Meaning                                                                    |
   | -------------- | -------------------------------------------------------------------------- |
   | `name`         | Shown in the test output.                                                  |
   | `type`         | `FA`, `RE`, `CFG`, `PDA`, or `TM`.                                          |
   | `answer`       | The answer-key file, relative to `cases/`.                                 |
   | `submission`   | The file being graded, relative to `cases/`.                               |
   | `maxStates`    | `FA`/`PDA` only; state cap, `-1` for no limit.                             |
   | `deterministic`| `FA` only; whether the automaton must be a DFA.                            |
   | `expectCorrect`| The verdict this jar must return for the case to pass.                     |

   `maxStates` and `deterministic` map to the same per-type arguments that
   `buildEvaluatorArgs()` sends in `src/lib/submission-worker.ts`, so a case runs exactly
   as production would grade it.

3. **Confirm and commit.** Run `npm run test:evaluator` and check the jar returns the
   verdict you declared, then commit the fixtures together with the manifest entry.

A good pair of cases for any problem: grade a solution **against itself**
(`expectCorrect: true`) and grade a known-wrong submission against the solution
(`expectCorrect: false`).

## What each type exercises

- **`FA`** (finite automata) and **`RE`** (regular expressions) are decidable and need
  only the jar, so they are the least likely to fail for a reason unrelated to your change. Make
  them your default.
- **`CFG`** and **`PDA`** additionally invoke the native `cfganalyzer` binary
  (`bin/cfganalyzer`). The runner already points `CFGANALYZER_BINARY` and
  `CFGANALYZER_LIMIT` at it, so adding a CFG or PDA case is the way to also catch a broken
  `cfganalyzer` in the build.
- **`TM`** (Turing machines) cannot be graded today, and the suite records that rather than
  claiming otherwise. The only TM fixture is a plain `<type>turing</type>` machine, and the jar
  **refuses** it: "unsupported answer type". `TM` is also not offered when creating or editing a
  problem, so no course can set one through the interface. The schema, the viewers and the
  similarity features all carry `TM`, which is why it looks supported at a glance.

  **The seeded development database is misleading here.** It contains TM problems with
  submissions marked correct, which looks like proof that grading works. Those verdicts are
  written directly by `prisma/seed-dev.ts`; the evaluator never ran on them. Do not read them as
  evidence. The evaluator suite is the only thing in the repo that actually asks the jar.

:::note If `cfganalyzer` looks broken
Fourteen CFG and PDA cases fail together, each quoting the binary's own path as the
counterexample ("the string `/app/bin/cfganalyzer` is an example"). That is not a grading bug,
it is `bin/cfganalyzer` having lost its executable bit. It is stored `100755`, so this only
happens on a filesystem that drops the mode; `chmod +x bin/cfganalyzer` fixes it.
:::

Because context-free equivalence is undecidable in general, the CFG and PDA checks are bounded
and heuristic; pick fixtures whose verdict is unambiguous within those bounds.
