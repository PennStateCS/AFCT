import { NextResponse } from 'next/server';
import { getOidcConfig } from '@/lib/oidc-provider';
import { DEFAULT_OIDC_BUTTON_LABEL } from '@/schemas/identity';

/**
 * What sign-in methods this server offers, for the desktop client's login window.
 * Unauthenticated on purpose: the client asks before anyone has signed in.
 *
 * Only what the login page already shows publicly is exposed: whether institutional
 * sign-in exists and the button label. Never the issuer, client id or secret. Password
 * login is not reported because there is no setting behind it; it is always available.
 *
 * A provider that is enabled but broken (say the secret cannot be decrypted) reports
 * as no provider, which matches the login page: if the web cannot offer the button,
 * the client should not either.
 * @openapi
 * summary: Sign-in methods this server offers
 * responses:
 *   200:
 *     description: The available sign-in methods.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             oidc:
 *               type: object
 *               properties:
 *                 enabled: { type: boolean }
 *                 buttonLabel: { type: string, nullable: true, description: "Label for the institutional sign-in button; null when disabled" }
 */
export async function GET() {
  const oidc = await getOidcConfig();
  return NextResponse.json({
    oidc: {
      enabled: oidc !== null,
      buttonLabel: oidc ? (oidc.buttonLabel ?? DEFAULT_OIDC_BUTTON_LABEL) : null,
    },
  });
}
