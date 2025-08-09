# 📚 AFCT Dashboard

This is a [Next.js](https://nextjs.org) application bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).  
It serves as the **AFCT Dashboard** — a role-based course management platform for faculty, TAs, and students.

---

## 🚀 Getting Started

### 1️⃣ Install dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

### 2️⃣ Start the development server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Your app will be running at **[http://localhost:3000](http://localhost:3000)**.

---

## 🛠 Development Notes

- The main entry point for the UI is `app/page.tsx`.
- Pages auto-refresh when you save changes.
- This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to optimize and load [Geist](https://vercel.com/font) fonts.
- **Backend integration** is done via API routes in `src/app/api/`, using **Prisma** as the ORM.

---

## 📖 Learn More

- [Next.js Documentation](https://nextjs.org/docs) – official framework docs.
- [Learn Next.js](https://nextjs.org/learn) – interactive tutorials.
- [Prisma Documentation](https://www.prisma.io/docs) – database access and schema management.

---

## 📂 Project Structure

```
src/
  app/            # Next.js app router
    api/          # API routes (server-side)
    dashboard/    # Dashboard pages
  components/     # Reusable UI components
  lib/            # Helpers and utilities
  prisma/         # Prisma schema and migrations
```

---

## 👥 Roles & Access

- **Admin** – Full system control
- **Faculty** – Manage courses and assignments
- **TA** – Assist faculty, manage problems, view submissions
- **Student** – Access courses, submit assignments

---

## 🧑‍💻 Local Development with Database

1. Ensure you have SQLite or your configured database running.
2. Run migrations:
   ```bash
   npx prisma migrate dev
   ```
3. Seed initial data:
   ```bash
   npx prisma db seed
   ```
