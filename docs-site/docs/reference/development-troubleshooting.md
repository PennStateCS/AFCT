# Development troubleshooting

Use this page with the Docker development stack.

## Start with service status and logs

```bash
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs --tail=200
```

Every expected service should be `Up`. A service marked `Exited` stopped. A service marked `Restarting` is crash-looping.

Read the last error from the failing service before changing configuration.

## The application does not load

Confirm that ports 3000, 8080, and 8443 are not already in use.

Read nginx logs:

```bash
docker compose -f docker-compose.dev.yml logs -f nginx
```

A `502` response means nginx is running but the application is not responding. Read the application logs next.

## PostgreSQL is not ready

Read the database log:

```bash
docker logs afct-dev-postgres
```

Check readiness:

```bash
docker exec -it afct-dev-postgres pg_isready -U afct_user
```

A healthy database reports `accepting connections`.

A new volume may need a short initialization period. Persistent failures usually appear in the PostgreSQL log and often cause Prisma connection errors in the application log.

## Sign-in fails or redirects repeatedly

Confirm the values inside the application container:

```bash
docker exec -it afct-dev sh -lc 'echo $NEXTAUTH_URL'
docker exec -it afct-dev sh -lc 'test -n "$NEXTAUTH_SECRET" && echo set || echo missing'
docker logs afct-dev --tail=100
```

Do not print the authentication secret itself.

When either value is missing, fix `.env.development` and recreate the containers.

`NEXTAUTH_URL` must match the address being used for the current test.

## Uploads fail

Check the upload directories inside the application container:

```bash
docker exec -it afct-dev sh -lc 'ls -ld /private/uploads /app/public/uploads'
```

Both directories must exist and be writable by the application user.

## Module not found after adding a package

The `afct-dev-node-modules` named volume can keep an older dependency set even after an image rebuild.

### Update the existing volume

```bash
docker exec afct-dev npm install
docker exec afct-dev sh -lc 'rm -rf .next/cache'
docker restart afct-dev
```

### Recreate only the dependency volume

Stop the stack without removing all volumes:

```bash
npm run docker:dev:down
```

List volumes to confirm the exact name:

```bash
docker volume ls
```

Remove the `afct-dev-node-modules` volume, then restart:

```bash
docker volume rm afct_afct-dev-node-modules
npm run docker:dev
```

The Compose project prefix may differ. Use the name shown by `docker volume ls`.

Do not use `docker:dev:down:volumes` or `docker:dev:nuke` for this repair unless you also intend to remove the database and uploads.

## Submissions stay `PENDING`

A submission that never leaves `PENDING` means the grading worker is not claiming it.

The worker runs as its **own container**, separate from the web app: `afct-dev-worker` in development (`afct-worker` in production). It starts once with that container. Confirm it is running and has started:

```bash
docker logs afct-dev-worker | grep SubmissionWorker
```

`[SubmissionWorker] Started safely` means the worker is up. If the worker is running but a submission stays `PENDING`, read its logs for an evaluator error, and confirm the evaluator JAR and Java are present in the container. If the container is not running, start it with `docker compose -f docker-compose.dev.yml up -d worker`.

## Migration problems after switching branches

A branch may expect a schema that does not match the current development database.

Read the migration error first. When local data is disposable, reset the development database with the repository command intended for that purpose. When the data matters, create a backup before applying or repairing migrations.

Do not manually edit the Prisma migration history table unless the team has agreed on the recovery plan.
