import type { ReactNode } from 'react';

/**
 * The registration page is shown inside the LMS's own dialog, so it borrows the card surface
 * rather than the app's page background.
 *
 * AFCT's page background is a light grey, which is right for a page with cards on it and wrong
 * for a panel sitting inside somebody else's white modal: it reads as a misaligned box rather
 * than as part of the dialog. The card token is white in light mode and the dark surface in
 * dark, so this follows the viewer's theme rather than pinning white.
 */
export default function LtiRegisterLayout({ children }: { children: ReactNode }) {
  return <div className="bg-card text-card-foreground min-h-screen w-full">{children}</div>;
}
