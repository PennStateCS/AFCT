import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'AFCT Dashboard - Login',
};

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (session) {
    redirect('/dashboard');
  }

  return (
    <main
      role="main"
      aria-label="Login page"
      className="bg-background text-foreground flex min-h-screen w-full items-center justify-center font-sans"
    >
      <section aria-label="Authentication panel" className="w-full">
        {children}
      </section>
    </main>
  );
}
