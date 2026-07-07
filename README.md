# AFCT Dashboard

A modern Next.js 15 dashboard for the Automated Feedback for CS Theory (AFCT) system.  
Built with:

![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-blue?logo=prisma)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwindcss&logoColor=white)
![Auth.js](https://img.shields.io/badge/Auth.js-NextAuth%20v5-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)
[![Publish Docker image to GHCR](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/actions/workflows/publish-ghcr.yml/badge.svg?branch=main)](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/actions/workflows/publish-ghcr.yml)

## Table of Contents

- [Tech Stack](#tech-stack)
- [Funding Acknowledgement](#funding-acknowledgement)
- [Production Deployment](#production-deployment)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [API Documentation](#api-documentation)
- [Contributors](#contributors)

## 📚 Tech Stack

- Node.js 20+
- Next.js 15
- PostgreSQL + Prisma
- Auth.js / NextAuth v5
- Tailwind CSS
- Docker + GHCR

## Funding Acknowledgement

This project was supported by grant funding.

[Add more here ]

## 🏭 Production Deployment

Production deployments pull the GHCR image and run via Docker Compose with Nginx reverse proxy.

See the full guide in: [docs/production_setup.md](docs/production_setup.md).

## 🧰 Development Setup

A full set of development instructions can be found in the development setup guide: [docs/development_setup.md](docs/development_setup.md).

## ✅ Testing

Run all tests:

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

## 📖 API Documentation

An interactive reference for the HTTP API, auto-generated from the route handlers and published on each push to `main`:

- **[API reference](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/)** — browsable docs for every endpoint (auth, parameters, request/response shapes).
- **[OpenAPI spec](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/openapi.json)** — the raw `openapi.json`, for importing into Postman/Insomnia or generating clients.

Regenerate locally with `npm run docs`.

---

## 👥 Contributors

| Name                | Affiliation | Email            | GitHub                                        |
| ------------------- | ----------- | ---------------- | --------------------------------------------- |
| Jesse Burdick-Pless | RIT         | -                | [jb4411](https://github.com/jb4411)           |
| Jeffrey Chiampi     | PSU         | jdc308@psu.edu   | [jdc308](https://github.com/jdc308)           |
| Edwin Kismal        | PSU         | etk5176@psu.edu  | [EdwinKimsal](https://github.com/EdwinKimsal) |
| Adam Manowski       | PSU         | ajm9738@psu.edu  | [astermaxed](https://github.com/astermaxed)     |
| Andrew Sutton       | PSU         | ams12165@psu.edu | [asutton24](https://github.com/asutton24)     |
