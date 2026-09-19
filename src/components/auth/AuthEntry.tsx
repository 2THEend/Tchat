import { useState, useEffect } from 'react';
import { 
  Mail, 
  AtSign, 
  Globe, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  ArrowLeft, 
  KeyRound, 
  ShieldCheck, 
  Clock,
  Eye,
  EyeOff
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

interface AuthEntryProps {
  onAuthSuccess: () => void;
  initialView?: AuthView;
  initialError?: string | null;
  onClearUrlParams?: () => void;
}

export function AuthEntry({ 
  onAuthSuccess, 
  initialView = 'signin', 
  initialError = null,
  onClearUrlParams 
}: AuthEntryProps) {
  const [view, setView] = useState<AuthView>(initialView);
  const [method, setMethod] = useState<AuthMethod>('email');
  const [mode, setMode] = useState<AuthMode>('signin');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Active Legal Document Modal
  const [legalDoc, setLegalDoc] = useState<LegalDocumentType | null>(null);

  // Form Fields
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
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

  const handleMethodChange = (newMethod: AuthMethod) => {
    setMethod(newMethod);
    clearMessages();
  };

  // Google OAuth flow
  const handleGoogleAuth = async () => {
    clearMessages();
    setLoading(true);
    const res = await signInWithGoogle();
    if (!res.success) {
      setLoading(false);
      setErrorMessage(res.error || 'Failed to initialize Google authentication.');
    }
    // Supabase redirects on success
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
      const emailVal = validateEmail(recoveryEmail);
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
        const res = await signUpWithUsername(username, recoveryEmail, password);
        if (res.success) {
          if (res.needsEmailVerification) {
            setPendingVerificationEmail(recoveryEmail.trim().toLowerCase());
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
        setNoticeMessage('Password updated successfully! Accessing your account...');
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
        setNoticeMessage('Verification email sent! Please check your inbox and spam folder.');
        setResendCooldown(60);
      } else {
        setErrorMessage(res.error || 'Failed to resend verification email.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="auth-entry-container" className="flex-1 flex flex-col justify-between px-6 py-8 overflow-y-auto">
      {/* 1. Header Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-stone-400">
            {view === 'reset_password'
              ? 'Account Security'
              : view === 'forgot_password'
              ? 'Password Recovery'
              : view === 'verify_email'
              ? 'Email Verification'
              : 'Enter Tchat'}
          </span>
          {view !== 'signin' && view !== 'signup' && (
            <button
              id="btn-back-to-signin"
              type="button"
              onClick={() => {
                switchView('signin');
                setMode('signin');
              }}
              className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Back to sign in</span>
            </button>
          )}
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-stone-100">
          {view === 'reset_password'
            ? 'Set new password'
            : view === 'forgot_password'
            ? 'Recover your account'
            : view === 'verify_email'
            ? 'Check your email'
            : mode === 'signin'
            ? 'Welcome back'
            : 'Create an account'}
        </h1>

        <p className="text-xs text-stone-400 leading-relaxed">
          {view === 'reset_password'
            ? 'Choose a strong, secure password for your Tchat identity.'
            : view === 'forgot_password'
            ? 'Enter your registered recovery email to receive a password reset link.'
            : view === 'verify_email'
            ? `We've sent an activation link to ${pendingVerificationEmail || 'your email'}.`
            : 'Intentional, temporary human interaction. Connect authentically today.'}
        </p>
      </div>

      {/* 2. Main Content Body */}
      <div className="my-6 space-y-4">
        {/* Error Notification */}
        {errorMessage && (
          <div 
            id="auth-error-banner"
            role="alert"
            className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs leading-snug"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {/* Success Notification */}
        {noticeMessage && (
          <div 
            id="auth-notice-banner"
            role="status"
            className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs leading-snug"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <div className="flex-1">{noticeMessage}</div>
          </div>
        )}

        {/* VIEW A: RESET PASSWORD (Recovery Session) */}
        {view === 'reset_password' && (
          <form id="reset-password-form" onSubmit={handleResetPasswordSubmit} className="space-y-3.5">
            <div className="space-y-1.5">
              <label htmlFor="input-new-password" className="text-[11px] font-medium text-stone-300 block">
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
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                />
                <button
                  id="btn-toggle-new-password"
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 p-1 transition-colors cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="input-confirm-password" className="text-[11px] font-medium text-stone-300 block">
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
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                />
                <button
                  id="btn-toggle-confirm-password"
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 p-1 transition-colors cursor-pointer"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <button
              id="btn-submit-reset-password"
              type="submit"
              disabled={loading}
              className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
              ) : (
                <>
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Update Password</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* VIEW B: FORGOT PASSWORD */}
        {view === 'forgot_password' && (
          <form id="forgot-password-form" onSubmit={handleForgotPasswordSubmit} className="space-y-3.5">
            <div className="p-3 rounded-xl bg-stone-900/70 border border-stone-800 text-[11px] text-stone-400 leading-relaxed">
              <span className="font-semibold text-stone-300 block mb-0.5">Account Recovery Architecture</span>
              Tchat accounts are recovered through the email address registered during creation. Usernames cannot be directly emailed for security and privacy.
            </div>

            <div className="space-y-1.5">
              <label htmlFor="input-recovery-address" className="text-[11px] font-medium text-stone-300 block">
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
                className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
              />
            </div>

            <button
              id="btn-submit-forgot-password"
              type="submit"
              disabled={loading}
              className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
              ) : (
                <span>Send Password Reset Link</span>
              )}
            </button>
          </form>
        )}

        {/* VIEW C: VERIFY EMAIL PENDING */}
        {view === 'verify_email' && (
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-2xl bg-stone-900/70 border border-stone-800 text-center space-y-3">
              <div className="w-10 h-10 mx-auto rounded-xl bg-stone-800 flex items-center justify-center text-stone-300">
                <Mail className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-stone-200">
                  Verification Link Dispatched
                </p>
                <p className="text-[11px] text-stone-400 max-w-xs mx-auto leading-relaxed">
                  Please open the confirmation link sent to <span className="text-stone-200 font-mono">{pendingVerificationEmail}</span>. Once confirmed, you can sign in directly.
                </p>
              </div>

              <div className="pt-2">
                <button
                  id="btn-resend-verification"
                  type="button"
                  onClick={handleResendVerification}
                  disabled={loading || resendCooldown > 0}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-300" />
                  ) : resendCooldown > 0 ? (
                    <>
                      <Clock className="w-3.5 h-3.5 text-stone-400" />
                      <span>Resend available in {resendCooldown}s</span>
                    </>
                  ) : (
                    <span>Resend Verification Email</span>
                  )}
                </button>
              </div>
            </div>

            <button
              id="btn-return-signin-verified"
              type="button"
              onClick={() => {
                switchView('signin');
                setMode('signin');
              }}
              className="w-full py-2 text-center text-xs text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            >
              I have verified my email → Sign in
            </button>
          </div>
        )}

        {/* VIEW D & E: STANDARD SIGN IN & SIGN UP */}
        {(view === 'signin' || view === 'signup') && (
          <>
            {/* Method Tabs */}
            <div 
              id="auth-method-selector"
              role="tablist"
              aria-label="Authentication methods"
              className="grid grid-cols-3 gap-1 p-1 bg-stone-900 border border-stone-800 rounded-xl"
            >
              {[
                { id: 'email', label: 'Email', icon: Mail },
                { id: 'username', label: 'Username', icon: AtSign },
                { id: 'google', label: 'Google', icon: Globe },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = method === item.id;
                return (
                  <button
                    key={item.id}
                    id={`tab-method-${item.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => handleMethodChange(item.id as AuthMethod)}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'bg-stone-800 text-stone-100 shadow-sm'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 stroke-[2]" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Method 1: Google OAuth */}
            {method === 'google' && (
              <div className="space-y-4 py-2">
                <div className="p-4 rounded-2xl bg-stone-900/60 border border-stone-800/80 text-center space-y-3">
                  <p className="text-xs text-stone-400 leading-relaxed">
                    Authenticate securely with your Google account. Your email is kept private and will never be exposed on your public Tchat profile.
                  </p>
                  <button
                    id="btn-google-auth"
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
                    ) : (
                      <Globe className="w-4 h-4 stroke-[2]" />
                    )}
                    <span>Continue with Google</span>
                  </button>
                </div>
              </div>
            )}

            {/* Method 2: Email + Password */}
            {method === 'email' && (
              <form id="email-auth-form" onSubmit={handleEmailSubmit} className="space-y-3.5">
                <div className="space-y-1.5">
                  <label htmlFor="input-email" className="text-[11px] font-medium text-stone-300 block">
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
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="input-email-password" className="text-[11px] font-medium text-stone-300 block">
                      Password
                    </label>
                    {mode === 'signin' && (
                      <button
                        id="btn-forgot-password-email"
                        type="button"
                        onClick={() => switchView('forgot_password')}
                        className="text-[10px] text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
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
                      placeholder={mode === 'signup' ? 'Min 8 characters (letters & numbers)' : '••••••••'}
                      className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                    />
                    <button
                      id="btn-toggle-email-password"
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 p-1 transition-colors cursor-pointer"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <label htmlFor="input-email-confirm" className="text-[11px] font-medium text-stone-300 block">
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
                        className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                      />
                      <button
                        id="btn-toggle-email-confirm"
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 p-1 transition-colors cursor-pointer"
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  id="btn-submit-email"
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
                  ) : (
                    <span>{mode === 'signin' ? 'Sign in with Email' : 'Create Account'}</span>
                  )}
                </button>
              </form>
            )}

            {/* Method 3: Username + Password */}
            {method === 'username' && (
              <form id="username-auth-form" onSubmit={handleUsernameSubmit} className="space-y-3.5">
                <div className="space-y-1.5">
                  <label htmlFor="input-username" className="text-[11px] font-medium text-stone-300 block">
                    Username
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-xs text-stone-500 font-mono">
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
                      placeholder="handle"
                      className="w-full pl-7 pr-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                    />
                  </div>
                </div>

                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="input-recovery-email" className="text-[11px] font-medium text-stone-300 block">
                        Recovery email address
                      </label>
                      <span className="text-[10px] text-stone-400 font-normal">Required for recovery</span>
                    </div>
                    <input
                      id="input-recovery-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={recoveryEmail}
                      onChange={(e) => setRecoveryEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="input-username-password" className="text-[11px] font-medium text-stone-300 block">
                      Password
                    </label>
                    {mode === 'signin' && (
                      <button
                        id="btn-forgot-password-username"
                        type="button"
                        onClick={() => switchView('forgot_password')}
                        className="text-[10px] text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
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
                      placeholder={mode === 'signup' ? 'Min 8 characters (letters & numbers)' : '••••••••'}
                      className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                    />
                    <button
                      id="btn-toggle-username-password"
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 p-1 transition-colors cursor-pointer"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <label htmlFor="input-username-confirm" className="text-[11px] font-medium text-stone-300 block">
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
                        className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
                      />
                      <button
                        id="btn-toggle-username-confirm"
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 p-1 transition-colors cursor-pointer"
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  id="btn-submit-username"
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
                  ) : (
                    <span>{mode === 'signin' ? 'Sign in with Username' : 'Create Account'}</span>
                  )}
                </button>
              </form>
            )}

            {/* Terms of Service & Privacy Policy Acknowledgement on Signup */}
            {mode === 'signup' && (
              <div className="pt-2 text-center text-[11px] text-stone-400 leading-normal">
                By creating an account, you acknowledge Tchat's{' '}
                <button
                  id="btn-view-terms"
                  type="button"
                  onClick={() => setLegalDoc('terms')}
                  className="text-stone-300 underline underline-offset-2 hover:text-white cursor-pointer"
                >
                  Terms of Service
                </button>{' '}
                and{' '}
                <button
                  id="btn-view-privacy"
                  type="button"
                  onClick={() => setLegalDoc('privacy')}
                  className="text-stone-300 underline underline-offset-2 hover:text-white cursor-pointer"
                >
                  Privacy Policy
                </button>
                .
              </div>
            )}
          </>
        )}
      </div>

      {/* 3. Footer: Switch Mode (Sign In <-> Sign Up) */}
      {(view === 'signin' || view === 'signup') && (
        <div className="pt-4 border-t border-stone-900 text-center">
          <button
            id="toggle-auth-mode-btn"
            type="button"
            onClick={() => {
              const nextMode = mode === 'signin' ? 'signup' : 'signin';
              setMode(nextMode);
              setView(nextMode);
              clearMessages();
            }}
            className="text-xs text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
          >
            {mode === 'signin' ? (
              <span>Don't have an account yet? <span className="text-stone-200 font-semibold underline underline-offset-2">Create one</span></span>
            ) : (
              <span>Already have an account? <span className="text-stone-200 font-semibold underline underline-offset-2">Sign in</span></span>
            )}
          </button>
        </div>
      )}

      {/* Legal Modal Drawer */}
      {legalDoc && (
        <LegalModal 
          type={legalDoc} 
          onClose={() => setLegalDoc(null)} 
        />
      )}
    </div>
  );
}
