import React from 'react';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ForcedPasswordChangeForm } from '@/components/auth/ForcedPasswordChangeForm';

export default async function ChangePasswordPage() {
  const session = await auth();

  // An idle-expired or disabled session comes back marked inactive; send it to
  // login rather than letting it fall through to the /dashboard bounce.
  if (!session?.user || session.user.inactive) {
    redirect('/login');
  }

  if (!session.user.mustChangePassword) {
    redirect('/dashboard');
  }

  return <ForcedPasswordChangeForm />;
}
