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

AFCT creates a self-signed certificate during the first startup, so HTTPS works immediately, but browsers show a warning because the certificate is not trusted. A self-signed certificate is reasonable for restricted testing; a public or institution-facing deployment should install a certificate from a trusted certificate authority.

The **TLS Certificate** tab shows the current certificate (trusted, self-signed, or expired, plus the domain and expiry) and supports four setup methods:

- Request and automatically renew a trusted certificate from Let's Encrypt
- Generate a certificate signing request (CSR), then install the signed certificate
- Create a self-signed certificate
- Upload an existing PEM certificate and private key

A new certificate normally becomes active within about 15 seconds, and no container restart is needed. If a certificate is invalid, AFCT rejects it and keeps the current one, so the site stays reachable. The private key is never displayed after it is uploaded.

### Get a free certificate with Let's Encrypt

If the server is reachable from the public internet, AFCT can obtain and automatically renew a browser-trusted certificate from [Let's Encrypt](https://letsencrypt.org/) with no external tools.

Requirements:

- A domain name that resolves to this server in public DNS.
- Port 80 reachable from the internet. Let's Encrypt fetches a one-time file over plain HTTP at that domain to confirm you control it.
- The domain should match your configured URL (`NEXTAUTH_URL`).

Steps:

1. Select **TLS Certificate**, then **Get a free certificate (Let's Encrypt)**.
2. Confirm the domain (prefilled from your configured URL) and enter a contact email. Let's Encrypt uses the email only for expiry and policy notices.
3. Optionally turn on **Use staging** to run a test issuance first. Staging issues an untrusted test certificate but confirms DNS and port 80 are set up correctly without spending the weekly rate limit. Turn it off and request again once the test succeeds.
4. Agree to the Let's Encrypt terms of service and select **Request certificate**. Issuance usually takes under a minute, with live progress shown as it validates the domain and installs the certificate.

After it succeeds, AFCT renews the certificate automatically before it expires. The status shows the managed domain and an **Auto-renewing** badge; select **Turn off auto-renewal** to stop managing it (the current certificate stays in place). Installing a trusted certificate also enables HSTS, which tells browsers to use HTTPS for this domain from then on.

If issuance fails, the previous certificate is kept. The most common causes are DNS not pointing at this server or port 80 being blocked; use the staging option while sorting those out, because Let's Encrypt rate-limits failed attempts.

### Upload an existing certificate

1. Select **TLS Certificate**.
2. Upload the certificate in PEM format and the matching private key in PEM format.
3. Add any intermediate or chain certificates supplied by the certificate authority.
4. Select **Apply certificate**.

AFCT checks that the key matches the certificate, that the certificate has not expired, and that both files use supported formats. Invalid files are rejected without replacing the current certificate.

### Request a CA-signed certificate

Generate a certificate signing request from the TLS tab and submit it to your institution or certificate authority. The private key is created and kept on the server; the CSR contains only public information and does not expose the key. When the signed certificate comes back, install it from the same tab.

### Reset to the self-signed certificate

Select **Reset to self-signed** to revert to the built-in certificate.

### Troubleshoot certificate warnings

A warning is expected with the default self-signed certificate. A warning on a previously trusted deployment usually means the certificate expired, the wrong certificate was installed, the hostname is missing from the certificate, an intermediate certificate is missing, or DNS points to a different server. Check the installed certificate here and renew or replace it as needed.

## Updates

The **Updates** tab can upgrade AFCT to an approved release or restore a previous version when the updater service is enabled on the host.

An upgrade creates a backup, changes the application version, checks health, and rolls back when the new version does not start successfully.

Restoring a previous version also restores its database backup. This permanently discards submissions, grades, accounts, and other database records created since that backup. Uploaded files remain and can become unreferenced. Read [Update AFCT](../reference/updates.md) and confirm that you accept the result before restoring an older version.
