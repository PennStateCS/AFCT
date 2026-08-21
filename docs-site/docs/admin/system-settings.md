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

Session timeout covers inactivity only. Separately, every session ends 12 hours after sign-in however busy it has been, so a browser left signed in cannot stay signed in indefinitely. That limit is fixed and is not a setting.

The configured URL cannot be edited in the browser. On an installed server, use `sh install.sh --reconfigure` or set the correct `APP_URL` through the installer workflow.

### Public signup

**Public signup** is self-service account creation: when **Allow user signup** is on, anyone who can reach the site can create their own AFCT account from the sign-in page. When it is off, only an administrator can add accounts, from [User Accounts](user-accounts.md) (individually or by bulk import).

Turn it **on** for open, self-service deployments where you want people to register themselves. Turn it **off** for a controlled installation where every account is provisioned by an administrator.

When public signup is on, use **Allowed signup email domains** to limit who can register, for example restricting signup to your institution's domain. Leave it blank to allow any domain.

Public signup only creates an account; it does not place anyone in a course. Enrolling in a course is separate and uses a course **registration code**, which Faculty manage per course (see [Roster](../faculty/roster.md) and [Settings](../faculty/settings.md)). The two controls are independent: an account is how someone signs in, and a registration code is how an existing account joins a specific course.

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

Increase concurrency, memory, or exploration limits only when the server has enough capacity. After changing evaluator settings, watch [Submissions](submissions.md) and [System Status](system-status.md).

## Backups

The **Backups** tab enables scheduled backups, sets the daily UTC hour, and controls retention. It also lists available backups and provides **Back up now** for an immediate run.

Keep the database dump and uploaded-file archive together. See [Backups and recovery](../operations/backups.md) for off-host copies and restore procedures.

## Email

The **Email** tab holds the mail server AFCT sends from. It is used for password reset links, so
people can recover their own accounts without an administrator doing it for them.

Email is off until you configure a server and switch it on. A site that leaves it off behaves
exactly as it did before: passwords can still be reset by an administrator, and nothing else
changes.

You will need these from your IT department:

| Field | What to enter |
| --- | --- |
| Mail server | Your institution's SMTP server, for example `smtp.your-university.edu`. |
| Port | 587 for STARTTLS, 465 for TLS. |
| Encryption | STARTTLS suits most institutional servers. |
| Username and password | Leave blank if your server does not require sign-in. |
| From address | Institutions usually require an address they host. |
| From name | Shown beside the address in the recipient's inbox. |

The password is write-only: it is encrypted before it is stored and never shown again. Saving
without retyping it keeps the stored one. Use **Remove saved password** to clear it.

:::tip Send a test message
Use **Send a test message** as soon as you save. It sends using the stored settings, so it proves
what the site will actually do. Finding out that mail is misconfigured now is much better than
finding out when a student cannot get back into their account.
:::

Once email works, a **Forgot your password?** link appears on the sign-in page. People can then
recover their own accounts: they receive a link that works once and expires in an hour, and using
it signs them out everywhere else. Until email is configured that link is not shown, because it
would lead to a page that could only apologise.

The encryption that protects the stored password uses a key held on the server rather than in the
database, so a copy of the database alone cannot reveal it. See
[Backups and recovery](../operations/backups.md) for what that means when restoring onto a
different machine.

## Sign-in

The **Sign-in** tab lets people use their institution's account instead of an AFCT password. It
is off until you configure a provider and turn it on, and **AFCT passwords keep working either
way**, so a misconfigured provider cannot lock you out of your own site.

Your IT department gives you the issuer URL, a client ID and a client secret, and needs the
redirect URL shown on the tab. Registration usually fails without that URL, with an error about
a mismatched redirect.

### Matching people to existing accounts

When somebody signs in for the first time, AFCT attaches their institutional identity to an
existing account with the same email address, but only when the provider states that the address
is verified.

:::warning Trusting a provider's email addresses
Some providers, Microsoft Entra among them, never mark addresses as verified, so nobody at those
institutions is matched automatically. **Trust this provider's email addresses** overrides that.

Only turn it on if your provider controls the addresses it reports. At a provider where people
can choose their own address, it would let someone reach an account that is not theirs.
Administrator accounts are never matched automatically either way: an administrator connects
their institutional login deliberately, from their own account page.

**On Entra, this setting is only half of it.** It answers a provider that does not say an address
is verified. It cannot help when there is no address at all, and Entra does not always send one:
for people inside the tenant, the `email` claim has to be released, either as an optional claim on
the app registration or through the OpenID scope on v2.0 endpoints. If your people are refused with
"your institution did not share an email address", that claim is what is missing, and no AFCT
setting can substitute for it. AFCT will not fall back to a username instead: Microsoft's own
guidance is that those are neither durable nor guaranteed to be real addresses.
:::

## LTI

The **LTI** tab is where you register the LMSs allowed to open AFCT, so students can reach their
assignments from Canvas, D2L Brightspace or Blackboard without signing in again, and grades can
go back to the LMS gradebook.

Registration is mutual: the tab lists the values your LMS needs from AFCT, and the form takes the
values it gives back. See [Connecting an LMS](lms-connection.md) for the whole procedure, the
values by their LMS names, and what the launch errors mean.

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

While an upgrade runs, the tab shows a step checklist and a **Live progress** panel that streams what the server is doing as it happens (downloading the new image, recreating the containers), so a long download shows real activity. It updates on its own; there is no need to refresh the page.

The update service (the component that performs upgrades) is versioned alongside the application but is recreated separately, so it can briefly lag after an upgrade. When it does, the tab shows an **Update the update service** action that brings it up to date, so this no longer requires the server console.

Restoring a previous version also restores its database backup.

:::danger
Restoring permanently discards submissions, grades, accounts, and other database records created since that backup. Uploaded files remain but can become unreferenced.
:::

Read [Update AFCT](../operations/updates.md) and confirm that you accept the result before restoring an older version.
