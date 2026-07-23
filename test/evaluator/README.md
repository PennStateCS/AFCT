# Evaluator golden tests

These are **build-time smoke tests for the evaluator jar** (`jars/afct-evaluator.jar`).
They run the exact jar that ships in the image against known submission/answer pairs
and assert the correct/incorrect verdict, so a regressed or mis-swapped evaluator (or a
broken invocation) fails the build instead of silently mis-grading students.

- Runner: [`scripts/evaluator-smoke.mjs`](../../scripts/evaluator-smoke.mjs) — reuses the
  **production** invocation (`lib/java-runner.js`), so it exercises the same JVM flags,
  env allowlist, timeout, and output cap the submission worker uses.
- Cases: [`manifest.json`](./manifest.json) + the `.jff` fixtures in [`cases/`](./cases).
- CI: the `evaluator` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
  sets up a JRE 21 (matching the runtime image) plus `fontconfig` + a font (JFLAP inits
  Swing even in CLI mode) and runs `npm run test:evaluator` on every push and PR.

## Run locally

Needs a JRE on `PATH` (or run it inside the worker container, which has one):

```bash
npm run test:evaluator
# or, against the real image:
docker exec afct-dev-worker sh -c 'cd /app && npm run test:evaluator'
```

## Add a case

1. Drop the answer-key and submission `.jff` files into [`cases/`](./cases).
2. Add an entry to [`manifest.json`](./manifest.json):

   ```json
   {
     "name": "Short human-readable description",
     "type": "FA",                       // FA | RE | CFG | PDA | TM
     "answer": "my-solution.jff",        // the answer key, relative to cases/
     "submission": "my-submission.jff",  // the file being graded
     "maxStates": -1,                    // FA/PDA only; -1 = no limit
     "deterministic": false,             // FA only; must the FA be a DFA?
     "expectCorrect": true               // the verdict this jar must return
   }
   ```

   Optional: `"expectErrorContains": "unsupported answer type"` additionally requires
   the jar to explain itself in `feedback`/`errors`. Use it for files the evaluator is
   meant to *refuse*, so a refusal never degrades into a bare "incorrect" that a student
   would read as a wrong answer.

   `maxStates`/`deterministic` map to the same per-type args
   `buildEvaluatorArgs()` sends in `src/lib/submission-worker.ts`.

3. Run `npm run test:evaluator` to confirm the jar returns the expected verdict, then
   commit the fixtures + the manifest entry.

## Notes

- The `Hw-*` cases are **FA** (finite automata): equivalence is decidable and needs only
  the jar, so they're robust with no external tools. The **CFG** and **PDA** cases
  additionally exercise the native `cfganalyzer` binary (`bin/cfganalyzer`) via the
  `CFGANALYZER_BINARY` / `CFGANALYZER_LIMIT` env vars the runner sets, so a broken or
  missing cfganalyzer now fails the build instead of surfacing at grading time.
- A `-solution.jff` graded against itself must be `expectCorrect: true`; an
  `-incorrect-answer-N.jff` graded against the solution must be `expectCorrect: false`.
- `cfganalyzer` is a **Linux** binary, so the CFG/PDA/refusal cases only pass on Linux.
  On a Windows or macOS host, run the suite inside the worker container.
- Fixtures: the `Hw-*` files are seeded from the AFCT-Evaluator project's own
  `TestInputExtended`. The rest are JFLAP's bundled example files, which carry no
  expected verdict of their own, so they are paired with themselves: an answer key
  graded against an identical submission must always come back correct. That is a
  weaker assertion than a real wrong-answer pair, but it is the assertion that catches
  a broken parser, a broken cfganalyzer, or a mis-swapped jar for the types the `Hw-*`
  cases never touch.
