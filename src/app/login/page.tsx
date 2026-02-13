'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench } from 'lucide-react';
import InputGroup from '@/components/ui/InputGroup';

/* ---------------- Validators ---------------- */

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const passwordRules = [
  { label: 'At least 8 characters', test: (pw: string) => pw.length >= 8 },
  { label: 'At least one uppercase letter', test: (pw: string) => /[A-Z]/.test(pw) },
  { label: 'At least one lowercase letter', test: (pw: string) => /[a-z]/.test(pw) },
  { label: 'At least one number', test: (pw: string) => /\d/.test(pw) },
  { label: 'At least one special character', test: (pw: string) => /[^A-Za-z0-9]/.test(pw) },
];

const isStrongPassword = (password: string) => passwordRules.every((rule) => rule.test(password));

const testLoginButtons = [
  { role: 'admin', label: 'Admin', classes: 'bg-[#2F4A8A] text-white hover:bg-[#253972]' },
  { role: 'faculty', label: 'Faculty', classes: 'bg-[#486AAE] text-white hover:bg-[#3B5793]' },
  { role: 'ta', label: 'TA', classes: 'bg-[#5F9EA0] text-white hover:bg-[#4E7E80]' },
  { role: 'student', label: 'Student', classes: 'bg-[#8BD3CF] text-gray-900 hover:bg-[#78BBB7]' },
];

/* ================================================= */

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

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

  const searchParams = useSearchParams();
  const isDev = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    document.getElementById(mode === 'login' ? 'login-email' : 'signup-first')?.focus();
  }, [mode]);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) showToast.error('Invalid email or password.');
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      showToast.error('Please fill in both fields.');
      return;
    }

    setLoading(true);

    const result = await signIn('credentials', {
      email: loginEmail,
      password: loginPassword,
      redirect: false,
    });

    if (result?.error) {
      showToast.error('Invalid email or password.');
      setLoading(false);
    } else {
      window.location.href = '/dashboard';
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signupFirst || !signupLast || !signupEmail || !signupPassword || !signupConfirm) {
      showToast.error('Please fill in all fields.');
      return;
    }

    if (!isStrongPassword(signupPassword)) {
      showToast.error('Password must meet all requirements.');
      return;
    }

    if (signupPassword !== signupConfirm) {
      showToast.error("Passwords don't match.");
      return;
    }

    setLoading(true);

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: signupFirst,
        lastName: signupLast,
        email: signupEmail,
        password: signupPassword,
        role: 'STUDENT',
      }),
    });

    setLoading(false);

    if (!res.ok) {
      showToast.error('Signup failed.');
      return;
    }

    await signIn('credentials', {
      email: signupEmail,
      password: signupPassword,
      redirect: false,
    });

    window.location.href = '/dashboard';
  };

  const isLoginEmailValid = isValidEmail(loginEmail);
  const passwordHelperId = 'signup-password-helper';
  const passwordRuleStatuses = passwordRules.map((rule) => ({
    label: rule.label,
    passed: rule.test(signupPassword),
  }));

  const applyTestLogin = (role: string) => {
    setLoginEmail(`${role}@example.com`);
    setLoginPassword('password123');
    setMode('login');
  };

  return (
    <div className="relative flex min-h-screen w-full items-start justify-center pt-24 md:pt-[14vh]">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#5F9EA0] via-[#6FAFB2] to-[#2F4A8A]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15),transparent_70%)]" />

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
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleLogin}
                className="space-y-5"
              >
                <InputGroup
                  id="login-email"
                  label="Email"
                  name="login-email"
                  autoComplete="username"
                  value={loginEmail}
                  setValue={setLoginEmail}
                  type="email"
                />

                <InputGroup
                  label="Password"
                  name="login-password"
                  autoComplete="current-password"
                  value={loginPassword}
                  setValue={setLoginPassword}
                  type="password"
                  showEye
                  isPasswordVisible={showLoginPassword}
                  togglePasswordVisibility={() => setShowLoginPassword((v) => !v)}
                />

                <Button
                  type="submit"
                  disabled={loading || !isLoginEmailValid}
                  aria-disabled={loading || !isLoginEmailValid}
                  className="w-full bg-[#2F4A8A] text-white disabled:bg-[#2F4A8A] disabled:opacity-80"
                >
                  {loading ? 'Logging in...' : 'Sign In'}
                </Button>

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
              </motion.form>
            ) : (
              <motion.form
                key="signup"
                id="signup-panel"
                autoComplete="off"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleSignup}
                className="space-y-5"
              >
                <InputGroup
                  id="signup-first"
                  label="First Name"
                  name="signup-first"
                  autoComplete="off"
                  value={signupFirst}
                  setValue={setSignupFirst}
                />

                <InputGroup
                  label="Last Name"
                  name="signup-last"
                  autoComplete="off"
                  value={signupLast}
                  setValue={setSignupLast}
                />

                <InputGroup
                  label="Email"
                  name="signup-email"
                  autoComplete="username"
                  value={signupEmail}
                  setValue={setSignupEmail}
                  type="email"
                />

                <InputGroup
                  label="Password"
                  name="signup-password"
                  autoComplete="new-password"
                  value={signupPassword}
                  setValue={setSignupPassword}
                  type="password"
                  showEye
                  isPasswordVisible={showSignupPassword}
                  togglePasswordVisibility={() => setShowSignupPassword((v) => !v)}
                  additionalDescribedBy={passwordHelperId}
                />

                <InputGroup
                  label="Confirm Password"
                  name="signup-confirm"
                  autoComplete="new-password"
                  value={signupConfirm}
                  setValue={setSignupConfirm}
                  type="password"
                  showEye
                  isPasswordVisible={showSignupConfirm}
                  togglePasswordVisibility={() => setShowSignupConfirm((v) => !v)}
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
            <div className="flex w-full flex-col gap-2 text-sm font-semibold">
              {testLoginButtons.map(({ role, label, classes }) => (
                <button
                  key={role}
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

type PasswordRuleStatus = {
  label: string;
  passed: boolean;
};
function PasswordRulesHelper({ id, rules }: { id: string; rules: PasswordRuleStatus[] }) {
  return (
    <div
      id={id}
      aria-live="polite"
      className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-700"
    >
      <p className="mb-2 font-semibold text-gray-800">Password must include:</p>
      <ul className="space-y-1">
        {rules.map((rule) => (
          <li key={rule.label} className="flex items-center gap-2">
            <span aria-hidden="true">{rule.passed ? '✅' : '⚠️'}</span>
            <span className={rule.passed ? 'text-green-700' : 'text-gray-700'}>{rule.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
