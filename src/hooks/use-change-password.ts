import { useSession } from 'next-auth/react';
import { apiPaths } from '@/lib/api-paths';

/**
 * Shared password-change action for the account menus (navbar + sidebar). POSTs the old and
 * new password to the me/password API and, on success, refreshes the NextAuth session so the
 * JWT reflects the new password timestamp. Without that refresh the token still snapshots the
 * old password and the session callback revokes it on the next request, signing the user out
 * right after they change it.
 *
 * Throws an Error with a user-facing message on failure. Toasts are owned by
 * ChangePasswordDialog, so this hook never toasts. Passwords are never logged.
 */
export function useChangePassword() {
  const { update } = useSession();

  return async function changePassword(
    /**
     * Null when the account has no password yet, which is the one case the endpoint accepts
     * without one. Sent as an absent field rather than an empty string: the server decides
     * which mode it is in from the account, and an empty string would just fail validation.
     */
    oldPassword: string | null,
    newPassword: string,
  ): Promise<void> {
    const res = await fetch(apiPaths.myPassword(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(oldPassword === null ? { newPassword } : { oldPassword, newPassword }),
    });

    if (!res.ok) {
      let message = 'Failed to save your password';
      // The error body is usually JSON ({ error }), but tolerate a non-JSON response
      // (e.g. an HTML error page) instead of throwing an unhelpful parse error.
      try {
        const data = (await res.json()) as { error?: unknown };
        if (typeof data?.error === 'string' && data.error) message = data.error;
      } catch {
        // keep the generic message
      }
      throw new Error(message);
    }

    await update({ refreshCredentials: true });
  };
}
