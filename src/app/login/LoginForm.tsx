'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { LazyMotion, m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Building2, ShieldCheck } from 'lucide-react';
import { AuthBrandMark } from '@/components/auth/AuthBrandMark';
import { LoginBrandPanel } from '@/components/auth/LoginBrandPanel';
import { DevLoginToolbar } from '@/components/auth/DevLoginToolbar';
import InputGroup from '@/components/ui/InputGroup';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { PasswordRulesHelper } from '@/components/auth/PasswordRulesHelper';
import { passwordRules } from '@/lib/password-policy';
import { safeCallbackUrl } from '@/lib/safe-callback';
import { oidcRefusalMessage } from '@/lib/oidc-refusal-message';
import { isValidEmail } from '@/lib/email';
import { SignupFormSchema } from '@/schemas/auth';

type LoginField = 'email' | 'password';
type SignupField = 'first' | 'last' | 'email' | 'password' | 'confirm';

type LoginErrors = Partial<Record<LoginField, string>>;
type SignupErrors = Partial<Record<SignupField, string>>;

/**
 * Framer Motion's animation features load on demand.
 *
 * This is the first page anyone loads, before they even have a session, so it is the worst
 * place to pay for a large animation library up front. `LazyMotion` keeps only the tiny `m`
 * component in the initial bundle and fetches the DOM animation features separately; the
 * animation itself is unchanged.
 */
const loadMotionFeatures = () => import('framer-motion').then((mod) => mod.domAnimation);

type LoginFormProps = {
  /** Read on the server, so the signup link and captcha are correct on the first paint. */
  allowSignup: boolean;
  hcaptchaSiteKey?: string;
  /** Whether the site can send email, so the reset link is only offered when it works. */
  mailConfigured?: boolean;
  /** Wording for the institutional sign-in button, or null when none is configured. */
  oidcButtonLabel?: string | null;
};

/* ================================================= */

export default function LoginForm({
  allowSignup,
  hcaptchaSiteKey,
  mailConfigured = false,
  oidcButtonLabel = null,
}: LoginFormProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  // Honor the OS "reduce motion" preference for the panel transitions (the global
  // CSS reset can't reach framer-motion's JS-driven animation).
  const reduceMotion = useReducedMotion();
  const panelMotion = reduceMotion
    ? { initial: false as const, animate: {}, exit: {}, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 6 },
        transition: { duration: 0.2 },
      };

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [signupFirst, setSignupFirst] = useState('');
  const [signupLast, setSignupLast] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loginErrors, setLoginErrors] = useState<LoginErrors>({});
  const [signupErrors, setSignupErrors] = useState<SignupErrors>({});
  const [captchaVisible, setCaptchaVisible] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const interactionStartRef = useRef(
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  );

  const searchParams = useSearchParams();
  // Where to send the user after login — honors ?callbackUrl= (e.g. a course join
  // link that bounced through login), but only same-origin paths (no open redirect).
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
  const isDev = process.env.NODE_ENV !== 'production';
  // Both of these used to be fetched from /api/system-settings/public in an effect on mount,
  // which meant the page painted without them and the signup link appeared a beat late. The
  // server reads them now and passes them in, so the first paint is already correct. The
  // build-time env var stays as the fallback for when the setting is unset.
  const captchaSiteKey = hcaptchaSiteKey || process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;

  const getMonotonicNow = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computeInteractionMs = () =>
    Math.max(0, Math.round(getMonotonicNow() - interactionStartRef.current));
  const shouldRenderCaptcha = Boolean(captchaVisible && captchaSiteKey);

  // Reveal the captcha widget when one is configured. Returns whether it was shown
  // so callers can tailor their message: solve-the-challenge vs. just wait out the
  // cooldown (when no captcha is set up, the limiter still enforces a timed cooldown).
  const requestCaptchaIfAvailable = useCallback(() => {
    if (!captchaSiteKey) return false;
    setCaptchaVisible(true);
    setCaptchaToken(null);
    return true;
  }, [captchaSiteKey]);

  const handleCaptchaVerify = (token: string) => setCaptchaToken(token);
  const handleCaptchaReset = () => setCaptchaToken(null);

  // Keep focus on first field whenever the user toggles between login/signup modes.
  useEffect(() => {
    document.getElementById(mode === 'login' ? 'login-email' : 'signup-first')?.focus();
    interactionStartRef.current = getMonotonicNow();
  }, [mode]);

  useEffect(() => {
    if (allowSignup === false && mode === 'signup') {
      setMode('login');
    }
  }, [allowSignup, mode]);

  /** Strip the one-shot error parameters, keeping everything else about the URL. */
  const clearAuthErrorParams = useCallback(() => {
    try {
      // From the same parameters the message was read out of, so the two cannot disagree.
      const params = new URLSearchParams(searchParams.toString());
      if (!params.has('error') && !params.has('reason')) return;
      params.delete('error');
      params.delete('reason');
      const query = params.toString();
      window.history.replaceState({}, '', `/login${query ? `?${query}` : ''}`);
    } catch {
      // Only the tidying is lost if the address cannot be rewritten; the message was shown,
      // and the sign-in below states its own destination rather than reading this.
    }
  }, [searchParams]);

  // Surface NextAuth error query params as toast feedback.
  useEffect(() => {
    const error = searchParams.get('error');
    if (!error) return;

    if (error === 'RateLimitExceeded') {
      showToast.error('Too many attempts. Please wait before trying again.');
      return;
    }

    if (error === 'BotChallengeRequired') {
      const shown = requestCaptchaIfAvailable();
      showToast.error(
        shown
          ? 'Unusual activity detected. Complete the security check below to continue.'
          : 'Too many attempts. Please wait a moment before trying again.',
      );
      return;
    }

    /**
     * Institutional sign-in refusals, which are not password failures and must not be reported
     * as one: somebody whose provider shared no address would otherwise retype a password that
     * was never wrong. The reason is a fixed word from the callback, and the wording avoids
     * saying whether an AFCT account exists.
     */
    if (error === 'oidc') {
      showToast.error(oidcRefusalMessage(searchParams.get('reason')));
      // Taken out of the address bar once it has been read. It has done its job, a reload
      // should not repeat it, and leaving it there means every later sign-in from this page
      // carries an `error` parameter that the Auth.js client reads as its own failure.
      clearAuthErrorParams();
      return;
    }

    showToast.error('Invalid email or password.');
    clearAuthErrorParams();
  }, [searchParams, requestCaptchaIfAvailable, clearAuthErrorParams]);

  // Classify a failed sign-in by asking the read-only login-check endpoint (NextAuth
  // hides the real reason). Returns 'challenge' (show captcha), 'blocked' (rate
  // limited), or 'ok' (treat as bad credentials). Never throws.
  const fetchLoginState = async (email: string): Promise<'ok' | 'challenge' | 'blocked'> => {
    try {
      const res = await fetch('/api/auth/login-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) return 'ok';
      const data = (await res.json()) as { status?: string };
      return data.status === 'challenge' || data.status === 'blocked' ? data.status : 'ok';
    } catch {
      return 'ok';
    }
  };

  // Basic credential flow with minimal client-side validation before delegating to NextAuth.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = loginEmail.trim();
    const trimmedPassword = loginPassword.trim();

    const errors: LoginErrors = {};
    if (!trimmedEmail) errors.email = 'Email is required.';
    else if (!isValidEmail(trimmedEmail)) errors.email = 'Enter a valid email address.';
    if (!trimmedPassword) errors.password = 'Password is required.';

    setLoginErrors(errors);
    if (Object.keys(errors).length) {
      showToast.error('Please correct the highlighted fields.');
      return;
    }

    setLoading(true);

    const result = await signIn('credentials', {
      email: trimmedEmail,
      password: trimmedPassword,
      interactionMs: computeInteractionMs(),
      captchaToken: captchaToken ?? undefined,
      redirect: false,
      // The destination, stated rather than left to default.
      //
      // Auth.js answers a `redirect: false` sign-in with a URL, and the client library treats
      // an `error` parameter *in that URL* as a failed sign-in. Left to itself it echoes the
      // page the request came from, so after an institutional refusal this page carries
      // `?error=oidc` and every password sign-in from it was reported as wrong credentials
      // while the server had in fact signed the person in.
      callbackUrl,
    });

    if (result?.error) {
      // NextAuth (Auth.js v5) reports every authorize failure as a generic error, so
      // ask the server what actually happened: a rate-limit block, a bot challenge
      // (show the captcha), or plain bad credentials.
      const state = await fetchLoginState(trimmedEmail);
      if (state === 'blocked') {
        showToast.error('Too many login attempts. Please wait a few minutes and try again.');
        setLoginErrors({ password: 'Temporarily locked due to too many attempts.' });
      } else if (state === 'challenge') {
        const shown = requestCaptchaIfAvailable();
        showToast.error(
          shown
            ? 'Unusual activity detected. Complete the security check below to continue.'
            : 'Too many attempts. Please wait a moment before trying again.',
        );
      } else {
        showToast.error('Invalid email or password.');
        setLoginErrors({ password: 'Email or password is incorrect.' });
      }
      setLoading(false);
    } else {
      setLoginErrors({});
      setCaptchaVisible(false);
      setCaptchaToken(null);
      window.location.href = callbackUrl;
    }
  };

  // Calls the signup route, then signs the new user in with the same credentials.
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (allowSignup !== true) {
      showToast.error('Signups are currently disabled.');
      setMode('login');
      return;
    }

    const trimmed = {
      first: signupFirst.trim(),
      last: signupLast.trim(),
      email: signupEmail.trim(),
      password: signupPassword,
      confirm: signupConfirm,
    };

    // Validate against the shared signup schema (the same field rules the route
    // enforces), mapping its issues back onto the form's per-field error slots.
    const parsed = SignupFormSchema.safeParse({
      firstName: trimmed.first,
      lastName: trimmed.last,
      email: trimmed.email,
      password: trimmed.password,
      confirmPassword: trimmed.confirm,
    });

    if (!parsed.success) {
      const fieldByPath: Record<string, SignupField> = {
        firstName: 'first',
        lastName: 'last',
        email: 'email',
        password: 'password',
        confirmPassword: 'confirm',
      };
      const errors: SignupErrors = {};
      for (const issue of parsed.error.issues) {
        const field = fieldByPath[String(issue.path[0])];
        if (field && !errors[field]) errors[field] = issue.message;
      }
      setSignupErrors(errors);
      showToast.error('Please correct the highlighted fields.');
      return;
    }

    setSignupErrors({});

    setLoading(true);

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: trimmed.first,
        lastName: trimmed.last,
        email: trimmed.email,
        password: trimmed.password,
        role: 'STUDENT',
        interactionMs: computeInteractionMs(),
        captchaToken: captchaToken ?? undefined,
      }),
    });

    setLoading(false);

    if (res.status === 428) {
      const shown = requestCaptchaIfAvailable();
      showToast.error(
        shown
          ? 'Unusual activity detected. Complete the security check below to continue.'
          : 'Please slow down. Wait a moment before creating another account.',
      );
      return;
    }

    if (res.status === 429) {
      showToast.error('Too many signup attempts. Please try again later.');
      return;
    }

    if (!res.ok) {
      // Surface the server's specific reason. 403 is overloaded — signup disabled
      // vs. an email domain that isn't allowed — and 409 is a duplicate email.
      const message =
        (await res.json().catch(() => null))?.error ?? 'Signup failed. Please try again.';

      if (res.status === 403 && /disabled/i.test(message)) {
        showToast.error(message);
        setMode('login');
        return;
      }
      // Duplicate email or disallowed domain: pin it to the email field so the
      // user sees which input to fix, not just a toast.
      if (res.status === 409 || res.status === 403) {
        setSignupErrors({ email: message });
      }
      showToast.error(message);
      return;
    }

    const signInResult = await signIn('credentials', {
      email: trimmed.email,
      password: trimmed.password,
      interactionMs: computeInteractionMs(),
      captchaToken: captchaToken ?? undefined,
      redirect: false,
      // Same reason as the sign-in above: never let the current URL decide this.
      callbackUrl,
    });

    // The account was created; if the immediate auto-login didn't take, don't
    // strand the user on a bounce — send them to sign in with a clear message.
    if (signInResult?.error) {
      showToast.success('Account created. Please sign in.');
      setSignupErrors({});
      setLoginEmail(trimmed.email);
      setMode('login');
      return;
    }

    setSignupErrors({});
    window.location.href = callbackUrl;
  };

  const passwordHelperId = 'signup-password-helper';
  const passwordRuleStatuses = passwordRules.map((rule) => ({
    label: rule.label,
    passed: rule.test(signupPassword),
  }));

  const renderCaptchaGate = () => {
    if (!shouldRenderCaptcha) return null;
    return (
      <div className="bg-muted text-foreground rounded-xl border p-3 text-sm">
        <p className="mb-2 font-semibold">Complete the security check to continue.</p>
        {/* The widget has a fixed pixel width of its own, so the container scrolls rather
            than the page: a 302px iframe in a 288px column is how the whole layout ends up
            wider than a phone. */}
        <div className="flex justify-center overflow-x-auto">
          <HCaptcha
            sitekey={captchaSiteKey as string}
            onVerify={handleCaptchaVerify}
            onExpire={handleCaptchaReset}
            onError={handleCaptchaReset}
            reCaptchaCompat={false}
            theme="light"
          />
        </div>
      </div>
    );
  };
  // Prefills login credentials for the given role and forces the login form visible.
  const applyTestLogin = (role: string) => {
    setLoginEmail(`${role}@example.com`);
    setLoginPassword('password123');
    setMode('login');
  };

  return (
    /**
     * A fixed light composition, whatever theme the visitor's dashboard is set to.
     *
     * `auth-light` re-declares the light palette for this subtree (see globals.css). Nobody
     * has a session yet on this page, so following a stored dark preference means a stranger's
     * choice deciding whether the sign-in form is legible; before this, the card was a
     * hardcoded white with grey labels bolted on to survive `.dark` on <html>. High contrast
     * still wins over it, which is deliberate.
     */
    <div className="auth-light bg-background text-foreground min-h-dvh w-full lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      {/* Below lg the picture goes entirely rather than shrinking: half a brand panel beside a
          narrow form is neither one thing nor the other. The compact header below stands in. */}
      <LoginBrandPanel className="hidden lg:sticky lg:top-0 lg:grid" />

      <div className="auth-form-surface flex min-h-dvh w-full flex-col items-center px-4 pt-8 pb-5 sm:px-6 lg:pt-10 lg:pb-6">
        <div className="mb-6 flex w-full max-w-[680px] flex-col items-center text-center lg:hidden">
          <AuthBrandMark className="text-primary size-11" />
          {/* Not a heading: the form's own title is the page's one h1, and a second one here
              would put the product name above the thing the page is for. */}
          <p className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">AFCT Dashboard</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Automated Feedback for Computing Theory
          </p>
        </div>

        {/* Wider than the card inside it, so the development strip has room for four buttons
            on one line without the form growing to match. */}
        <div className="flex w-full max-w-[680px] flex-1 flex-col justify-center">
          {/* Narrower than the column it sits in. A form is read down a single measure, so it
              stops at a comfortable one however wide the screen gets; the development panel
              below is a grid of controls and takes the full 560. */}
          <section
            aria-labelledby="auth-heading"
            className="bg-card mx-auto w-full max-w-[520px] rounded-2xl border p-5 shadow-md sm:p-6 lg:p-8"
          >
            {/* Outside the animated panels, so switching mode retitles the page rather than
                replacing its h1: one h1 that changes its words, not two that take turns. */}
            <div className="mb-6 flex flex-col items-center text-center">
              <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl">
                <ShieldCheck className="size-6" aria-hidden="true" />
              </span>
              <h1 id="auth-heading" className="mt-4 text-2xl font-semibold tracking-tight">
                {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {mode === 'login'
                  ? 'Access your AFCT Dashboard'
                  : 'Set up your AFCT Dashboard account'}
              </p>
            </div>

            {/* Neither form sets autoComplete="off". The individual fields carry the
                right tokens (username / current-password / new-password), and a
                form-level "off" can stop a password manager filling or saving them in
                some browsers. Letting the manager do that work is what keeps signing in
                from being a memory test (WCAG 2.2 SC 3.3.8, Accessible Authentication).
                The admin reset-password dialog is the deliberate exception: there an
                administrator is setting someone else's password. */}
            <LazyMotion features={loadMotionFeatures}>
              <AnimatePresence mode="wait" initial={false}>
                {mode === 'login' ? (
                  <m.form
                    key="login"
                    id="login-panel"
                    {...panelMotion}
                    onSubmit={handleLogin}
                    className="space-y-5"
                  >
                    {/* Not a live region: each field's error <p> now carries role="alert",
                      so announcing here too would double-speak. Kept as static context. */}
                    <p className="sr-only">
                      {Object.values(loginErrors)[0]
                        ? `Form error: ${Object.values(loginErrors)[0]}`
                        : ''}
                    </p>
                    <InputGroup
                      id="login-email"
                      label="Email"
                      name="login-email"
                      required
                      requiredMark
                      autoComplete="username"
                      placeholder="name@university.edu"
                      value={loginEmail}
                      setValue={setLoginEmail}
                      type="email"
                      error={loginErrors.email}
                    />

                    <div className="space-y-2">
                      <InputGroup
                        label="Password"
                        name="login-password"
                        required
                        requiredMark
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={loginPassword}
                        setValue={setLoginPassword}
                        type="password"
                        showEye
                        isPasswordVisible={showLoginPassword}
                        togglePasswordVisibility={() => setShowLoginPassword((v) => !v)}
                        error={loginErrors.password}
                      />

                      {/* Only offered where the site can actually send it. Without mail
                        configured this link leads to a page that can only apologise, and the
                        row is not rendered at all rather than left empty. */}
                      {mailConfigured ? (
                        <div className="flex justify-end">
                          <Link
                            href="/forgot-password"
                            className="text-link hover:text-link-hover text-sm hover:underline"
                          >
                            Forgot password?
                          </Link>
                        </div>
                      ) : null}
                    </div>

                    {renderCaptchaGate()}

                    <Button
                      type="submit"
                      disabled={loading}
                      aria-disabled={loading}
                      className="h-11 w-full font-semibold"
                    >
                      {loading ? 'Logging in...' : 'Sign In'}
                    </Button>

                    {/* Shown only when a provider is configured, so the button never leads
                      somewhere that cannot work, and the divider does not appear on its own.
                      Local sign-in stays above it and keeps working whatever is set here. */}
                    {oidcButtonLabel ? (
                      <div className="space-y-3">
                        <div className="text-muted-foreground flex items-center gap-3 text-xs">
                          <span className="bg-border h-px flex-1" />
                          or
                          <span className="bg-border h-px flex-1" />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 w-full"
                          // The same sanitised destination the password form uses. Somebody sent to
                          // the login page from a course link should land on that link, whichever way
                          // they sign in.
                          onClick={() => void signIn('oidc', { callbackUrl })}
                        >
                          <Building2 className="size-4" aria-hidden="true" />
                          {oidcButtonLabel}
                        </Button>
                      </div>
                    ) : null}

                    {allowSignup ? (
                      <p className="text-muted-foreground text-center text-sm">
                        Don&apos;t have an account?{' '}
                        <button
                          type="button"
                          className="text-link hover:text-link-hover font-semibold hover:underline"
                          onClick={() => setMode('signup')}
                        >
                          Create account
                        </button>
                      </p>
                    ) : null}
                  </m.form>
                ) : (
                  <m.form
                    key="signup"
                    id="signup-panel"
                    {...panelMotion}
                    onSubmit={handleSignup}
                    className="space-y-5"
                  >
                    {/* Not a live region: each field's error <p> now carries role="alert",
                      so announcing here too would double-speak. Kept as static context. */}
                    <p className="sr-only">
                      {Object.values(signupErrors)[0]
                        ? `Form error: ${Object.values(signupErrors)[0]}`
                        : ''}
                    </p>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <InputGroup
                        id="signup-first"
                        label="First Name"
                        name="signup-first"
                        required
                        requiredMark
                        autoComplete="given-name"
                        value={signupFirst}
                        setValue={setSignupFirst}
                        error={signupErrors.first}
                      />

                      <InputGroup
                        label="Last Name"
                        name="signup-last"
                        required
                        requiredMark
                        autoComplete="family-name"
                        value={signupLast}
                        setValue={setSignupLast}
                        error={signupErrors.last}
                      />
                    </div>

                    <InputGroup
                      label="Email"
                      name="signup-email"
                      required
                      requiredMark
                      autoComplete="username"
                      placeholder="name@university.edu"
                      value={signupEmail}
                      setValue={setSignupEmail}
                      type="email"
                      error={signupErrors.email}
                    />

                    <InputGroup
                      label="Password"
                      name="signup-password"
                      required
                      requiredMark
                      autoComplete="new-password"
                      value={signupPassword}
                      setValue={setSignupPassword}
                      type="password"
                      showEye
                      isPasswordVisible={showSignupPassword}
                      togglePasswordVisibility={() => setShowSignupPassword((v) => !v)}
                      additionalDescribedBy={passwordHelperId}
                      error={signupErrors.password}
                    />

                    <InputGroup
                      label="Confirm Password"
                      name="signup-confirm"
                      required
                      requiredMark
                      autoComplete="new-password"
                      value={signupConfirm}
                      setValue={setSignupConfirm}
                      type="password"
                      showEye
                      isPasswordVisible={showSignupConfirm}
                      togglePasswordVisibility={() => setShowSignupConfirm((v) => !v)}
                      error={signupErrors.confirm}
                    />

                    <PasswordRulesHelper id={passwordHelperId} rules={passwordRuleStatuses} />

                    {renderCaptchaGate()}

                    <Button
                      type="submit"
                      disabled={loading}
                      aria-disabled={loading}
                      className="h-11 w-full font-semibold"
                    >
                      {loading ? 'Signing up...' : 'Create Account'}
                    </Button>

                    <p className="text-muted-foreground text-center text-sm">
                      Already have an account?{' '}
                      <button
                        type="button"
                        className="text-link hover:text-link-hover font-semibold hover:underline"
                        onClick={() => setMode('login')}
                      >
                        Sign in
                      </button>
                    </p>
                  </m.form>
                )}
              </AnimatePresence>
            </LazyMotion>
          </section>
        </div>

        {/* Outside the card's block and after it, so the flex-1 above pushes it to the foot of
            the pane: it is a tool that belongs to the page, not a footer on the form. In flow
            rather than fixed, so a tall signup form or an expanded error simply moves it down
            instead of having it sit on top of the thing being filled in. */}
        {isDev ? <DevLoginToolbar onSelectRole={applyTestLogin} className="mt-8" /> : null}
      </div>
    </div>
  );
}
