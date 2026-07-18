# System Settings

**System Settings** controls platform-wide behavior. Only administrators can view or change these settings. Select **Save system settings** after changing stored settings.

## General

| Setting                                |      Default |                   Range | What it does                                                                                        |
| -------------------------------------- | -----------: | ----------------------: | --------------------------------------------------------------------------------------------------- |
| **Configured URL**                     | Server value |               Read-only | Shows the public address from `NEXTAUTH_URL`. Reconfigure the server and restart AFCT to change it. |
| **Timezone**                           |          UTC |        Common timezones | Sets the server default. Users and courses can have their own timezone.                             |
| **Max upload size (MB)**               |           25 |                 1 to 50 | Sets the file-size limit for uploads.                                                               |
| **Session timeout (minutes)**          |           60 |              5 to 1,440 | Signs a user out after inactivity.                                                                  |
| **Failed logins before lockout**       |           10 |                 3 to 50 | Sets how many failed attempts temporarily lock an account.                                          |
| **Account lockout duration (minutes)** |           10 |              1 to 1,440 | Sets how long a temporary lock lasts.                                                               |
| **Audit log retention (days)**         |          365 |             30 to 3,650 | Sets how long System Logs are kept before daily pruning.                                            |
| **Allow user signup**                  |           On |               On or off | Controls whether public signup is available.                                                        |
| **Allowed signup email domains**       |          Any | Comma-separated domains | Restricts public signup. Leave it blank to allow any domain.                                        |
| **24-hour clock**                      |          Off |               On or off | Changes how times appear throughout AFCT.                                                           |

The configured URL cannot be edited in the browser. On an installed server, use `sh install.sh --reconfigure` or set the correct `APP_URL` through the installer workflow.

## Evaluator

These settings control submission processing:

| Setting                          | Default |       Range | What it does                                                                      |
| -------------------------------- | ------: | ----------: | --------------------------------------------------------------------------------- |
| **Evaluation timeout (seconds)** |      30 |    1 to 600 | Stops an evaluation that runs too long.                                           |
| **Resubmit cooldown (seconds)**  |      10 |  0 to 3,600 | Sets the wait before another attempt. Zero disables the cooldown.                 |
| **Evaluator memory cap (MB)**    |     256 | 64 to 8,192 | Limits JVM heap for one evaluation.                                               |
| **Max concurrent evaluations**   |       5 |     1 to 20 | Controls how many evaluations run at once. Changes apply within about 30 seconds. |
| **Max retry attempts**           |       3 |     1 to 10 | Sets the attempts before a failed evaluation stays failed.                        |
| **Analyzer exploration limit**   |      15 |    1 to 100 | Controls the depth of the context-free grammar equivalence check.                 |

Increase concurrency, memory, or exploration limits only when the server has enough capacity. After changing evaluator settings, watch [Submission Logs](submission-logs.md) and [System Status](system-status.md).

## Backups

The **Backups** tab enables scheduled backups, sets the daily UTC hour, and controls retention. It also lists available backups and provides **Back up now** for an immediate run.

Keep the database dump and uploaded-file archive together. See [Backups and recovery](../operations/backups.md) for off-host copies and restore procedures.

## Captcha

The **Captcha** tab stores the optional hCaptcha site key and secret key used to protect sign-in and signup flows.

The secret is write-only and is not displayed after saving. Use **Remove saved secret key** when you need to clear it. Leave both fields blank to disable hCaptcha, and do not use hCaptcha test credentials in production.

## TLS Certificate

The TLS tab supports three setup methods:

- Generate a certificate signing request, then install the signed certificate
- Create a self-signed certificate
- Upload an existing PEM certificate and private key

AFCT can also reset the installation to a self-signed certificate. Review [HTTPS certificates](../operations/https-certificates.md) before replacing a production certificate.

## Updates

The **Updates** tab can upgrade AFCT to an approved release or restore a previous version when the updater service is enabled on the host.

An upgrade creates a backup, changes the application version, checks health, and rolls back when the new version does not start successfully.

Restoring a previous version also restores its database backup. This permanently discards submissions, grades, accounts, and other database records created since that backup. Uploaded files remain and can become unreferenced. Read [Update AFCT](../reference/updates.md) and confirm that you accept the result before restoring an older version.
