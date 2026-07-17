# System settings

**System Settings** (Admin menu) controls platform-wide behavior. This page lists every setting, tab by tab, with its default and allowed range. Only administrators can view or change these settings.

Changes take effect when saved. The submission worker reloads its settings on its own (within about 30 seconds); nothing needs a restart.

## General

| Setting | Default | Range | What it does |
|---|---:|---:|---|
| **Timezone** | UTC | common timezones | Default timezone inherited by new courses. Existing courses keep their own timezone. |
| **Max upload size (MB)** | 25 | 1–1,024 | File-size limit for submissions and avatars. |
| **Session timeout (minutes)** | 60 | 5–1,440 | Idle time before a signed-in user is logged out. Enforced by the server: closing or switching browsers does not extend an expired session. |
| **Failed logins before lockout** | 10 | 3–50 | Failed sign-in attempts on one account before it is temporarily locked. |
| **Account lockout duration (minutes)** | 10 | 1–1,440 | How long a locked account must wait. An administrator can release it early with **Unlock** on the user page. |
| **Audit log retention (days)** | 365 | 30–3,650 | How long audit entries are kept before automatic pruning. |
| **Allow user signup** | on | — | Enables or disables public registration. With signup off, administrators create accounts. |
| **Allowed signup email domains** | any | — | Comma-separated list restricting public registration by email domain. Blank allows any domain. |
| **24-hour clock** | off | — | Display-only: switches times between AM/PM and 24-hour format. Stored timestamps and deadline enforcement are unchanged. |

## Submission queue

These control the evaluation worker that grades submissions. Change them only when the current workload requires it.

| Setting | Default | Range | What it does |
|---|---:|---:|---|
| **Evaluation timeout (seconds)** | 30 | 1–600 | Maximum run time for one evaluation before it is failed. |
| **Resubmit cooldown (seconds)** | 10 | 0–3,600 | Minimum delay before a student can resubmit the same problem. |
| **Evaluator memory cap (MB)** | 256 | 64–8,192 | Memory limit for one evaluation. |
| **Max concurrent evaluations** | 5 | 1–20 | Evaluations that run at once. |
| **Max retry attempts** | 3 | 1–10 | Attempts for a failed evaluation before it is marked failed. |
| **Analyzer exploration limit** | 15 | 1–100 | Depth bound for the CFG analyzer. Higher finds more, but runs slower; the evaluation timeout still applies. |

## Backups

| Setting | Default | Range | What it does |
|---|---:|---:|---|
| **Enable automatic backups** | on | — | Daily database dump plus an archive of uploaded files. |
| **Daily backup time (hour)** | 2 | 0–23 | Hour of the day the backup runs, in server (UTC) time. |
| **Retention (days)** | 14 | 1–365 | Backups older than this are pruned. |

The tab also lists existing backups and has a **Back up now** button for an immediate run. See [Backups and recovery](backups.md) for restoring and for copying backups off the host.

## Security (hCaptcha)

Optional bot protection, shown as a challenge after repeated failed logins.

| Setting | What it does |
|---|---|
| **hCaptcha site key** | The public key from your hCaptcha account. |
| **hCaptcha secret key** | Write-only: once saved it is never displayed again. Use **Remove saved secret key** to clear it. |

Leave both blank to disable the challenge. Do not use hCaptcha test credentials in production.

## TLS certificate

Replaces the self-signed certificate the stack starts with, so browsers stop warning. Two methods:

- **Certificate signing request**: enter the hostname (Common Name), optional organization and additional hostnames (SANs), generate a CSR, have your certificate authority sign it, then paste the signed certificate and any chain back in. The private key never leaves the server.
- **Upload**: paste an existing certificate, private key, and optional chain (all PEM).

You can also reset back to the self-signed certificate. See [HTTPS certificates](https-certificates.md) for the full procedure.

## Updates

Upgrade or downgrade AFCT from the browser. This tab is functional only when the updater service is enabled on the host (`sh install.sh enable-updater`); it is off by default because the updater holds the Docker socket.

- **Current version** and a list of published releases to upgrade to. An upgrade backs up the database first, downloads the new version, restarts, and rolls back automatically if the new version fails its health check.
- **Restore a previous version**: downgrades by restoring the database backup taken before that version was replaced. This **permanently discards everything created since that backup** — submissions, grades, accounts — and is confirmed by typing the target version. Treat it as recovery, not a casual undo.

See [Update AFCT](../reference/updates.md) for the command-line equivalent and details.
