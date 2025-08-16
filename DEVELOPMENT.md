# 🛠️ AFCT Dashboard Development Guide

A comprehensive guide for developers working on the AFCT Dashboard project.

## 🏗️ Architecture Overview

### Technology Stack

- **Frontend**: Next.js 15 with TypeScript
- **Backend**: Next.js API Routes
- **Database**: Prisma ORM (SQLite for dev, PostgreSQL for prod)
- **UI**: Tailwind CSS + shadcn/ui components
- **Authentication**: JWT-based auth system

### Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # Backend API routes
│   ├── dashboard/         # Protected dashboard pages
│   └── login/            # Authentication pages
├── components/            # Reusable UI components
├── hooks/                # Custom React hooks
├── lib/                  # Utilities and configurations
├── schemas/              # Validation schemas
└── types/                # TypeScript definitions
```

## 🚀 Getting Started

### Easy Setup with Setup Wizard (Recommended)

**Perfect for beginners!** Use our automated setup wizard:

```bash
# Make the wizard executable
chmod +x scripts/setup-wizard.sh

# Run the setup wizard and choose "Complete Development Setup"
./scripts/setup-wizard.sh
```

The wizard will automatically:
- ✅ Install Node.js and dependencies
- ✅ Set up SQLite database
- ✅ Configure environment files
- ✅ Run migrations and seed data
- ✅ Validate everything is working

### Manual Setup (Advanced)

```bash
git clone <repository>
cd afct
npm install
cp .env.example .env.local
npx prisma generate
npx prisma migrate dev
npm run seed
npm run dev
```

### Development Workflow

1. Create feature branch from `main`
2. Make changes and test locally
3. Run linting and type checking
4. Commit with descriptive messages
5. Create pull request

## 🗄️ Database Development

### Schema Management

- **Development**: Uses `prisma/schema.prisma` (SQLite)
- **Production**: Uses `prisma/schema.production.prisma` (PostgreSQL)

### PostgreSQL Setup for Testing

For testing with PostgreSQL during development:

```bash
# Quick PostgreSQL setup
sudo ./scripts/quick-postgresql-setup.sh

# Test database connection
./scripts/setup-wizard.sh  # Choose option 9: Test Database Connection

# Complete setup with all features
sudo ./scripts/setup-postgresql.sh
```

### Common Commands

```bash
# Create new migration
npx prisma migrate dev --name feature_name

# Reset database
npx prisma migrate reset

# View data
npx prisma studio

# Generate client after schema changes
npx prisma generate
```

### Schema Changes Workflow

1. Edit `prisma/schema.prisma`
2. Create migration: `npx prisma migrate dev --name change_description`
3. Update `prisma/schema.production.prisma` accordingly
4. Test with both SQLite and PostgreSQL
5. Update seed file if needed

## 🔧 API Development

### API Route Structure

```
src/app/api/
├── auth/                  # Authentication endpoints
├── comments/              # Comment management
├── courses/               # Course operations
├── problems/              # Problem management
├── submissions/           # Assignment submissions
└── users/                 # User management
```

### API Development Guidelines

#### 1. Route Handler Pattern

```typescript
// src/app/api/example/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma-config';

export async function GET(request: NextRequest) {
  try {
    // 1. Verify authentication
    const user = await verifyToken(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate permissions
    if (user.role !== 'FACULTY') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Process request
    const data = await prisma.model.findMany({
      where: { userId: user.id },
    });

    // 4. Return response
    return NextResponse.json(data);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

#### 2. Error Handling

```typescript
// Consistent error responses
const errorResponse = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

// Usage
if (!user) return errorResponse('Unauthorized', 401);
if (!data) return errorResponse('Not found', 404);
```

#### 3. Type Safety

```typescript
// Use Prisma generated types
import type { User, Course, Prisma } from '@prisma/client';

// Define API response types
type UserWithCourses = Prisma.UserGetPayload<{
  include: { courses: true };
}>;
```

## 🎨 Component Development

### Component Guidelines

#### 1. Component Structure

```typescript
// components/ExampleComponent.tsx
import { useState } from 'react';
import type { ComponentProps } from '@/types';

interface ExampleComponentProps {
  title: string;
  onAction?: () => void;
  className?: string;
}

export function ExampleComponent({
  title,
  onAction,
  className
}: ExampleComponentProps) {
  const [state, setState] = useState('');

  return (
    <div className={`component-base ${className}`}>
      <h2>{title}</h2>
      {/* Component content */}
    </div>
  );
}
```

#### 2. Using shadcn/ui Components

```typescript
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';

// Consistent UI patterns
<Button variant="default" size="sm" onClick={handleClick}>
  Action
</Button>
```

#### 3. Form Handling

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
});

type FormData = z.infer<typeof schema>;

export function ExampleForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema)
  });

  const onSubmit = async (data: FormData) => {
    // Handle form submission
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Form fields */}
    </form>
  );
}
```

## 🔐 Authentication & Authorization

### Role-Based Access Control

```typescript
// lib/auth.ts
export enum Role {
  ADMIN = 'ADMIN',
  FACULTY = 'FACULTY',
  TA = 'TA',
  STUDENT = 'STUDENT',
}

export function hasPermission(userRole: Role, requiredRole: Role): boolean {
  const hierarchy = {
    [Role.ADMIN]: 4,
    [Role.FACULTY]: 3,
    [Role.TA]: 2,
    [Role.STUDENT]: 1,
  };

  return hierarchy[userRole] >= hierarchy[requiredRole];
}
```

### Protected Routes

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  // Check authentication for protected routes
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    const user = await verifyToken(request);

    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}
```

## 🧪 Testing Guidelines

### Running Tests

```bash
# Lint code
npm run lint

# Type checking
npm run type-check

# Build test
npm run build
```

### Writing Tests

```typescript
// __tests__/api/users.test.ts
import { createMocks } from 'node-mocks-http';
import handler from '@/app/api/users/route';

describe('/api/users', () => {
  it('should return users for authenticated request', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        authorization: 'Bearer valid-token',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
  });
});
```

## 📝 Code Style Guidelines

### TypeScript Best Practices

```typescript
// Use explicit types for function parameters and returns
function processUser(user: User): Promise<ProcessedUser> {
  return processUserData(user);
}

// Use type assertions carefully
const element = document.getElementById('myId') as HTMLInputElement;

// Prefer interfaces for object shapes
interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}
```

### Naming Conventions

- **Files**: `kebab-case` for files, `PascalCase` for components
- **Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Types/Interfaces**: `PascalCase`
- **Database Models**: `PascalCase`

### Import Organization

```typescript
// 1. Node modules
import React from 'react';
import { NextRequest } from 'next/server';

// 2. Internal lib imports
import { prisma } from '@/lib/prisma-config';
import { verifyToken } from '@/lib/auth';

// 3. Component imports
import { Button } from '@/components/ui/button';
import { UserCard } from '@/components/UserCard';

// 4. Type imports (grouped at the end)
import type { User } from '@prisma/client';
import type { ApiResponse } from '@/types';
```

## 🔍 Debugging

### Common Issues and Solutions

#### Database Connection Issues

```bash
# Use the setup wizard database test
./scripts/setup-wizard.sh  # Choose option 9: Test Database Connection

# This test will check:
# - PostgreSQL service status
# - Port connectivity
# - Authentication
# - Prisma compatibility
# - Special character handling
```

#### Prisma Client Issues

```bash
# Regenerate client
npx prisma generate

# Check database connection (manual)
npx prisma db pull

# Switch between development and production schemas
cp prisma/schema.production.prisma prisma/schema.prisma  # For PostgreSQL
cp prisma/schema.sqlite.backup prisma/schema.prisma     # Back to SQLite
```

#### PostgreSQL Setup Issues

```bash
# Quick PostgreSQL setup
sudo ./scripts/quick-postgresql-setup.sh

# Complete PostgreSQL setup
sudo ./scripts/setup-postgresql.sh

# Test existing PostgreSQL connection
./scripts/setup-wizard.sh  # Choose option 9: Test Database Connection
```

#### Next.js Build Issues

```bash
# Clear cache
rm -rf .next

# Check for TypeScript errors
npx tsc --noEmit
```

#### Development Database Issues

```bash
# Reset development database
npx prisma migrate reset

# Check migration status
npx prisma migrate status
```

### Debugging Tools

- **Database**: Prisma Studio (`npx prisma studio`)
- **Network**: Browser DevTools Network tab
- **Server**: Console logs and Next.js debug output
- **Types**: TypeScript compiler (`npx tsc --noEmit`)

## 📦 Dependency Management

### Adding New Dependencies

```bash
# Production dependency
npm install package-name

# Development dependency
npm install -D package-name

# Update package.json scripts if needed
```

### Keeping Dependencies Updated

```bash
# Check for outdated packages
npm outdated

# Update packages
npm update

# For major version updates
npm install package-name@latest
```

## 🚀 Performance Optimization

### Database Optimization

```typescript
// Use selective includes
const user = await prisma.user.findUnique({
  where: { id },
  include: {
    courses: {
      select: { id: true, name: true },
    },
  },
});

// Use pagination
const users = await prisma.user.findMany({
  skip: (page - 1) * limit,
  take: limit,
});
```

### Next.js Performance

```typescript
// Use dynamic imports for large components
const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <div>Loading...</div>
});

// Optimize images
import Image from 'next/image';
<Image src="/image.jpg" alt="Description" width={400} height={300} />
```

## 🔧 Environment Configuration

### Development Environment

```env
# .env.local
DATABASE_URL="file:./dev.db"
JWT_SECRET="dev-secret-key"
NODE_ENV="development"
```

### Production Environment

```env
# .env.production
DATABASE_URL="postgresql://user:pass@host:port/db"
JWT_SECRET="production-secret-key"
NODE_ENV="production"
```

## 📋 Development Checklist

Before submitting a pull request:

- [ ] Code follows style guidelines
- [ ] TypeScript compilation passes
- [ ] ESLint passes with no errors
- [ ] Database migrations tested
- [ ] API endpoints tested manually
- [ ] Component renders correctly
- [ ] Authentication/authorization works
- [ ] Error handling implemented
- [ ] Documentation updated

## 🤝 Contributing Workflow

1. **Create Feature Branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Follow code style guidelines
   - Add tests for new functionality
   - Update documentation

3. **Test Changes**

   ```bash
   npm run lint
   npm run type-check
   npm run build
   ```

4. **Commit Changes**

   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## 📞 Getting Help

- **Documentation**: Check README.md and this guide
- **Issues**: Search existing GitHub issues
- **Code Review**: Ask for help in pull requests
- **Team Chat**: Contact development team

---

_This guide is living documentation. Update it as the project evolves._
