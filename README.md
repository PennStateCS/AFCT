# 📚 AFCT Dashboard

This is a [Next.js](https://nextjs.org) application bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).  
It serves as the **AFCT Dashboard** — a role-based course management platform for faculty, TAs, and students.

---

## 🚀 Getting Started

### 1️⃣ Install node.js

1. Go to the download page for node.js: https://nodejs.org/en/download
2. Scroll down to get a prebuilt Node.js
3. Select your operating system with the appropriate architecture
4. Click on one of the green boxes labled `[operating system] Installer` or `Standalone Binary`
5. Open installer or unzip files

### 2️⃣ Install dependencies

Run one of the following commands in the terminal for this repository (npm is recommended)

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

<br>

_Possible Error:_

If you recieve the following error:

```
ps1 cannot be loaded because running scripts is disabled on this system. For more informationm see about_Execution_Policies at http://go.microsoft.com/fwlink/?LinkID=135170.
```

Run the following in your terminal:

```
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Unrestricted
```

### 3️⃣ Start the development server

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

<br>

_Possible Error:_

If the following is shown when accessing **[http://localhost:3000](http://localhost:3000)**:

```
@prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.
```

Try `npx prisma generate` and then start the development server

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

### Initial Database Setup

1. **Generate Prisma Client** (required for first setup):

   ```bash
   npx prisma generate
   ```

2. **Apply database migrations**:

   ```bash
   npx prisma migrate dev
   ```

3. **Seed the database with sample data**:
   ```bash
   npm run seed
   # or alternatively
   npx prisma db seed
   ```

### Database Management Commands

**Reset Database & Reseed** (useful during development):

```bash
npx prisma migrate reset
```

This will:

- Drop the database
- Recreate it
- Apply all migrations
- Run the seed script automatically

**Manual Seeding** (if you want to add sample data without reset):

```bash
npm run seed
```

**View Database in Browser** (Prisma Studio):

```bash
npx prisma studio
```

This opens a web interface at `http://localhost:5555` where you can:

- Browse all database tables and records
- Edit data directly in the browser
- View relationships between tables
- Execute queries and filters
- Export data in various formats

**Prisma Studio Tips**:

- Use filters to find specific users, courses, or assignments
- Click on related records to navigate relationships
- Perfect for debugging database issues during development
- Safe to use alongside your running Next.js app

### Sample Data Included

The seed file creates:

- **1 Admin user**
- **3 Faculty users**
- **2 TA users**
- **26 Student users**
- **2 Sample courses**
- **Problems and assignments**
- **Course roster memberships**

**Default password for all users**: `password123`

### Database Troubleshooting

**If you encounter Prisma client errors**:

```bash
npx prisma generate
npm run dev
```

**If migrations are out of sync**:

```bash
npx prisma migrate reset
# This will reset and reseed automatically
```

**If you need to start fresh**:

```bash
# Delete the database file (SQLite)
rm prisma/dev.db
# Run migrations and seed
npx prisma migrate dev
npm run seed
```

---
