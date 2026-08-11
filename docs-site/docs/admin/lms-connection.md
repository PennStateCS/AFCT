# Connecting an LMS

AFCT can be opened from Canvas, D2L Brightspace, Blackboard, or any other LMS that supports **LTI 1.3**. Once a course is connected, students reach their assignments without a separate AFCT sign-in, grades go back to the LMS gradebook, and the AFCT roster can be brought in line with the LMS roster.

AFCT sits alongside your LMS; it does not replace it. Your LMS stays the system of record for a final grade.

Registering an LMS is an administrator task and only has to be done once per LMS. After that, faculty connect their own courses themselves by opening AFCT from the LMS. See [Grades and rosters from your LMS](../faculty/lms.md) for their side of it.

## Before you start

You need:

- **Administrator access to AFCT**, and access to your LMS with permission to create a developer key or LTI registration. At most institutions the second one belongs to central IT rather than to you, so expect to send them the values in the next section and wait.
- **AFCT reachable over HTTPS at its real address.** The LMS calls AFCT directly, so `localhost` or a self-signed certificate will not work. Check that **Configured URL** on [System Settings](system-settings.md) is the address people actually use.

## Register the LMS

Registration is mutual: your LMS needs four values from AFCT, and AFCT needs six back. Doing it means going back and forth between two screens, so collect one set before starting the other.

1. In AFCT, go to **System Settings** and open the **LTI** tab.
2. Copy the four values under **Give these to your LMS**:

   | Value | What your LMS calls it |
   | --- | --- |
   | **Target link URI** | Target Link URI, or Launch URL |
   | **Login initiation URL** | OpenID Connect Initiation URL, or Login URL |
   | **Redirection URI** | Redirect URI, or Redirection URI |
   | **Public keyset URL** | Public JWK URL, or Keyset URL |

   These are built from your configured URL, so if that is wrong, every one of them is wrong.

3. In your LMS, create a developer key or LTI registration for AFCT using those values. Choose **public key type: keyset URL** rather than pasting a key, so a future key rotation in AFCT does not break the connection.
4. Your LMS gives you its own values back. Return to the **LTI** tab, select **Add an LMS**, and fill in:

   | Field | What your LMS calls it |
   | --- | --- |
   | **Name** | Anything you like. It is only a label, so use something like "Penn State Canvas". |
   | **Platform issuer** | Issuer, or Platform ID |
   | **Client ID** | Client ID |
   | **Deployment ID** | Deployment ID |
   | **Authorization URL** | OIDC Authorization Endpoint, or Authorization Redirect URL |
   | **Token URL** | Token Endpoint, or OAuth2 Token URL |
   | **Public keyset URL** | Public Keyset URL, or JWKS URL |

5. Select **Register**.

AFCT identifies an LMS by the combination of **issuer, client ID and deployment ID**. Registering the same three twice is refused. If your LMS issues a separate deployment ID per sub-account or per course, register each one.

## Check that it works

Ask someone with a course in the LMS to add an AFCT link and open it. On a first launch AFCT asks them which of their AFCT courses this LMS course is, and they choose it once.

If a launch fails, open [System Logs](system-logs.md) and filter for `LTI_LAUNCH_DENIED`. The entry says why it was refused and which issuer the LMS claimed, which is what you compare against the registration. The common causes:

| Reason in the log | What to fix |
| --- | --- |
| `unregistered-platform` | No registration matches the issuer and client ID the LMS sent. The entry records the claimed issuer next to the reason; compare it with what you registered. |
| `deployment-mismatch` | The issuer and client ID matched, but the deployment ID did not. If your LMS issues one per sub-account, register that one too. |
| `bad-signature` | AFCT could not verify the launch against the LMS keyset. Usually the public keyset URL is wrong or unreachable from the server. |
| `replayed` | The same launch was presented twice. Opening a cached page again can do this; try a fresh launch. |
| `expired` | The launch took too long to arrive. Check that the clocks on both servers are right. |
| `no-email` | The LMS did not send an email address. AFCT needs one to create or match an account, so release it in the LMS privacy settings for the key. |
| `malformed` or `wrong-message-type` | The request was not a launch AFCT understands. Check that the link points at the target link URI above. |

## What faculty can do once it is connected

- **Send grades to the LMS gradebook**, automatically as they are awarded or on demand.
- **Bring the AFCT roster in line with the LMS roster**, adding students and marking leavers dropped.
- **Add a link straight to one AFCT assignment** from the LMS, if the LMS supports deep linking.

All three are described in [Grades and rosters from your LMS](../faculty/lms.md).

## Accounts created by a launch

When somebody opens AFCT from the LMS and has no AFCT account, one is created for them, and their LMS identity is attached to it so later launches find the same account. If an account with that email address already exists, the launch attaches to it rather than making a second one.

You can see what is attached to any account from [User Accounts](user-accounts.md): open the account's menu and choose **Sign-in Methods**. This is also where you detach one, for example when somebody's LMS identity has changed. An account with no AFCT password and only one connected sign-in method cannot have it detached, because that would leave the person unable to sign in at all; give them a password first.

## Removing a registration

Removing an LMS from the **LTI** tab stops every launch from it immediately, for every course. Existing AFCT accounts, courses, submissions and grades are untouched, but people who signed in only through that LMS will not be able to get in until they have another way to sign in.

To disconnect a single course instead, leave the registration alone; faculty can disconnect their own course from the **Course status** card on the course **Settings** tab.
