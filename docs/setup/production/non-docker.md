# Non-Docker production setup

A non-Docker production deployment is not officially supported.

Without Docker, the deployment administrator must install, configure, secure, and maintain:

- Node.js
- Java
- PostgreSQL
- nginx or another reverse proxy
- TLS certificates
- Process supervision
- Database migrations
- Startup ordering
- Automated backups
- Uploaded-file storage
- Log management

The host must also provide every value normally stored in `.env.production`.

A basic application startup resembles:

```bash
npm install
npm run build
npm run db:generate
npm run db:deploy
npm start
```

Minimum versions are:

- Node.js 22 or later
- PostgreSQL 15 or later
- Java 21 or later

`npm run db:deploy` applies committed migrations without interactive prompts.

This outline is not a complete server configuration. For production use, prefer the supported [Docker deployment](../production.md).
