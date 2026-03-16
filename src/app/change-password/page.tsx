import React from 'react';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ForcedPasswordChangeForm } from '@/components/auth/ForcedPasswordChangeForm';

export default async function ChangePasswordPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  if (!session.user.mustChangePassword) {
    redirect('/dashboard');
  }

  return <ForcedPasswordChangeForm />;
}
