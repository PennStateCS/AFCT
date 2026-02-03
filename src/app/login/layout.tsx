import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (session) {
    redirect('/dashboard');
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen w-full items-center justify-center font-sans">
      <div className="w-full">{children}</div>
    </div>
  );
}
