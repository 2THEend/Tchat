import { useState, useEffect } from 'react';
import { 
  Mail, 
  AtSign, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  ArrowLeft, 
  KeyRound, 
  Clock,
  Eye,
  EyeOff,
  ArrowRight
} from 'lucide-react';
import { AuthMethod, AuthMode, AuthView, LegalDocumentType } from '../../domains/auth/types';
import { 
  signInWithGoogle, 
  signInWithEmail, 
  signUpWithEmail, 
  signInWithUsername, 
  signUpWithUsername,
  sendPasswordResetEmail,
  updatePassword,
  resendVerificationEmail
} from '../../domains/auth/authService';
import { validatePassword, validatePasswordConfirmation, validateEmail } from '../../domains/auth/validation';
import { validateUsername } from '../../domains/identity/validation';
import { LegalModal } from './LegalModal';
import { PWAInstallButton } from '../pwa/PWAInstallButton';

interface AuthEntryProps {
  onAuthSuccess: () => void;
  initialView?: AuthView;
  initialError?: string | null;
  onClearUrlParams?: () => void;
}

function GoogleMark() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.05l3.3 2.56c1.92-1.77 3.04-4.38 3.04-7.51 0-.72-.06-1.42-.19-2H12z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.89 6.62-2.42l-3.3-2.56c-.91.61-2.08.98-3.32.98-2.55 0-4.71-1.72-5.48-4.04H3.11v2.64C4.76 19.87 8.12 22 12 22z"
      />
      <path
        fill="#4A90E2"
        d="M6.52 13.96A5.96 5.96 0 0 1 6.2 12c0-.68.12-1.34.32-1.96V7.4H3.11A9.98 9.98 0 0 0 2 12c0 1.61.39 3.14 1.11 4.6l3.41-2.64z"
      />
      <path
        fill="#FBBC05"
        d="M12 5.98c1.47 0 2.79.51 3.83 1.5l2.87-2.87C16.95 2.98 14.7 2 12 2 8.12 2 4.76 4.13 3.11 7.4l3.41 2.64C7.29 7.7 9.45 5.98 12 5.98z"
      />
    </svg>
  );
}

export function AuthEntry({ 
  onAuthSuccess, 
  initialView = 'signin', 
  initialError = null,
  onClearUrlParams 
}: AuthEntryProps) {
  const [view, setView] = useState<AuthView>(initialView);
  const [method, setMethod] = useState<AuthMethod>('email');
  const [mode, setMode] = useState<AuthMode>(initialView === 'signup' ? 'signup' : 'signin');
  const [loading, setLoading] = useState<boolean>(false);
  const [googleLoading, setGoogleLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Active Legal Document Modal
  const [legalDoc, setLegalDoc] = useState<LegalDocumentType | null>(null);

  // Form Fields (email is shared across Email Auth, Username Recovery Email, and Password Reset)
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('');

  // Resend cooldown timer in seconds
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  useEffect(() => {
    if (initialError) {
      setErrorMessage(initialError);
    }
  }, [initialError]);

  useEffect(() => {
    if (initialView) {
      setView(initialView);
      if (initialView === 'signin' || initialView === 'signup') {
        setMode(initialView);
      }
    }
  }, [initialView]);

  // Resend countdown effect
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const clearMessages = () => {
    setErrorMessage(null);
    setNoticeMessage(null);
    if (onClearUrlParams) {
      onClearUrlParams();
    }
  };

  const switchView = (newView: AuthView) => {
    setView(newView);
    clearMessages();
  };

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    setView(nextMode);
    setConfirmPassword('');
    clearMessages();
  };

  const handleMethodChange = (newMethod: AuthMethod) => {
    setMethod(newMethod);
    clearMessages();
  };

  // Google OAuth flow
  const handleGoogleAuth = async () => {
    clearMessages();
    setGoogleLoading(true);
    setLoading(true);
    const res = await signInWithGoogle();
    if (!res.success) {
      setGoogleLoading(false);
      setLoading(false);
      setErrorMessage(res.error || 'Failed to initialize Google authentication.');
    }
  };

  // Email Submit (Sign In or Sign Up)
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    const emailVal = validateEmail(email);
    if (!emailVal.isValid) {
      setErrorMessage(emailVal.error || 'Please enter a valid email.');
      return;
    }

    if (mode === 'signup') {
      const passVal = validatePassword(password);
      if (!passVal.isValid) {
        setErrorMessage(passVal.error || 'Invalid password.');
        return;
      }

      const confirmVal = validatePasswordConfirmation(password, confirmPassword);
      if (!confirmVal.isValid) {
        setErrorMessage(confirmVal.error || 'Passwords do not match.');
        return;
      }
    } else {
      if (!password) {
        setErrorMessage('Please enter your password.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const res = await signInWithEmail(email, password);
        if (res.success) {
          onAuthSuccess();
        } else {
          setErrorMessage(res.error || 'Invalid credentials.');
        }
      } else {
        const res = await signUpWithEmail(email, password);
        if (res.success) {
          if (res.needsEmailVerification) {
            setPendingVerificationEmail(email.trim().toLowerCase());
            setView('verify_email');
            setResendCooldown(60);
          } else {
            onAuthSuccess();
          }
        } else {
          setErrorMessage(res.error || 'Sign up failed.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Username Submit (Sign In or Sign Up)
  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    const userVal = validateUsername(username);
    if (!userVal.isValid) {
      setErrorMessage(userVal.error || 'Please enter a valid username.');
      return;
    }

    if (mode === 'signup') {
      const emailVal = validateEmail(email);
      if (!emailVal.isValid) {
        setErrorMessage(emailVal.error || 'A valid recovery email address is required.');
        return;
      }

      const passVal = validatePassword(password);
      if (!passVal.isValid) {
        setErrorMessage(passVal.error || 'Invalid password.');
        return;
      }

      const confirmVal = validatePasswordConfirmation(password, confirmPassword);
      if (!confirmVal.isValid) {
        setErrorMessage(confirmVal.error || 'Passwords do not match.');
        return;
      }
    } else {
      if (!password) {
        setErrorMessage('Please enter your password.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const res = await signInWithUsername(username, password);
        if (res.success) {
          onAuthSuccess();
        } else {
          setErrorMessage(res.error || 'Sign in failed.');
        }
      } else {
        const res = await signUpWithUsername(username, email, password);
        if (res.success) {
          if (res.needsEmailVerification) {
            setPendingVerificationEmail(email.trim().toLowerCase());
            setView('verify_email');
            setResendCooldown(60);
          } else {
            onAuthSuccess();
          }
        } else {
          setErrorMessage(res.error || 'Registration failed.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Submit
  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    const emailVal = validateEmail(email);
    if (!emailVal.isValid) {
      setErrorMessage(emailVal.error || 'Please enter a valid recovery email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await sendPasswordResetEmail(email);
      if (res.success) {
        setNoticeMessage(
          'If an account exists with this email, password recovery instructions have been sent. Please check your inbox.'
        );
      } else {
        setErrorMessage(res.error || 'Failed to send recovery instructions.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Reset Password Submit (inside recovery session)
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    const passVal = validatePassword(password);
    if (!passVal.isValid) {
      setErrorMessage(passVal.error || 'Invalid password.');
      return;
    }

    const confirmVal = validatePasswordConfirmation(password, confirmPassword);
    if (!confirmVal.isValid) {
      setErrorMessage(confirmVal.error || 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await updatePassword(password);
      if (res.success) {
        setNoticeMessage('Password updated. Entering Tchat...');
        setTimeout(() => {
          onAuthSuccess();
        }, 800);
      } else {
        setErrorMessage(res.error || 'Failed to update password.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Resend verification email
  const handleResendVerification = async () => {
    if (resendCooldown > 0 || !pendingVerificationEmail) return;
    clearMessages();

    setLoading(true);
    try {
      const res = await resendVerificationEmail(pendingVerificationEmail);
      if (res.success) {
        setNoticeMessage('Verification email sent. Please check your inbox and spam folder.');
        setResendCooldown(60);
      } else {
        setErrorMessage(res.error || 'Failed to resend verification email.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isStandardAuthView = view === 'signin' || view === 'signup';

  return (
    <div 
      id="auth-entry-container" 
      className="flex-1 flex flex-col justify-between px-6 pt-5 pb-7 sm:px-7 sm:pt-6 sm:pb-8 overflow-y-auto no-scrollbar select-none"
    >
      {/* Top Bar: Brand Identity & Contextual Actions */}
      <div className="space-y-6">
        <div className="flex items-center justify-between min-h-[40px]">
          <div className="flex items-center gap-2.5">
            <div 
              aria-hidden="true"
              className="w-8 h-8 rounded-[10px] bg-stone-900 border border-stone-800/90 flex items-center justify-center text-stone-100 font-display text-lg leading-none shadow-sm"
            >
              T
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-stone-100">
              Tchat
            </span>
          </div>

          {isStandardAuthView ? (
            <PWAInstallButton variant="compact" />
          ) : (
            <button
              id="btn-back-to-signin"
              type="button"
              onClick={() => {
                switchView('signin');
                setMode('signin');
              }}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-2.5 py-1.5 -mr-2 rounded-xl text-xs font-medium text-stone-400 hover:text-stone-100 hover:bg-stone-900/60 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to sign in</span>
            </button>
          )}
        </div>

        {/* Editorial Threshold Heading */}
        <div className="space-y-2.5 pt-1">
          <h1 className="font-display text-[34px] sm:text-[36px] font-normal leading-[1.08] tracking-tight text-stone-100">
            {view === 'reset_password'
              ? 'Set a new password.'
              : view === 'forgot_password'
              ? 'Recover your account.'
              : view === 'verify_email'
              ? 'Check your inbox.'
              : mode === 'signin'
              ? 'Be here when you mean to be.'
              : 'Start with intention.'}
          </h1>

          <p className="text-[14px] text-stone-400 leading-relaxed max-w-[34ch]">
            {view === 'reset_password'
              ? 'Choose a strong password to secure your Tchat identity.'
              : view === 'forgot_password'
              ? 'Enter the recovery email linked to your account to receive a reset link.'
              : view === 'verify_email'
              ? `We sent an activation link to ${pendingVerificationEmail || 'your email'}.`
              : mode === 'signin'
              ? 'Step into today’s conversations and temporary circles.'
              : 'Create a calm identity for direct, temporary human interaction.'}
          </p>

          {isStandardAuthView && (
            <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-stone-500">
              <span>1:1 by default</span>
              <span aria-hidden="true">·</span>
              <span>Ephemeral media</span>
              <span aria-hidden="true">·</span>
              <span>No engagement feed</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Authentication Surface */}
      <div className="my-auto py-5 space-y-4">
        {/* Error Notification */}
        {errorMessage && (
          <div 
            id="auth-error-banner"
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-950/35 border border-rose-800/40 text-rose-200 text-xs leading-relaxed"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1 select-text">{errorMessage}</div>
          </div>
        )}

        {/* Success Notification */}
        {noticeMessage && (
          <div 
            id="auth-notice-banner"
            role="status"
            className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-emerald-950/35 border border-emerald-800/40 text-emerald-200 text-xs leading-relaxed"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <div className="flex-1 select-text">{noticeMessage}</div>
          </div>
        )}

        {/* VIEW A: RESET PASSWORD (Recovery Session) */}
        {view === 'reset_password' && (
          <form id="reset-password-form" onSubmit={handleResetPasswordSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="input-new-password" className="text-xs font-medium text-stone-300 block">
                New password
              </label>
              <div className="relative">
                <input
                  id="input-new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters (letters & numbers)"
                  className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                />
                <button
                  id="btn-toggle-new-password"
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="input-confirm-password" className="text-xs font-medium text-stone-300 block">
                Confirm new password
              </label>
              <div className="relative">
                <input
                  id="input-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                />
                <button
                  id="btn-toggle-confirm-password"
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              id="btn-submit-reset-password"
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-1 flex items-center justify-center gap-2 px-4 rounded-xl bg-stone-100 hover:bg-white active:scale-[0.99] text-stone-950 text-[13px] font-semibold tracking-tight transition-all disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Update password</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* VIEW B: FORGOT PASSWORD */}
        {view === 'forgot_password' && (
          <form id="forgot-password-form" onSubmit={handleForgotPasswordSubmit} className="space-y-4">
            <p className="text-xs text-stone-400 leading-relaxed">
              Accounts are recovered via your registered email address. Usernames remain public handles and are never emailed directly.
            </p>

            <div className="space-y-1.5">
              <label htmlFor="input-recovery-address" className="text-xs font-medium text-stone-300 block">
                Recovery email address
              </label>
              <input
                id="input-recovery-address"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full h-11 px-3.5 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
              />
            </div>

            <button
              id="btn-submit-forgot-password"
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-1 flex items-center justify-center gap-2 px-4 rounded-xl bg-stone-100 hover:bg-white active:scale-[0.99] text-stone-950 text-[13px] font-semibold tracking-tight transition-all disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
              ) : (
                <span>Send reset link</span>
              )}
            </button>
          </form>
        )}

        {/* VIEW C: VERIFY EMAIL PENDING */}
        {view === 'verify_email' && (
          <div className="space-y-4 py-1">
            <div className="p-5 rounded-2xl bg-stone-900/60 border border-stone-800/80 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-stone-800/90 flex items-center justify-center text-stone-200">
                <Mail className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-stone-100">
                  Confirmation link sent
                </p>
                <p className="text-xs text-stone-400 leading-relaxed">
                  Open the verification link sent to{' '}
                  <span className="text-stone-200 font-mono select-text">{pendingVerificationEmail}</span>{' '}
                  to activate your account, then return here to sign in.
                </p>
              </div>

              <button
                id="btn-resend-verification"
                type="button"
                onClick={handleResendVerification}
                disabled={loading || resendCooldown > 0}
                className="w-full h-11 flex items-center justify-center gap-2 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-stone-300" />
                ) : resendCooldown > 0 ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-stone-400" />
                    <span className="tabular-nums">Resend available in {resendCooldown}s</span>
                  </>
                ) : (
                  <span>Resend verification email</span>
                )}
              </button>
            </div>

            <button
              id="btn-return-signin-verified"
              type="button"
              onClick={() => {
                switchView('signin');
                setMode('signin');
              }}
              className="w-full h-11 flex items-center justify-center gap-1.5 text-xs font-medium text-stone-300 hover:text-white transition-colors cursor-pointer"
            >
              <span>I’ve verified my email</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* VIEW D & E: STANDARD SIGN IN & SIGN UP */}
        {isStandardAuthView && (
          <div className="space-y-4">
            {/* Primary Mode Switcher (Sign in vs Create account) */}
            <div
              id="auth-mode-selector"
              role="tablist"
              aria-label="Account mode"
              className="grid grid-cols-2 gap-1 p-1 bg-stone-900/90 border border-stone-800/80 rounded-xl"
            >
              <button
                id="tab-mode-signin"
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                onClick={() => handleModeChange('signin')}
                className={`h-9 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer ${
                  mode === 'signin'
                    ? 'bg-stone-800 text-stone-100 shadow-sm'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                Sign in
              </button>
              <button
                id="tab-mode-signup"
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                onClick={() => handleModeChange('signup')}
                className={`h-9 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-stone-800 text-stone-100 shadow-sm'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                Create account
              </button>
            </div>

            {/* Credential Identifier Selector (Email vs Username) */}
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-xs font-medium text-stone-300">
                {method === 'username'
                  ? mode === 'signup'
                    ? 'Claim your handle'
                    : 'Username'
                  : 'Email address'}
              </span>
              <div
                id="auth-method-selector"
                role="tablist"
                aria-label="Credential type"
                className="inline-flex items-center gap-1 p-0.5 bg-stone-900/80 border border-stone-800/80 rounded-lg"
              >
                <button
                  id="tab-method-email"
                  type="button"
                  role="tab"
                  aria-selected={method === 'email'}
                  onClick={() => handleMethodChange('email')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    method === 'email'
                      ? 'bg-stone-800 text-stone-100'
                      : 'text-stone-400 hover:text-stone-200'
                  }`}
                >
                  <Mail className="w-3 h-3" />
                  <span>Email</span>
                </button>
                <button
                  id="tab-method-username"
                  type="button"
                  role="tab"
                  aria-selected={method === 'username'}
                  onClick={() => handleMethodChange('username')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    method === 'username'
                      ? 'bg-stone-800 text-stone-100'
                      : 'text-stone-400 hover:text-stone-200'
                  }`}
                >
                  <AtSign className="w-3 h-3" />
                  <span>Username</span>
                </button>
              </div>
            </div>

            {/* Method: Email + Password */}
            {method !== 'username' && (
              <form id="email-auth-form" onSubmit={handleEmailSubmit} className="space-y-3.5">
                <div>
                  <label htmlFor="input-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    id="input-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full h-11 px-3.5 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="input-email-password" className="text-xs font-medium text-stone-300 block">
                      Password
                    </label>
                    {mode === 'signin' && (
                      <button
                        id="btn-forgot-password-email"
                        type="button"
                        onClick={() => switchView('forgot_password')}
                        className="text-xs text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="input-email-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
                      className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                    />
                    <button
                      id="btn-toggle-email-password"
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <label htmlFor="input-email-confirm" className="text-xs font-medium text-stone-300 block">
                      Confirm password
                    </label>
                    <div className="relative">
                      <input
                        id="input-email-confirm"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat password"
                        className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                      />
                      <button
                        id="btn-toggle-email-confirm"
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  id="btn-submit-email"
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 mt-1 flex items-center justify-center gap-2 px-4 rounded-xl bg-stone-100 hover:bg-white active:scale-[0.99] text-stone-950 text-[13px] font-semibold tracking-tight transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading && !googleLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
                  ) : (
                    <span>{mode === 'signin' ? 'Sign in' : 'Create account'}</span>
                  )}
                </button>
              </form>
            )}

            {/* Method: Username + Password */}
            {method === 'username' && (
              <form id="username-auth-form" onSubmit={handleUsernameSubmit} className="space-y-3.5">
                <div>
                  <label htmlFor="input-username" className="sr-only">
                    Username
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3.5 flex items-center text-[14px] text-stone-500 font-mono">
                      @
                    </span>
                    <input
                      id="input-username"
                      type="text"
                      required
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      placeholder="username"
                      className="w-full h-11 pl-8 pr-3.5 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                    />
                  </div>
                </div>

                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="input-recovery-email" className="text-xs font-medium text-stone-300 block">
                        Recovery email
                      </label>
                      <span className="text-[11px] text-stone-500">Kept private</span>
                    </div>
                    <input
                      id="input-recovery-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full h-11 px-3.5 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="input-username-password" className="text-xs font-medium text-stone-300 block">
                      Password
                    </label>
                    {mode === 'signin' && (
                      <button
                        id="btn-forgot-password-username"
                        type="button"
                        onClick={() => switchView('forgot_password')}
                        className="text-xs text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="input-username-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
                      className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                    />
                    <button
                      id="btn-toggle-username-password"
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <label htmlFor="input-username-confirm" className="text-xs font-medium text-stone-300 block">
                      Confirm password
                    </label>
                    <div className="relative">
                      <input
                        id="input-username-confirm"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat password"
                        className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
                      />
                      <button
                        id="btn-toggle-username-confirm"
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  id="btn-submit-username"
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 mt-1 flex items-center justify-center gap-2 px-4 rounded-xl bg-stone-100 hover:bg-white active:scale-[0.99] text-stone-950 text-[13px] font-semibold tracking-tight transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading && !googleLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
                  ) : (
                    <span>{mode === 'signin' ? 'Sign in' : 'Create account'}</span>
                  )}
                </button>
              </form>
            )}

            {/* Direct Single-Tap Google Authentication */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-stone-900" />
                <span className="text-[11px] text-stone-500">or</span>
                <div className="h-px flex-1 bg-stone-900" />
              </div>

              <button
                id="btn-google-auth"
                type="button"
                onClick={handleGoogleAuth}
                disabled={loading}
                className="w-full h-11 flex items-center justify-center gap-2.5 px-4 rounded-xl bg-stone-900/75 hover:bg-stone-800/80 active:scale-[0.99] border border-stone-800/90 text-stone-200 text-[13px] font-medium tracking-tight transition-all disabled:opacity-50 cursor-pointer"
              >
                {googleLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-stone-300" />
                ) : (
                  <GoogleMark />
                )}
                <span>Continue with Google</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer: Mode Switch & Legal Acknowledgement */}
      {isStandardAuthView && (
        <div className="pt-4 border-t border-stone-900/80 space-y-3 text-center">
          <button
            id="toggle-auth-mode-btn"
            type="button"
            onClick={() => handleModeChange(mode === 'signin' ? 'signup' : 'signin')}
            className="text-xs text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
          >
            {mode === 'signin' ? (
              <span>
                New to Tchat?{' '}
                <span className="text-stone-200 font-medium underline underline-offset-4">
                  Create an account
                </span>
              </span>
            ) : (
              <span>
                Already have an account?{' '}
                <span className="text-stone-200 font-medium underline underline-offset-4">
                  Sign in
                </span>
              </span>
            )}
          </button>

          <p className="text-[11px] text-stone-500 leading-relaxed">
            By continuing, you agree to Tchat’s{' '}
            <button
              id="btn-view-terms"
              type="button"
              onClick={() => setLegalDoc('terms')}
              className="text-stone-400 underline underline-offset-2 hover:text-stone-200 transition-colors cursor-pointer"
            >
              Terms
            </button>{' '}
            and{' '}
            <button
              id="btn-view-privacy"
              type="button"
              onClick={() => setLegalDoc('privacy')}
              className="text-stone-400 underline underline-offset-2 hover:text-stone-200 transition-colors cursor-pointer"
            >
              Privacy Policy
            </button>
            .
          </p>
        </div>
      )}

      {/* Legal Modal Sheet */}
      {legalDoc && (
        <LegalModal 
          type={legalDoc} 
          onClose={() => setLegalDoc(null)} 
        />
      )}
    </div>
  );
}
