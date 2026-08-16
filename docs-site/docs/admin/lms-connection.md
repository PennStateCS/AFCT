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

## Set AFCT to open in a new tab

**AFCT has to open in its own tab rather than inside a panel on the LMS page.** Set this while you are creating the registration, because it is easier than explaining it to every member of faculty afterwards.

Where it lives depends on the LMS:

- **Canvas**: **Load In New Tab**, on the developer key's placements, and again on an individual link if somebody adds one by hand.
- **Brightspace** and **Blackboard**: an equivalent option on the link or the tool configuration, usually worded as opening in a new window.

The reason is that browsers no longer let a site keep somebody signed in while it is being displayed inside another site's page. Firefox and Safari have blocked it for some time and Chrome is going the same way, so a link that opens AFCT in a panel will show an empty box or a message about the page refusing to connect. It is a browser rule rather than an AFCT setting, and there is nothing to turn on in AFCT that changes it.

Faculty adding their own links need the same setting, which is covered in [Grades and rosters from your LMS](../faculty/lms.md).

## Check that it works

Ask someone with a course in the LMS to add an AFCT link and open it. On a first launch AFCT asks them which of their AFCT courses this LMS course is, and they choose it once.

If a launch fails, open [System Logs](system-logs.md) and filter for `LTI_LAUNCH_DENIED`. The entry says why it was refused and which issuer the LMS claimed, which is what you compare against the registration. The common causes:

| Reason in the log | What to fix |
| --- | --- |
| `unregistered-platform` | No registration matches the issuer and client ID the LMS sent. The entry records the claimed issuer next to the reason; compare it with what you registered. |
| `deployment-mismatch` | The issuer and client ID matched, but the deployment ID did not. If your LMS issues one per sub-account, register that one too. |
| `bad-signature` | AFCT could not verify the launch against the LMS keyset. Usually the public keyset URL is wrong or unreachable from the server. |
| `replayed` | The same launch was presented twice. Opening a cached page again can do this; try a fresh launch. |
| `expired` | Either the launch sat unopened for more than ten minutes, or the clocks on the two servers disagree. One person seeing it once is a slow sign-in and needs nothing. Everybody seeing it is a clock, so check the server time. |
| `no-email` | The LMS did not send an email address. AFCT needs one to create or match an account, so release it in the LMS privacy settings for the key. |
| `anonymous-launch` | The LMS opened AFCT without saying who the person is. Same fix as `no-email`: the key has to be allowed to share the user identity. |
| `deep-link-settings` | Somebody chose AFCT while adding content, but the LMS did not say where to send the answer or what it will accept. Check how the AFCT placement is configured. |
| `content-type-not-accepted` | AFCT was offered somewhere that does not take a link to an external tool, which is the only thing AFCT can add. Add it somewhere that does. |
| `malformed` or `wrong-message-type` | The request was not a launch AFCT understands. Check that the link points at the target link URI above. |

If the link shows an empty box or a message about the page refusing to connect, **and nothing appears in the log at all**, the launch is not reaching AFCT: the link is opening it inside the LMS page. Set it to open in a new tab, as above.

## What faculty can do once it is connected

- **Send grades to the LMS gradebook**, automatically as they are awarded or on demand.
- **Bring the AFCT roster in line with the LMS roster**, adding students and marking leavers dropped.
- **Add a link straight to one AFCT assignment** from the LMS, if the LMS supports deep linking.

All three are described in [Grades and rosters from your LMS](../faculty/lms.md).

## Accounts created by a launch

When somebody opens AFCT from the LMS and has no AFCT account, one is created for them, and their LMS identity is attached to it so later launches find the same account. If an account with that email address already exists, the launch attaches to it rather than making a second one.

You can see what is attached to any account from [User Accounts](user-accounts.md): open the account's menu and choose **Sign-in Methods**. This is also where you detach one, for example when somebody's LMS identity has changed. An account with no AFCT password and only one connected sign-in method cannot have it detached, because that would leave the person unable to sign in at all; give them a password first.

## Opening AFCT from your LMS as an administrator

An AFCT administrator account is never connected to an LMS automatically. The match would rest
on the email address your LMS reports, and AFCT cannot see how carefully that address was
checked. For a student a wrong match exposes one person's work; for an administrator it would
expose every student record in the system.

So the first time you open AFCT from your LMS with an administrator account, AFCT asks for your
AFCT password. That is the one thing your LMS cannot assert on your behalf, and anybody who
could supply it could already sign in as you, so nothing is weakened by accepting it. You are
asked once. After that, launches go straight through like anybody else's, and the connection can
be removed from your account page at any time.

Nothing about this applies to students or to faculty who are not administrators. Their accounts
connect on the first launch with no prompt.

## Removing a registration

Removing an LMS from the **LTI** tab stops every launch from it immediately, for every course. Existing AFCT accounts, courses, submissions and grades are untouched, but people who signed in only through that LMS will not be able to get in until they have another way to sign in.

To disconnect a single course instead, leave the registration alone; faculty can disconnect their own course from the **Course status** card on the course **Settings** tab.

## When a student has not opened AFCT from your LMS

A grade is addressed to the identifier your LMS uses for a person, and AFCT normally learns it
the first time that student opens AFCT from the LMS. Plenty of students never do: they work in
AFCT directly, and the grade falls due before they have ever clicked the link.

AFCT does not refuse in that case. When a grade has nowhere to go, it asks your LMS for the
course roster, matches the student by the email address the LMS vouches for, remembers the
answer, and sends the grade. It happens once per student; after that the grade goes straight
through. The match is recorded in the system log, because it decides where that student's
grades land.

It is deliberately strict. The match must be on an email, it must be unique, and the LMS must
still list the person as active in the course. If two people share an email, or the identifier
already belongs to another AFCT account, nothing is linked and the grade stays queued with the
reason shown, because a grade on the wrong student is worse than a grade that waits.

Two things stop it working, and both are worth checking if a grade will not send:

- **The registration has no roster permission.** AFCT needs the names and roles service to ask.
  It is requested when you create the developer key or registration; without it, AFCT can only
  place grades for students who have launched at least once.
- **The email in AFCT differs from the one in your LMS.** Nothing else is used to match, so a
  student with two addresses will not be found.

## Why your LMS can display AFCT inside a page

Deep linking, where you pick an AFCT assignment from inside your LMS, happens in a dialog your
LMS draws around AFCT. That only works if AFCT permits your LMS to embed it, and by default it
permits nobody at all.

Registering a platform is what grants that permission, and it grants it narrowly: only the
addresses you entered for the authorization, token and keyset URLs may embed AFCT, and only the
LTI pages themselves. The rest of AFCT can never be placed inside another site's page. Remove
the registration and the permission goes with it.

Two things follow. A registration with the wrong URLs will fail deep linking even when launches
work, because launches do not need embedding and deep linking does. And a change to a
registration takes up to a minute to be reflected, so if a picker is blank immediately after an
edit, try again shortly before looking for another cause.

