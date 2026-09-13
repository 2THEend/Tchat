import { useState, useEffect } from 'react';
import { User as UserIcon, Loader2, AlertCircle, Check, AtSign } from 'lucide-react';
import { 
  validateUsername, 
  validateDisplayName, 
  validateBio, 
  normalizeUsername 
} from '../../domains/identity/validation';
import { 
  isUsernameAvailable, 
  completeIdentitySetup 
} from '../../domains/identity/identityService';
import { TchatProfile } from '../../domains/identity/types';

interface IdentitySetupProps {
  userId: string;
  userEmail?: string | null;
  initialUsername?: string;
  initialDisplayName?: string;
  initialAvatarUrl?: string;
  onIdentityComplete: (profile: TchatProfile) => void;
}

export function IdentitySetup({ 
  userId, 
  userEmail, 
  initialUsername = '', 
  initialDisplayName = '',
  initialAvatarUrl = '',
  onIdentityComplete 
}: IdentitySetupProps) {
  const [username, setUsername] = useState(initialUsername);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);

  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<{
    valid: boolean;
    available?: boolean;
    message?: string;
  }>({ valid: false });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Debounced real-time username availability check
  useEffect(() => {
    const raw = username.trim();
    if (!raw) {
      setUsernameStatus({ valid: false });
      return;
    }

    const validation = validateUsername(raw);
    if (!validation.isValid) {
      setUsernameStatus({ valid: false, message: validation.error });
      return;
    }

    let isCurrent = true;
    setCheckingUsername(true);

    const timer = setTimeout(async () => {
      const res = await isUsernameAvailable(raw, userId);
      if (!isCurrent) return;

      setCheckingUsername(false);
      if (res.available) {
        setUsernameStatus({ 
          valid: true, 
          available: true, 
          message: `@${normalizeUsername(raw)} is available` 
        });
      } else {
        setUsernameStatus({ 
          valid: false, 
          available: false, 
          message: res.error || 'Username is already taken.' 
        });
      }
    }, 350);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [username, userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const userVal = validateUsername(username);
    if (!userVal.isValid) {
      setSubmitError(userVal.error || 'Invalid username.');
      return;
    }

    const nameVal = validateDisplayName(displayName);
    if (!nameVal.isValid) {
      setSubmitError(nameVal.error || 'Invalid display name.');
      return;
    }

    const bioVal = validateBio(bio);
    if (!bioVal.isValid) {
      setSubmitError(bioVal.error || 'Invalid bio.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await completeIdentitySetup(
        userId,
        {
          username: username.trim(),
          display_name: displayName.trim() || undefined,
          avatar_url: avatarUrl.trim() || undefined,
          bio: bio.trim() || undefined,
        },
        userEmail
      );

      if (res.success && res.profile) {
        onIdentityComplete(res.profile);
      } else {
        setSubmitError(res.error || 'Failed to complete identity setup.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="identity-setup-container" className="flex-1 flex flex-col justify-between px-6 py-8 overflow-y-auto">
      {/* Header */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold tracking-wider uppercase text-stone-400">
          Initial Setup
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-100">
          Create your Identity
        </h1>
        <p className="text-xs text-stone-400 leading-relaxed">
          Your Tchat identity represents you to connections. Only username is required.
        </p>
      </div>

      {/* Form */}
      <form id="identity-setup-form" onSubmit={handleSubmit} className="my-6 space-y-4">
        {submitError && (
          <div 
            id="identity-error-banner"
            role="alert"
            className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs leading-snug"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1">{submitError}</div>
          </div>
        )}

        {/* Avatar preview */}
        <div className="flex items-center gap-3.5 py-1">
          <div className="w-12 h-12 rounded-full bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-400 shrink-0 overflow-hidden">
            {avatarUrl ? (
              <img 
                src={avatarUrl} 
                alt="Avatar preview" 
                className="w-full h-full object-cover"
                onError={() => setAvatarUrl('')}
              />
            ) : (
              <UserIcon className="w-6 h-6 stroke-[1.5]" />
            )}
          </div>
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-stone-200">
              {displayName.trim() || username.trim() || 'Your Name'}
            </div>
            <div className="text-[11px] text-stone-500 font-mono">
              @{normalizeUsername(username) || 'handle'}
            </div>
          </div>
        </div>

        {/* Username field (REQUIRED) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="setup-username" className="text-[11px] font-medium text-stone-300">
              Username <span className="text-stone-400">*</span>
            </label>
            <span className="text-[10px] text-stone-500">3-24 chars, letters/numbers/_</span>
          </div>

          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-xs text-stone-500 font-mono">
              <AtSign className="w-3.5 h-3.5" />
            </span>
            <input
              id="setup-username"
              type="text"
              required
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="unique_handle"
              className="w-full pl-8 pr-9 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600 font-mono"
            />
            <div className="absolute inset-y-0 right-3 flex items-center">
              {checkingUsername && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />
              )}
              {!checkingUsername && usernameStatus.valid && usernameStatus.available && (
                <Check className="w-4 h-4 text-emerald-400 stroke-[2.5]" />
              )}
            </div>
          </div>

          {usernameStatus.message && (
            <p className={`text-[11px] ${usernameStatus.valid ? 'text-emerald-400' : 'text-rose-400'}`}>
              {usernameStatus.message}
            </p>
          )}
        </div>

        {/* Display Name field (OPTIONAL) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="setup-display-name" className="text-[11px] font-medium text-stone-300">
              Display Name
            </label>
            <span className="text-[10px] text-stone-500">Optional</span>
          </div>
          <input
            id="setup-display-name"
            type="text"
            maxLength={50}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alex Rivera"
            className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
          />
        </div>

        {/* Bio field (OPTIONAL) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="setup-bio" className="text-[11px] font-medium text-stone-300">
              Bio
            </label>
            <span className="text-[10px] text-stone-500">{bio.length}/200</span>
          </div>
          <textarea
            id="setup-bio"
            rows={2}
            maxLength={200}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A calm line about yourself..."
            className="w-full px-3.5 py-2 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600 resize-none"
          />
        </div>

        {/* Avatar URL field (OPTIONAL) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="setup-avatar" className="text-[11px] font-medium text-stone-300">
              Avatar Image URL
            </label>
            <span className="text-[10px] text-stone-500">Optional</span>
          </div>
          <input
            id="setup-avatar"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 focus:border-stone-600 focus:outline-none text-stone-100 text-xs placeholder:text-stone-600"
          />
        </div>

        {/* Submit button */}
        <button
          id="btn-complete-identity"
          type="submit"
          disabled={isSubmitting || checkingUsername || !usernameStatus.valid}
          className="w-full mt-4 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
          ) : (
            <span>Complete Setup & Continue</span>
          )}
        </button>
      </form>

      <div className="text-center text-[11px] text-stone-500">
        You can always edit your profile later in settings.
      </div>
    </div>
  );
}
