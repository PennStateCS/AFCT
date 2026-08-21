# Production troubleshooting

Start by identifying the failing layer:

- nginx: the site does not load, HTTPS fails, or requests do not reach AFCT
- AFCT application: pages, sign-in, or API requests fail
- Evaluator worker: submissions arrive but are never graded, or sit at Pending
- PostgreSQL: the application reports database or migration errors
- Backup service: scheduled or on-demand backups fail
- Optional updater: in-app updates do not start or finish

## Start with the built-in checks

On Linux and macOS, `afctctl` runs a read-only system and configuration check that is the fastest way to triage a deployment. It works from any directory:

```bash
sudo afctctl doctor
```

It reports on the Compose file, `.env.production` completeness and permissions, disk space, clock sync, Docker reachability, Compose validity, container health, and the local HTTP health endpoint.

For a lighter check, `sudo afctctl status` gives a quick health snapshot and `sudo afctctl logs` follows the application log.

If AFCT stops working after a configuration change, `sudo afctctl recover` restores the most recent protected copy of `.env.production`.

## Check service status

```bash
sudo afctctl status
```

Five services make up a normal deployment, and all of them should be `Up`:

| Service     | What it does                                            |
| ----------- | ------------------------------------------------------- |
| `nginx`     | Terminates HTTPS and passes requests to the application |
| `app`       | AFCT itself                                             |
| `worker`    | Grades submissions                                      |
| `postgres`  | The database                                            |
| `db-backup` | Takes the scheduled backups                             |

The application should eventually report `healthy`. When the updater is enabled, `afct-updater`
should be healthy too. `worker` has no health check, so `Up` is all you get for it: if it is up
and submissions still are not being graded, look at
[System Status, Workers tab](../admin/system-status.md).

Common states:

- `Exited`: The service stopped
- `Restarting`: The service is repeatedly crashing
- `Unhealthy`: The service is running, but its health check is failing

## Read logs

The short way, which needs no directory and no flags:

```bash
sudo afctctl logs
```

For anything more specific, Docker needs to be told where the stack is. On Linux that is:

```bash
docker compose -p afct \
  --env-file /opt/afct/shared/.env.production \
  -f /opt/afct/shared/runtime/docker-compose.yml logs --tail=200 worker
```

The commands below are written in the short `docker compose ...` form for readability. Every one
of them needs those three flags on a real install, or it will find nothing and print nothing.
On macOS the paths are under `$HOME/.afct` instead.

Application logs:

```bash
docker compose logs -f app
```

Recent logs from every service:

```bash
docker compose logs --tail=200
```

One service at a time:

```bash
docker compose logs --tail=200 nginx
docker compose logs --tail=200 worker
docker compose logs --tail=200 postgres
docker compose logs --tail=200 db-backup
docker compose logs --tail=200 updater
```



## The site does not load

Check these items in order:

1. DNS resolves to the correct host.
2. Ports 80 and 443 are open.
3. nginx is running.
4. nginx has no configuration or certificate error.
5. The AFCT application is healthy.
6. No other program is using port 80 or 443.

Linux:

```bash
sudo ss -ltnp | grep -E ':80|:443'
```

Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 80,443 -ErrorAction SilentlyContinue
```

macOS:

```bash
sudo lsof -nP -iTCP:80 -iTCP:443 -sTCP:LISTEN
```

## Login redirects repeatedly

Confirm that `NEXTAUTH_URL` exactly matches the browser address:

```text
NEXTAUTH_URL=https://afct.example.edu
```

Do not include a path. Do not use HTTP for a public HTTPS deployment.

After changing `.env.production`, apply it:

```bash
sudo afctctl restart
```

On Linux or macOS, `sudo afctctl restart` recreates the stack and verifies health after a configuration change.

## AFCT cannot connect to PostgreSQL

Confirm that:

- PostgreSQL is running
- `POSTGRES_PASSWORD` is set
- `DATABASE_URL` contains the same password
- The database hostname matches the Compose service name
- Special characters in the password are correctly encoded in the connection URL

Read both logs:

```bash
docker compose logs --tail=200 app
docker compose logs --tail=200 postgres
```

## Create a diagnostics archive

Linux or macOS:

```bash
sudo afctctl diagnostics
```

Windows PowerShell:

```powershell
.\install.ps1 diagnostics
```

The archive contains installer logs, service status, service logs, and redacted configuration information. Review it before sharing it.

## Certificate warnings

See [TLS certificates](../admin/system-settings.md#tls-certificate) for expected self-signed warnings and trusted-certificate problems.
