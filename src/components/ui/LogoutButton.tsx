'use client';

import { safeSignOut } from '@/lib/safe-signout';

export function LogoutButton() {
  return (
    <button
      onClick={() => void safeSignOut({ callbackUrl: '/' })}
      className="mt-4 rounded bg-red-600 px-4 py-2 text-white"
    >
      Sign Out
    </button>
  );
}
