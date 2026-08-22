'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Link2, Terminal, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TabBar } from '@/components/course/course-tabs';
import { ProfileSection } from '@/components/account/ProfileSection';
import { PasswordSection } from '@/components/account/PasswordSection';
import { TokensSection } from '@/components/account/TokensSection';
import { IdentitiesSection } from '@/components/account/IdentitiesSection';
import { useChangePassword } from '@/hooks/use-change-password';
import type { SessionUser } from '@/types/next-auth';

export const ACCOUNT_TABS = ['profile', 'password', 'accounts', 'tokens'] as const;
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
export default function AccountClient({
  user,
  oidcLabel,
  oidcAvailable,
}: {
  user: ProfileUser;
  /** What the institution's sign-in is called, when one is configured. */
  oidcLabel: string | null;
  /** Whether institutional sign-in is switched on at all. The tab does not exist otherwise. */
  oidcAvailable: boolean;
}) {
  const changePassword = useChangePassword();
  const [tab, setTab] = useState<string>('profile');

  // Remember the last tab, the way System Settings does, so returning after a save lands where
  // you were rather than back at the top.
  useEffect(() => {
    // Coming back from the provider lands here with a result on the URL, so that wins over the
    // remembered tab: the answer to what you just did should be the thing you are looking at.
    const params = new URLSearchParams(window.location.search);
    const asked = params.get('tab');
    if (asked && (ACCOUNT_TABS as readonly string[]).includes(asked)) {
      setTab(asked);
      return;
    }
    if (params.has('linked') || params.has('error')) {
      setTab('accounts');
      return;
    }

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
    // Only when an administrator has set institutional sign-in up. An install using local
    // accounts alone should not carry a tab whose every answer is "not available".
    /**
     * Always offered. The tab used to appear only while institutional sign-in was configured,
     * so turning the provider off hid identities that still existed and still worked: somebody
     * could neither see what was attached to their account nor remove it. What the provider
     * being unavailable changes is whether a *new* one can be connected, which is decided
     * inside the tab.
     */
    { value: 'accounts', label: 'Connected accounts', Icon: Link2 },
    { value: 'tokens', label: 'App tokens', Icon: Terminal },
  ];

  return (
    <Card className="p-4">
      <CardHeader className="pb-2">
        <CardTitle role="heading" aria-level={1} className="text-2xl tracking-tight">
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
            // Only three or four sections here. Spreading them across the card reads as a
            // layout accident rather than a choice.
            fill={false}
            tabs={tabs}
          />

          <TabsContent value="profile">
            <ProfileSection user={user} />
          </TabsContent>

          <TabsContent value="password">
            <PasswordSection onChangePassword={changePassword} />
          </TabsContent>

          <TabsContent value="accounts">
            <IdentitiesSection providerLabel={oidcLabel} canConnect={oidcAvailable} />
          </TabsContent>

          <TabsContent value="tokens">
            <TokensSection />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
