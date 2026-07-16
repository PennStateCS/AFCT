---
slug: /
---

# AFCT Dashboard

AFCT (Automated Feedback for CS Theory) is a course dashboard for automata and
formal-language coursework. Students submit finite automata, push-down automata,
context-free grammars, and regular expressions built in JFLAP; the dashboard
evaluates them automatically and gives immediate feedback, while faculty manage
courses, assignments, and grades.

## Where to start

- **Students**: the [Student Guide](guides/student.md) covers enrolling in a
  course, submitting solutions, and reading your feedback and grades.
- **Faculty and TAs**: the [Faculty Guide](guides/faculty.md) covers building
  courses and assignments, grading, and managing your roster.
- **Administrators**: the [Administrator Guide](guides/admin.md) covers user
  management, system settings, backups, and updates.

## Running your own AFCT

AFCT is self-hosted with Docker. Start with the
[production setup overview](setup/production.md), then follow the guide for
your platform: [Linux](setup/production/linux.md),
[macOS](setup/production/macos.md), or [Windows](setup/production/windows.md).

Once deployed, see [updates](operations/updates.md),
[backups](operations/backups.md), [TLS](operations/tls.md), and
[troubleshooting](operations/troubleshooting.md).

## Integrating with AFCT

The HTTP API is documented in the
[API Reference](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/api/),
generated from the code on every release. The native submission client uses the
token-authenticated [client API](reference/client-api.md).
