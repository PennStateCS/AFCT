'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Terminal, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TabBar } from '@/components/course/course-tabs';
import { ProfileSection } from '@/components/account/ProfileSection';
import { PasswordSection } from '@/components/account/PasswordSection';
import { TokensSection } from '@/components/account/TokensSection';
import { useChangePassword } from '@/hooks/use-change-password';
import type { SessionUser } from '@/types/next-auth';

export const ACCOUNT_TABS = ['profile', 'password', 'tokens'] as const;
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

  // Same shape as System Settings and the course pages: one card, its title as the page
  // heading, tabs inside it. TabBar rather than a hand-rolled TabsList, because it is what
  // swaps the underline strip for a select below `md`; rolling our own left this page with no
  // usable tabs on a phone.
  const tabs = [
    { value: 'profile', label: 'Profile', Icon: UserRound },
    { value: 'password', label: 'Password', Icon: KeyRound },
    { value: 'tokens', label: 'App tokens', Icon: Terminal },
  ] as const;

  return (
    <Card className="p-4">
      <CardHeader className="pb-2">
        <CardTitle role="heading" aria-level={1} className="text-2xl">
          Account
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Your profile and how you sign in. Only you can see this page.
        </p>
      </CardHeader>

      <CardContent>
        <Tabs value={tab} onValueChange={onTabChange} className="w-full gap-6">
          <TabBar
            ariaLabel="Account sections"
            selectId="account-tab-select"
            value={tab}
            onValueChange={onTabChange}
            tabs={tabs}
          />

          <TabsContent value="profile">
            <ProfileSection user={user} />
          </TabsContent>

          <TabsContent value="password">
            <PasswordSection onChangePassword={changePassword} />
          </TabsContent>

          <TabsContent value="tokens">
            <TokensSection />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
