'use client';

import { useEffect, useState } from 'react';
import { KeyRound, UserRound } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileSection } from '@/components/account/ProfileSection';
import { PasswordSection } from '@/components/account/PasswordSection';
import { useChangePassword } from '@/hooks/use-change-password';
import type { SessionUser } from '@/types/next-auth';

export const ACCOUNT_TABS = ['profile', 'password'] as const;
const TAB_KEY = 'afct.accountTab';

type ProfileUser = SessionUser & { cropX?: number; cropY?: number; zoom?: number };

/**
 * Your own account: profile, password, and later the identities you sign in with and the tokens
 * the desktop client uses.
 *
 * These were two dialogs off the user menu. They became a page because a token list needs a
 * table with labels, last-used dates and a revoke action, and that does not belong in a dialog.
 * Tabbed rather than one long page, matching System Settings and the course pages, so there is
 * nothing new to learn.
 */
export default function AccountClient({ user }: { user: ProfileUser }) {
  const changePassword = useChangePassword();
  const [tab, setTab] = useState<string>('profile');

  // Remember the last tab, the way System Settings does, so returning after a save lands where
  // you were rather than back at the top.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      if (saved && (ACCOUNT_TABS as readonly string[]).includes(saved)) setTab(saved);
    } catch {
      // Private browsing or a blocked store: the default tab is a fine outcome.
    }
  }, []);

  const onTabChange = (next: string) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // Not remembering the tab is not worth failing over.
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-muted-foreground text-sm">
          Your profile and how you sign in. Only you can see this page.
        </p>
      </div>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="profile">
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="password">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Password
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="pt-4">
          <ProfileSection user={user} />
        </TabsContent>

        <TabsContent value="password" className="pt-4">
          <PasswordSection onChangePassword={changePassword} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
