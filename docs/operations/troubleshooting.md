# Production troubleshooting

Start by identifying the failing layer:

- nginx: The site does not load, HTTPS fails, or requests do not reach AFCT
- AFCT application: Pages, authentication, or API requests fail
- PostgreSQL: The application reports database or migration errors
- Backup service: Scheduled or on-demand backups fail

## Start with the built-in checks

On Linux or macOS, the installer runs a read-only system and configuration check that is the fastest way to triage a deployment:

```bash
sh install.sh doctor
```

It reports on the Compose file, `.env.production` completeness and permissions, disk space, clock sync, Docker reachability, Compose validity, container health, and the local HTTP health endpoint. `sh install.sh status` and `sh install.sh logs` give a quick health snapshot and a live log tail.

## Check service status

```bash
docker compose ps
```

All four services should be `Up`, and the application should eventually report `healthy`.

Common states:

- `Exited`: The service stopped
- `Restarting`: The service is repeatedly crashing
- `Unhealthy`: The service is running, but its health check is failing

## Read logs

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
docker compose logs --tail=200 postgres
docker compose logs --tail=200 db-backup
```

Use `docker compose ps` to confirm the service names in the current Compose file.

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

After changing `.env.production`, apply the configuration:

```bash
docker compose up -d
```

On Linux or macOS, `sh install.sh restart` recreates the stack and verifies health after a configuration change.

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
sh install.sh diagnostics
```

Windows PowerShell:

```powershell
.\install.ps1 diagnostics
```

The archive contains installer logs, service status, service logs, and redacted configuration information. Review it before sharing it.

## Certificate warnings

See [TLS and HTTPS](tls.md) for expected self-signed warnings and trusted-certificate problems.
