// src/lib/session-utils.ts

import { getSession } from 'next-auth/react';

/**
 * Refresh the current session to fetch latest user data from the database.
 * Useful after profile updates to ensure the UI reflects changes immediately.
 * 
 * This forces NextAuth React components to re-fetch session data.
 */
export async function refreshSession(): Promise<void> {
  try {
    // Force a session update by calling getSession which will trigger
    // the session callback and fetch fresh data from the database
    await getSession();
    
    // Trigger a window focus event to force useSession hooks to refresh
    window.dispatchEvent(new Event('focus'));
    
    // Also trigger a storage event to ensure session updates propagate
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'nextauth.message',
      newValue: JSON.stringify({
        event: 'session',
        data: { trigger: 'getSession' }
      })
    }));
    
  } catch (error) {
    console.warn('Failed to refresh session:', error);
  }
}
