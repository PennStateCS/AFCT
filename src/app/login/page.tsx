'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Wrench } from 'lucide-react';
import InputGroup from '@/components/ui/InputGroup';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { PasswordRulesHelper } from '@/components/auth/PasswordRulesHelper';
import { passwordRules } from '@/lib/password-policy';
import { apiPaths } from '@/lib/api-paths';
import { isValidEmail } from '@/lib/email';
import { SignupFormSchema } from '@/schemas/auth';

// Dev-only quick login shortcuts so QA can impersonate common roles fast.
const testLoginButtons = [
  { role: 'admin', label: 'Admin', classes: 'bg-[#406669] text-white hover:bg-[#335556]' },
  { role: 'faculty', label: 'Faculty', classes: 'bg-[#588a87] text-white hover:bg-[#47776f]' },
  { role: 'ta', label: 'TA', classes: 'bg-[#375087] text-white hover:bg-[#2c3b73]' },
  { role: 'student', label: 'Student', classes: 'bg-[#1b2a52] text-white hover:bg-[#162043]' },
];

type LoginField = 'email' | 'password';
type SignupField = 'first' | 'last' | 'email' | 'password' | 'confirm';

type LoginErrors = Partial<Record<LoginField, string>>;
type SignupErrors = Partial<Record<SignupField, string>>;

/* ================================================= */

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [allowSignup, setAllowSignup] = useState<boolean | null>(null);

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
  const isDev = process.env.NODE_ENV !== 'production';
  // Site key comes from admin settings at runtime, falling back to the build-time env.
  const [captchaSiteKey, setCaptchaSiteKey] = useState<string | undefined>(
    process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY,
  );

  // One fetch of the public settings on mount, reading every field the login page
  // needs: the hCaptcha site key and whether signup is enabled system-wide.
  // (Previously two separate effects each fetched this same endpoint.)
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(apiPaths.systemSettingsPublic(), { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as {
          hcaptchaSiteKey?: string | null;
          allowSignup?: boolean;
        };
        if (!active) return;
        if (typeof data.hcaptchaSiteKey === 'string' && data.hcaptchaSiteKey) {
          setCaptchaSiteKey(data.hcaptchaSiteKey);
        }
        setAllowSignup(data.allowSignup ?? true);
      } catch {
        // keep the env fallback for the captcha key; default signup to allowed
        if (active) setAllowSignup(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const getMonotonicNow = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const computeInteractionMs = () =>
    Math.max(0, Math.round(getMonotonicNow() - interactionStartRef.current));
  const shouldRenderCaptcha = Boolean(captchaVisible && captchaSiteKey);

  const requestCaptchaIfAvailable = useCallback(() => {
    if (!captchaSiteKey) {
      showToast.error('Security challenge unavailable. Please contact support.');
      return;
    }
    setCaptchaVisible(true);
    setCaptchaToken(null);
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

  // Surface NextAuth error query params as toast feedback.
  useEffect(() => {
    const error = searchParams.get('error');
    if (!error) return;

    if (error === 'RateLimitExceeded') {
      showToast.error('Too many attempts. Please wait before trying again.');
      return;
    }

    if (error === 'BotChallengeRequired') {
      showToast.error('We detected unusual activity. Please slow down then retry.');
      requestCaptchaIfAvailable();
      return;
    }

    showToast.error('Invalid email or password.');
  }, [searchParams, requestCaptchaIfAvailable]);

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
    });

    if (result?.error) {
      if (result.error === 'RateLimitExceeded') {
        showToast.error('Too many login attempts. Please wait a few minutes and try again.');
        setLoginErrors({ password: 'Temporarily locked due to too many attempts.' });
      } else if (result.error === 'BotChallengeRequired') {
        showToast.error('We detected unusual activity. Please pause briefly before retrying.');
        requestCaptchaIfAvailable();
      } else {
        showToast.error('Invalid email or password.');
        setLoginErrors({ password: 'Email or password is incorrect.' });
      }
      setLoading(false);
    } else {
      setLoginErrors({});
      setCaptchaVisible(false);
      setCaptchaToken(null);
      window.location.href = '/dashboard';
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
      showToast.error('Please slow down before creating another account.');
      requestCaptchaIfAvailable();
      return;
    }

    if (res.status === 429) {
      showToast.error('Too many signup attempts. Please try again later.');
      return;
    }

    if (res.status === 403) {
      showToast.error('Signups are currently disabled.');
      setMode('login');
      return;
    }

    if (!res.ok) {
      showToast.error('Signup failed.');
      return;
    }

    await signIn('credentials', {
      email: trimmed.email,
      password: trimmed.password,
      interactionMs: computeInteractionMs(),
      captchaToken: captchaToken ?? undefined,
      redirect: false,
    });

    setSignupErrors({});
    window.location.href = '/dashboard';
  };

  const isLoginEmailValid = isValidEmail(loginEmail);
  const passwordHelperId = 'signup-password-helper';
  const passwordRuleStatuses = passwordRules.map((rule) => ({
    label: rule.label,
    passed: rule.test(signupPassword),
  }));

  const renderCaptchaGate = () => {
    if (!shouldRenderCaptcha) return null;
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        <p className="mb-2 font-semibold text-gray-800">Complete the security check to continue.</p>
        <HCaptcha
          sitekey={captchaSiteKey as string}
          onVerify={handleCaptchaVerify}
          onExpire={handleCaptchaReset}
          onError={handleCaptchaReset}
          reCaptchaCompat={false}
          theme="light"
        />
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
    <div className="relative flex min-h-dvh w-full items-start justify-center overflow-x-hidden pt-24 md:pt-[14vh]">
      {/* Background */}
      <div className="fixed inset-0 z-0 bg-gradient-to-br from-[#5F9EA0] via-[#6FAFB2] to-[#2F4A8A]" />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15),transparent_70%)]" />

      {/* DEV BADGE */}
      {isDev && (
        <div className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center justify-center">
          <div className="flex items-center gap-2 rounded-full border border-white/50 bg-white/95 px-4 py-1.5 text-[0.68rem] font-semibold tracking-[0.25em] text-[#2F4A8A] uppercase shadow-xl backdrop-blur-lg">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#2F4A8A] text-white shadow">
              <Wrench className="h-3.5 w-3.5" strokeWidth={2.3} />
            </span>
            Development Build
          </div>
        </div>
      )}

      {/* CARD + DEV PANEL */}
      <div className="relative z-10 mx-4 w-full max-w-[430px]">
        <div className="rounded-2xl bg-white p-8 shadow-[0_25px_60px_rgba(0,0,0,0.25)]">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-gray-800">AFCT Dashboard</h1>
            <p className="mt-1 text-base text-gray-700">Automated Feedback for Computing Theory</p>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {mode === 'login' ? (
              <motion.form
                key="login"
                id="login-panel"
                autoComplete="off"
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
                  labelClassName="text-gray-800"
                  name="login-email"
                  required
                  requiredMark
                  autoComplete="username"
                  value={loginEmail}
                  setValue={setLoginEmail}
                  type="email"
                  error={loginErrors.email}
                />

                <InputGroup
                  label="Password"
                  labelClassName="text-gray-800"
                  name="login-password"
                  required
                  requiredMark
                  autoComplete="current-password"
                  value={loginPassword}
                  setValue={setLoginPassword}
                  type="password"
                  showEye
                  isPasswordVisible={showLoginPassword}
                  togglePasswordVisibility={() => setShowLoginPassword((v) => !v)}
                  error={loginErrors.password}
                />

                <Button
                  type="submit"
                  disabled={loading || !isLoginEmailValid}
                  aria-disabled={loading || !isLoginEmailValid}
                  className="w-full bg-[#2F4A8A] text-white disabled:bg-[#2F4A8A] disabled:opacity-80"
                >
                  {loading ? 'Logging in...' : 'Sign In'}
                </Button>

                {renderCaptchaGate()}

                {allowSignup ? (
                  <div className="text-center text-sm text-gray-600">
                    <span className="font-semibold text-gray-500">Don&apos;t have an account?</span>{' '}
                    <button
                      type="button"
                      className="font-semibold text-[#2F4A8A] underline-offset-2 hover:underline"
                      onClick={() => setMode('signup')}
                    >
                      Sign up
                    </button>
                  </div>
                ) : null}
              </motion.form>
            ) : (
              <motion.form
                key="signup"
                id="signup-panel"
                autoComplete="off"
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

                <InputGroup
                  label="Email"
                  name="signup-email"
                  required
                  requiredMark
                  autoComplete="username"
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

                <Button
                  type="submit"
                  disabled={loading}
                  aria-disabled={loading}
                  className="w-full bg-[#2F4A8A] text-white disabled:bg-[#2F4A8A] disabled:opacity-80"
                >
                  {loading ? 'Signing up...' : 'Create Account'}
                </Button>

                {renderCaptchaGate()}

                <div className="text-center text-sm text-gray-600">
                  <span className="font-semibold text-gray-500">Already have an account?</span>{' '}
                  <button
                    type="button"
                    className="font-semibold text-[#2F4A8A] underline-offset-2 hover:underline"
                    onClick={() => setMode('login')}
                  >
                    Login
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {isDev && (
          <div className="fixed top-6 right-6 z-40 w-32 rounded-2xl border border-white/40 bg-white/95 p-4 text-gray-700 shadow-2xl backdrop-blur-md">
            <span className="mb-3 block text-center text-[0.65rem] font-semibold tracking-[0.35em] text-gray-500 uppercase">
              Test Logins
            </span>
            <div className="flex w-full flex-col gap-2 text-xs font-semibold">
              {testLoginButtons.map(({ role, label, classes }) => (
                <button
                  key={role}
                  type="button"
                  className={`w-full rounded-lg px-4 py-2 transition focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none ${classes}`}
                  onClick={() => applyTestLogin(role)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
