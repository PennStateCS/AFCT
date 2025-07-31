'use client';

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="mt-4 px-4 py-2 bg-red-600 text-white rounded"
    >
      Sign Out
    </button>
  );
}