'use client';

import { safeSignOut } from '@/lib/safe-signout';

export function LogoutButton() {
  return (
    <button
      onClick={() => void safeSignOut({ callbackUrl: '/' })}
      className="mt-4 px-4 py-2 bg-red-600 text-white rounded"
    >
      Sign Out
    </button>
  );
}
