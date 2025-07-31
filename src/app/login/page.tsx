'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Popover from '@radix-ui/react-popover';
import { CheckCircle, XCircle } from 'lucide-react';
import InputGroup from '@/components/ui/InputGroup';

// Validation rules
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const passwordRules = [
  { label: 'At least 8 characters', test: (pw: string) => pw.length >= 8 },
  { label: 'At least one uppercase letter', test: (pw: string) => /[A-Z]/.test(pw) },
  { label: 'At least one lowercase letter', test: (pw: string) => /[a-z]/.test(pw) },
  { label: 'At least one number', test: (pw: string) => /\d/.test(pw) },
  { label: 'At least one special character', test: (pw: string) => /[^A-Za-z0-9]/.test(pw) },
];
const isStrongPassword = (password: string) => passwordRules.every((rule) => rule.test(password));

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

  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [isEmailAvailable, setIsEmailAvailable] = useState<boolean | null>(null);

  const searchParams = useSearchParams();
  const loginEmailRef = useRef<HTMLInputElement>(null);
  const signupFirstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'login') loginEmailRef.current?.focus();
    else signupFirstRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error === 'CredentialsSignin') toast.error('Invalid email or password.');
    else if (error) toast.error('Login failed. Please try again.');
  }, [searchParams]);

  const checkEmailAvailability = async (email: string) => {
    if (!isValidEmail(email)) {
      setIsEmailAvailable(null);
      return;
    }
    setIsCheckingEmail(true);
    try {
      const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      setIsEmailAvailable(!data.exists);
    } catch {
      setIsEmailAvailable(null); // fallback to unknown
    } finally {
      setIsCheckingEmail(false);
    }
  };

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
      callbackUrl: '/dashboard',
    });
    setLoading(false);

    if (result?.error)
      toast.error(
        result.error === 'CredentialsSignin' ? 'Invalid email or password.' : 'Login failed.',
      );
    else if (result?.ok && result.url) window.location.href = result.url;
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

    // Check if email already exists
    const checkRes = await fetch(`/api/auth/check-email?email=${encodeURIComponent(signupEmail)}`);
    const checkData = await checkRes.json();
    if (checkData.exists) {
      toast.error('Email is already registered.');
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
        role: 'STUDENT', // default role
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Signup failed.' }));
      toast.error(error || 'Signup failed.');
      return;
    }

    toast.success('Account created! Logging you in...');
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    const result = await signIn('credentials', {
      email: signupEmail,
      password: signupPassword,
      redirect: false,
      callbackUrl: '/dashboard',
    });
    setLoading(false);

    if (result?.ok && result.url) window.location.href = result.url;
    else toast.error('Signup succeeded but login failed.');
  };

  const isLoginEmailValid = isValidEmail(loginEmail);
  const isSignupEmailValid = isValidEmail(signupEmail);

  return (
    <div className="from-background to-primary/10 relative flex min-h-screen w-full items-center justify-center bg-gradient-to-tr">
      <div className="bg-card relative z-10 mx-2 w-full max-w-[400px] rounded-2xl border px-5 py-8 shadow-2xl">
        {/* Floating Login Test Menu */}
        <div
          style={{ right: '-150px' }}
          className="absolute top-1/2 z-50 flex -translate-y-1/2 flex-col gap-2 rounded-xl border bg-white/90 p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800/90"
        >
          <span className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
            Test Logins
          </span>
          {['faculty', 'student', 'admin', 'TA'].map((role) => (
            <button
              key={role}
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                role === 'faculty'
                  ? 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                  : role === 'student'
                    ? 'bg-green-100 text-green-900 hover:bg-green-200'
                    : role === 'admin'
                      ? 'bg-purple-100 text-purple-900 hover:bg-purple-200'
                      : 'bg-yellow-100 text-yellow-900 hover:bg-yellow-200'
              }`}
              onClick={() => {
                setLoginEmail(`${role}@example.com`);
                setLoginPassword('password123');
                setMode('login');
                setTimeout(() => loginEmailRef.current?.focus(), 10);
              }}
            >
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </button>
          ))}
        </div>
        <h1 className="p-2 text-center text-2xl font-bold text-gray-900">AFCT Dashboard</h1>
        <div className="bg-secondary/20 my-6 flex justify-center gap-x-2 rounded-xl shadow">
          {['login', 'signup'].map((m) => (
            <button
              key={m}
              type="button"
              className={`flex-1 rounded-xl py-1 text-base transition-all ${
                mode === m ? 'bg-secondary text-white shadow' : 'text-gray-900 dark:text-gray-400'
              }`}
              onClick={() => setMode(m as 'login' | 'signup')}
              disabled={mode === m}
            >
              {m === 'login' ? 'Login' : 'Sign Up'}
            </button>
          ))}
        </div>

        <AnimatePresence initial={false} mode="wait">
          {mode === 'login' ? (
            <motion.form
              key="login"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
              onSubmit={handleLogin}
              className="space-y-5"
            >
              <InputGroup
                label="Email"
                value={loginEmail}
                setValue={setLoginEmail}
                type="email"
                showStatus
                isValid={isValidEmail(loginEmail)}
              />
              <InputGroup
                label="Password"
                value={loginPassword}
                setValue={setLoginPassword}
                type={showLoginPassword ? 'text' : 'password'}
                showEye
                isPasswordVisible={showLoginPassword}
                togglePasswordVisibility={() => setShowLoginPassword((v) => !v)}
              />

              <Button type="submit" disabled={loading || !isLoginEmailValid}>
                {loading ? 'Logging in...' : 'Login'}
              </Button>
            </motion.form>
          ) : (
            <motion.form
              key="signup"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
              onSubmit={handleSignup}
              className="space-y-5"
            >
              <InputGroup label="First Name" value={signupFirst} setValue={setSignupFirst} />
              <InputGroup label="Last Name" value={signupLast} setValue={setSignupLast} />
              <InputGroup
                label="Email"
                value={signupEmail}
                setValue={(val) => {
                  setSignupEmail(val);
                  setIsEmailAvailable(null); // reset availability state while typing
                }}
                type="email"
                showStatus
                isValid={isSignupEmailValid && isEmailAvailable === true}
                onBlur={() => checkEmailAvailability(signupEmail)}
                isChecking={isCheckingEmail}
                isAvailable={isEmailAvailable}
              />

              <InputGroup
                label="Password"
                value={signupPassword}
                setValue={setSignupPassword}
                type={showSignupPassword ? 'text' : 'password'}
                showStatus
                isValid={signupPassword.length > 0 && isStrongPassword(signupPassword)}
                showEye
                isPasswordVisible={showSignupPassword}
                togglePasswordVisibility={() => setShowSignupPassword((v) => !v)}
              />

              <InputGroup
                label="Confirm Password"
                value={signupConfirm}
                setValue={setSignupConfirm}
                type={showSignupConfirm ? 'text' : 'password'}
                showEye
                isPasswordVisible={showSignupConfirm}
                togglePasswordVisibility={() => setShowSignupConfirm((v) => !v)}
                showStatus
                isValid={signupConfirm.length > 0 && signupConfirm === signupPassword}
              />

              <div className="flex justify-center">
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm italic"
                    >
                      <Info size={16} />
                      Password Requirements
                    </button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content className="z-50 w-64 rounded border bg-white p-3 text-sm shadow-xl dark:bg-gray-800">
                      <p className="text-muted-foreground mb-2 font-semibold">
                        Password must contain:
                      </p>
                      <ul className="space-y-1">
                        {passwordRules.map((rule) => {
                          const passed = rule.test(signupPassword);
                          return (
                            <li
                              key={rule.label}
                              className={passed ? 'text-green-600' : 'text-red-500'}
                            >
                              {passed ? '✔' : '✘'} {rule.label}
                            </li>
                          );
                        })}
                      </ul>
                      <Popover.Arrow className="fill-current text-white dark:text-gray-800" />
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </div>

              <Button
                type="submit"
                disabled={
                  loading ||
                  !signupFirst ||
                  !signupLast ||
                  !isSignupEmailValid ||
                  !signupPassword ||
                  !signupConfirm
                }
              >
                {loading ? 'Signing up...' : 'Sign Up'}
              </Button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
