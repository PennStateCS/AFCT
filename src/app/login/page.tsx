'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
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
  const [isEmailAvailable, setIsEmailAvailable] = useState<boolean | null>(null);

  const searchParams = useSearchParams();

  useEffect(() => {
    document.getElementById(mode === 'login' ? 'login-email' : 'signup-first')?.focus();
  }, [mode]);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) toast.error('Invalid email or password.');
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      toast.error('Please fill in both fields.');
      return;
    }

    setLoading(true);

    const result = await signIn('credentials', {
      email: loginEmail,
      password: loginPassword,
      redirect: false,
    });

    if (result?.error) {
      toast.error('Invalid email or password.');
      setLoading(false);
    } else {
      window.location.href = '/dashboard';
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signupFirst || !signupLast || !signupEmail || !signupPassword || !signupConfirm) {
      toast.error('Please fill in all fields.');
      return;
    }

    if (!isStrongPassword(signupPassword)) {
      toast.error('Password must meet all requirements.');
      return;
    }

    if (signupPassword !== signupConfirm) {
      toast.error("Passwords don't match.");
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
      toast.error('Signup failed.');
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

  return (
    <div className="relative flex min-h-screen w-full items-start justify-center pt-24 md:pt-[14vh]">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#5F9EA0] via-[#6FAFB2] to-[#2F4A8A]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15),transparent_70%)]" />

      {/* DEV BADGE + TEST LOGINS */}
      {process.env.NODE_ENV !== 'production' && (
        <>
          <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2">
            <div className="inline-block rounded-full bg-[#2F4A8A] px-3 py-1 text-xs font-semibold text-white shadow-md">
              Development Server
            </div>
          </div>

          <div className="fixed top-4 right-4 z-50 text-right">
            <div className="w-44 rounded-xl border bg-white p-4 shadow-lg">
              <span className="mb-2 block text-xs font-semibold text-gray-600">Test Logins</span>

              <div className="space-y-2">
                {['admin', 'faculty', 'ta', 'student'].map((role) => (
                  <button
                    key={role}
                    className="w-full rounded bg-gray-100 px-3 py-1 text-xs font-medium transition hover:bg-gray-200"
                    onClick={() => {
                      setLoginEmail(`${role}@example.com`);
                      setLoginPassword('password123');
                      setMode('login');
                    }}
                  >
                    {role === 'ta' ? 'TA' : role.charAt(0).toUpperCase() + role.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* CARD */}
      <div className="relative z-10 mx-4 w-full max-w-[430px] rounded-2xl bg-white p-8 shadow-[0_25px_60px_rgba(0,0,0,0.25)]">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-800">AFCT Dashboard</h1>
          <p className="mt-1 text-base text-gray-700">Automated Feedback for Computing Theory</p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {mode === 'login' ? (
            <motion.form
              key="login"
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
                className="w-full bg-[#2F4A8A] text-white hover:bg-[#243B70] disabled:bg-[#2F4A8A] disabled:opacity-80"
              >
                {loading ? 'Logging in...' : 'Sign In'}
              </Button>

              <div className="text-center text-base text-gray-700">
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  className="font-medium text-[#2F4A8A] hover:underline"
                  onClick={() => setMode('signup')}
                >
                  Sign up
                </button>
              </div>
            </motion.form>
          ) : (
            <motion.form
              key="signup"
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

              <Button
                type="submit"
                disabled={loading}
                aria-disabled={loading}
                className="w-full bg-[#2F4A8A] text-white hover:bg-[#243B70]"
              >
                {loading ? 'Signing up...' : 'Create Account'}
              </Button>

              <div className="text-center text-sm text-gray-700">
                Already have an account?{' '}
                <button
                  type="button"
                  className="font-medium text-[#2F4A8A] hover:underline"
                  onClick={() => setMode('login')}
                >
                  Login
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
