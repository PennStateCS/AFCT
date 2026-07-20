# Evaluator isolation

Status: **proposed** (not implemented). Written 2026-07-19 after a security audit of the
Java evaluator. Phase 0 below is done; phases 1-3 are the work this document scopes.

## Why

Grading runs student-supplied files. `afct-evaluator.jar` parses a submitted JFLAP/XML
automaton and, for grammars, shells out to the native `cfganalyzer` binary. Both are
parsers written against untrusted input, and the native one is C. A parser bug reachable
from a crafted submission is the realistic path to code execution in this system.

Today that code runs **inside the main app container**, as the same process tree that
serves the web app.

### Threat model

The attacker is an enrolled student who can upload an arbitrary file to a problem they
are assigned. They want to read the answer keys (every problem's solution), read other
students' submissions, or pivot into the database.

What a successful JVM/native exploit gets them **today**:

| Asset | Reachable? | Notes |
| --- | --- | --- |
| `DATABASE_URL`, `NEXTAUTH_SECRET`, admin creds | **No** | Not in the evaluator's environment (phase 0) |
| `/private/uploads/solutions` (all answer keys) | **Yes** | Readable by the app user |
| `/private/uploads/submissions` (all student work) | **Yes** | Same |
| Postgres on the network | Reachable, not authenticated | No credentials in the JVM env; `backend` is internal so not exposed off-host |
| Outbound internet | **Yes** | The app needs egress for ACME + hCaptcha |
| Host root | No | Container runs as non-root `node`, `cap_drop: ALL`, `no-new-privileges` |

So the residual exposure is **confidentiality of answer keys and submissions**, plus
whatever a foothold in the app container enables. That is what phases 1-3 close.

## Phase 0 - done

- **Environment allowlist** (`lib/java-runner.js`, commit `db5dc50a`). The JVM gets
  `PATH, JAVA_HOME, LANG, LC_ALL, LC_CTYPE, TZ, HOME, TMPDIR, TEMP, TMP` plus the two
  `CFGANALYZER_*` values. It no longer inherits `process.env`.
- **Output cap.** Combined stdout+stderr is bounded at 2 MB; the process is SIGKILLed on
  overflow so a submission cannot spew output until the worker runs out of memory.
- **Wall-clock timeout + heap cap.** `-Xmx`, `-XX:+ExitOnOutOfMemoryError`, and a SIGKILL
  timeout. These are availability controls, not a sandbox.
- **Container hardening** (`deploy/docker-compose.yml`). `cap_drop: ALL`,
  `no-new-privileges`, `pids: 512`, non-root user, 2 CPU / 4 GB.
- **Network segmentation.** Postgres and the backup sidecar sit on an `internal: true`
  network with no gateway; the app joins it for DB access while keeping egress on the
  public-facing network.

## Target architecture (phases 1-3)

A separate `evaluator` service that holds **no secrets, no database access and no
network egress**, and receives one submission at a time over an internal-only network.

```
app  ──HTTP──▶  evaluator          (internal network, no gateway)
 │                 │
 │                 ├─ /app/jars/afct-evaluator.jar
 │                 ├─ /app/bin/cfganalyzer
 │                 └─ per-request tmpdir, deleted after
 │
 └─ owns the queue, the DB, and all file storage
```

The app keeps the queue and every DB write. Only *execution* moves.

### Interface

Files travel **in the request body**, not on a shared volume. This is stronger than
mounting `/private/uploads` read-only: the evaluator never has a path to any file other
than the two it was handed, so there is no "read every answer key" primitive even with
full code execution in that container.

```
POST /evaluate
Content-Type: application/json

{
  "answer":    "<base64 or raw XML of the problem's answer file>",
  "submission":"<base64 or raw XML of the student's file>",
  "args":      ["--json", "..."],          // buildEvaluatorArgs() output
  "timeoutMs": 30000,
  "maxMemoryMb": 512,
  "analyzerLimit": 15
}

200 { "stdout": "...", "stderr": "...", "exitCode": 0 }
422 { "error": "timeout" | "output-limit" | "nonzero-exit", "stderr": "..." }
```

The evaluator writes both payloads into a fresh `mktemp -d` working directory, runs the
JAR exactly as `JavaRunner.execute` does now, returns the captured output, and removes the
directory in a `finally`. It keeps the existing timeout / heap / output-cap logic - that
code moves, it does not get rewritten.

### Container spec

```yaml
evaluator:
  image: ghcr.io/pennstatecs/afct-evaluator:${AFCT_APP_TAG:-main}
  read_only: true                  # writes only to the tmpfs below
  tmpfs:
    - /tmp:size=256m,mode=1777      # per-request working dirs
  cap_drop: [ALL]
  security_opt: [no-new-privileges:true]
  networks: [evaluator]             # internal: true, and NOT on backend/frontend
  deploy:
    resources:
      limits: { cpus: '1.5', memory: 2G, pids: 256 }
  environment: {}                   # no env_file: it needs nothing
  user: node                        # non-root
```

Note it is **not** on the `backend` network, so it cannot reach Postgres at all - a
strictly smaller reach than the app has today.

### Rollout

1. **Phase 1 - build the image and the service.** New `docker/evaluator/Dockerfile`
   (JRE + the jar + cfganalyzer + a ~100-line HTTP server reusing the JavaRunner logic).
   Add the compose service. Publish through the existing CI image pipeline.
2. **Phase 2 - switch the app over behind a flag.** `EVALUATOR_URL` unset keeps the
   current in-process path; set, it POSTs instead. Ship with it unset, enable on the test
   VM, then flip the default. This keeps a one-line rollback for a grading regression.
3. **Phase 3 - remove the in-process path.** Drop the JRE, the jar and cfganalyzer from
   the app image (which also shrinks it noticeably), delete `lib/java-runner.js` from the
   app, and make `EVALUATOR_URL` required.

### Things to get right

- **Install and upgrade.** `deploy/install.sh`, `install.ps1` and the in-app updater all
  enumerate services and image tags; the new image must be pulled and version-pinned in
  lockstep, and the updater's tag allowlist must accept it.
- **System Status.** The "Java available" probe currently runs in the app. It must move to
  an evaluator health check, or Status will report Java missing once phase 3 lands.
- **Concurrency.** Evaluator concurrency is configured in System Settings and enforced by
  the in-process worker pool. Either keep the pool app-side (simplest - the app just makes
  N concurrent HTTP calls) or move the limit into the evaluator. Prefer app-side.
- **Request size.** Cap the POST body; a submission is already size-limited on upload, but
  the evaluator should enforce its own bound rather than trust the caller.
- **Failure mode.** If the evaluator is unreachable, submissions must land in a retryable
  state, not silently fail as "incorrect".

### Effort

Roughly 2-3 focused days: about a day for the image plus HTTP wrapper, half a day for the
app-side client and flag, half a day for install/updater/status plumbing, and the rest for
tests and a real deploy rehearsal on the test VM. The risk sits in deployment plumbing,
not in the evaluation logic, which moves essentially unchanged.

## Not doing

- **Per-submission containers** (`docker run` per evaluation). Needs the Docker socket in
  the app container, which is exactly what the updater service exists to avoid.
- **seccomp/AppArmor profiles for the JVM.** Worth revisiting after phase 3; a custom
  profile is easy to get wrong and the container boundary buys most of the benefit.
- **gVisor/Kata.** Disproportionate for a single-host teaching deployment.
