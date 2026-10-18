import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  User as UserIcon, 
  Loader2, 
  AlertCircle, 
  Check, 
  AtSign, 
  Camera, 
  Trash2, 
  LogOut 
} from 'lucide-react';
import { 
  validateUsername, 
  validateRequiredDisplayName, 
  validateBio, 
  normalizeUsername,
  validateAvatarFile 
} from '../../domains/identity/validation';
import { 
  isUsernameAvailable, 
  completeIdentitySetup,
  uploadAvatar 
} from '../../domains/identity/identityService';
import { TchatProfile } from '../../domains/identity/types';

interface IdentitySetupProps {
  userId: string;
  userEmail?: string | null;
  initialUsername?: string;
  initialDisplayName?: string;
  initialAvatarUrl?: string;
  onIdentityComplete: (profile: TchatProfile) => void;
  onSignOut?: () => void;
}

interface IdentityDraft {
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
}

export function IdentitySetup({ 
  userId, 
  userEmail, 
  initialUsername = '', 
  initialDisplayName = '',
  initialAvatarUrl = '',
  onIdentityComplete,
  onSignOut 
}: IdentitySetupProps) {
  // Session draft key to survive accidental refreshes or mobile backgrounding
  const draftKey = `tchat_identity_draft_${userId}`;

  // Safe draft initialization
  const loadDraft = (): Partial<IdentityDraft> => {
    try {
      if (typeof window === 'undefined') return {};
      const saved = sessionStorage.getItem(draftKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  };

  const draft = loadDraft();

  const [displayName, setDisplayName] = useState(draft.displayName ?? initialDisplayName);
  const [username, setUsername] = useState(draft.username ?? initialUsername);
  const [bio, setBio] = useState(draft.bio ?? '');
  
  // Avatar state: can be initial from OAuth, draft, or local file selection
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string>(draft.avatarUrl ?? initialAvatarUrl);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [hasRemovedAvatar, setHasRemovedAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Username checking & availability
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<{
    valid: boolean;
    available?: boolean;
    message?: string;
  }>({ valid: false });

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Persist form draft to sessionStorage on changes
  useEffect(() => {
    try {
      const payload: IdentityDraft = {
        username,
        displayName,
        bio,
        avatarUrl: selectedAvatarFile ? '' : avatarPreviewUrl,
      };
      sessionStorage.setItem(draftKey, JSON.stringify(payload));
    } catch {
      // Gracefully ignore storage quota
    }
  }, [username, displayName, bio, avatarPreviewUrl, selectedAvatarFile, draftKey]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (avatarPreviewUrl && avatarPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  // Real-time debounced username validation & availability check
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
      try {
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
            message: res.error || `@${normalizeUsername(raw)} is already taken.` 
          });
        }
      } catch {
        if (!isCurrent) return;
        setCheckingUsername(false);
        setUsernameStatus({ 
          valid: true, 
          available: true, 
          message: `@${normalizeUsername(raw)}` 
        });
      }
    }, 300);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [username, userId]);

  // Handle avatar file selection from device
  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateAvatarFile(file);
    if (!validation.isValid) {
      setAvatarError(validation.error || 'Please choose a valid JPG, PNG, WebP or GIF under 5MB.');
      return;
    }

    setAvatarError(null);
    if (avatarPreviewUrl && avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }

    setSelectedAvatarFile(file);
    setHasRemovedAvatar(false);
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl(objectUrl);
  };

  const handleRemoveAvatar = () => {
    if (avatarPreviewUrl && avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setSelectedAvatarFile(null);
    setHasRemovedAvatar(true);
    setAvatarPreviewUrl('');
    setAvatarError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSignOutClick = () => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore
    }
    if (onSignOut) {
      onSignOut();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // 1. Validate display name
    const nameVal = validateRequiredDisplayName(displayName);
    if (!nameVal.isValid) {
      setSubmitError(nameVal.error || 'Please enter a display name.');
      return;
    }

    // 2. Validate username
    const userVal = validateUsername(username);
    if (!userVal.isValid) {
      setSubmitError(userVal.error || 'Please enter a valid username.');
      return;
    }

    // 3. Validate bio
    const bioVal = validateBio(bio);
    if (!bioVal.isValid) {
      setSubmitError(bioVal.error || 'Bio cannot exceed 200 characters.');
      return;
    }

    if (usernameStatus.available === false) {
      setSubmitError(usernameStatus.message || 'Username is already taken.');
      return;
    }

    setIsSubmitting(true);

    try {
      let finalAvatarUrl: string | undefined = undefined;

      // Upload selected avatar image file to Supabase avatars bucket if chosen
      if (selectedAvatarFile) {
        const uploadRes = await uploadAvatar(selectedAvatarFile, userId);
        if (!uploadRes.success || !uploadRes.publicUrl) {
          setIsSubmitting(false);
          setSubmitError(uploadRes.error || 'Failed to upload photo. You can continue without a photo or try another image.');
          return;
        }
        finalAvatarUrl = uploadRes.publicUrl;
      } else if (!hasRemovedAvatar && avatarPreviewUrl && !avatarPreviewUrl.startsWith('blob:')) {
        finalAvatarUrl = avatarPreviewUrl.trim() || undefined;
      }

      const res = await completeIdentitySetup(
        userId,
        {
          username: username.trim(),
          display_name: displayName.trim(),
          avatar_url: finalAvatarUrl,
          bio: bio.trim() || undefined,
        },
        userEmail
      );

      if (res.success && res.profile) {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          // Ignore
        }
        onIdentityComplete(res.profile);
      } else {
        setSubmitError(res.error || 'Failed to complete identity setup. Please check your details and try again.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred during setup.';
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormReady = 
    displayName.trim().length > 0 &&
    displayName.trim().length <= 50 &&
    usernameStatus.valid &&
    usernameStatus.available &&
    !checkingUsername &&
    !isSubmitting;

  return (
    <div 
      id="identity-setup-container" 
      className="flex-1 flex flex-col justify-between px-6 pt-5 pb-7 sm:px-7 sm:pt-6 sm:pb-8 overflow-y-auto no-scrollbar select-none"
    >
      {/* Top Bar: Brand Monogram & Contextual Sign Out */}
      <div className="space-y-6">
        <header 
          id="app-status-header"
          className="flex items-center justify-between min-h-[40px]"
        >
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

          {onSignOut && (
            <button
              id="btn-signout-setup"
              type="button"
              onClick={handleSignOutClick}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-2.5 py-1.5 -mr-2 rounded-xl text-xs font-medium text-stone-400 hover:text-stone-100 hover:bg-stone-900/60 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          )}
        </header>

        {/* Editorial Heading */}
        <div className="space-y-2.5 pt-1">
          <h1 className="font-display text-[32px] sm:text-[34px] font-normal leading-[1.1] tracking-tight text-stone-100">
            Establish your identity.
          </h1>

          <p className="text-[14px] text-stone-400 leading-relaxed max-w-[34ch]">
            Choose how you will be known across Tchat. Only a display name and unique handle are required.
          </p>

          <div className="pt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-stone-500">
            <span>Name & handle required</span>
            <span aria-hidden="true">·</span>
            <span>Avatar & bio optional</span>
            <span aria-hidden="true">·</span>
            <span>Editable anytime</span>
          </div>
        </div>
      </div>

      {/* Main Interactive Form Surface */}
      <div className="my-auto py-5 space-y-5">
        {/* Error Notification Banner */}
        {submitError && (
          <div 
            id="identity-error-banner"
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-950/35 border border-rose-800/40 text-rose-200 text-xs leading-relaxed"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1 select-text">{submitError}</div>
          </div>
        )}

        {/* Live Identity Preview Card (What other people see) */}
        <div className="p-4 rounded-2xl bg-stone-900/50 border border-stone-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-stone-400">
              Live Preview
            </span>
            <span className="text-[11px] text-stone-500">
              What others see
            </span>
          </div>

          <div className="flex items-center gap-3.5">
            {/* Avatar Preview with Camera Action */}
            <div className="relative group shrink-0">
              <div className="w-14 h-14 rounded-full bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-400 overflow-hidden shadow-inner">
                {avatarPreviewUrl ? (
                  <img 
                    src={avatarPreviewUrl} 
                    alt="Profile preview" 
                    className="w-full h-full object-cover"
                    onError={() => setAvatarPreviewUrl('')}
                  />
                ) : (
                  <UserIcon className="w-7 h-7 stroke-[1.5] text-stone-400" />
                )}
              </div>

              {/* Quick Camera Trigger */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-stone-800 hover:bg-stone-700 border border-stone-700 flex items-center justify-center text-stone-200 transition-colors shadow-sm cursor-pointer"
                title="Add or change photo"
                aria-label="Add or change profile photo"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Name, Handle & Bio Live Preview */}
            <div className="space-y-0.5 min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-stone-100 truncate">
                {displayName.trim() || 'Your Name'}
              </div>
              <div className="text-xs text-stone-400 font-mono truncate">
                @{normalizeUsername(username) || 'handle'}
              </div>
              {bio.trim() && (
                <div className="text-[11px] text-stone-400 line-clamp-1 italic pt-0.5">
                  &ldquo;{bio.trim()}&rdquo;
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Form Inputs */}
        <form id="identity-setup-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Hidden File Input for Native Avatar Picker */}
          <input
            ref={fileInputRef}
            type="file"
            id="setup-avatar-file-input"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleAvatarFileChange}
            className="hidden"
          />

          {/* 1. Display Name (REQUIRED) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="setup-display-name" className="text-xs font-medium text-stone-300 block">
                Display name <span className="text-stone-400">*</span>
              </label>
              <span className="text-[11px] text-stone-400 tabular-nums">
                {displayName.trim().length} / 50
              </span>
            </div>
            <input
              id="setup-display-name"
              type="text"
              required
              autoFocus
              autoCapitalize="words"
              maxLength={50}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              disabled={isSubmitting}
              className="w-full h-11 px-3.5 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 transition-colors"
            />
          </div>

          {/* 2. Username Handle (REQUIRED) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="setup-username" className="text-xs font-medium text-stone-300 block">
                Username handle <span className="text-stone-400">*</span>
              </label>
              <span className="text-[11px] text-stone-400">
                3–24 chars
              </span>
            </div>

            <div className="relative">
              <span className="absolute inset-y-0 left-3.5 flex items-center text-[14px] text-stone-400 font-mono">
                @
              </span>
              <input
                id="setup-username"
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="alex"
                disabled={isSubmitting}
                className="w-full h-11 pl-8 pr-10 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 font-mono transition-colors"
              />
              <div className="absolute inset-y-0 right-3.5 flex items-center">
                {checkingUsername && (
                  <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                )}
                {!checkingUsername && usernameStatus.valid && usernameStatus.available && (
                  <Check className="w-4 h-4 text-emerald-400 stroke-[2.5]" />
                )}
                {!checkingUsername && usernameStatus.valid === false && username.trim().length > 0 && (
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>
            </div>

            {/* Username Status Feedback */}
            <div className="min-h-[16px] text-[11px] leading-tight">
              {checkingUsername ? (
                <span className="text-stone-400">Checking handle availability...</span>
              ) : usernameStatus.message ? (
                <span className={usernameStatus.available ? 'text-emerald-400' : 'text-rose-400'}>
                  {usernameStatus.message}
                </span>
              ) : (
                <span className="text-stone-400">Letters, numbers, and underscores only.</span>
              )}
            </div>
          </div>

          {/* 3. Photo & Avatar Section (OPTIONAL) */}
          <div className="pt-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-stone-300">
                Profile photo
              </span>
              <span className="text-[11px] text-stone-400">Optional</span>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-stone-900/40 border border-stone-800/70">
              <div className="w-10 h-10 rounded-full bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-400 shrink-0 overflow-hidden">
                {avatarPreviewUrl ? (
                  <img 
                    src={avatarPreviewUrl} 
                    alt="Thumbnail" 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <UserIcon className="w-5 h-5 stroke-[1.5]" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-xs text-stone-300 font-medium truncate">
                  {selectedAvatarFile ? selectedAvatarFile.name : avatarPreviewUrl ? 'Photo attached' : 'No photo chosen'}
                </div>
                <div className="text-[11px] text-stone-400">
                  {avatarPreviewUrl ? 'Tap to change or remove' : 'JPG, PNG, WebP or GIF up to 5MB'}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors cursor-pointer"
                >
                  {avatarPreviewUrl ? 'Change' : 'Choose'}
                </button>
                {avatarPreviewUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={isSubmitting}
                    className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 transition-colors cursor-pointer"
                    title="Remove photo"
                    aria-label="Remove photo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {avatarError && (
              <p className="text-[11px] text-rose-400">{avatarError}</p>
            )}
          </div>

          {/* 4. Bio Section (OPTIONAL) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="setup-bio" className="text-xs font-medium text-stone-300 block">
                Bio
              </label>
              <div className="flex items-center gap-2 text-[11px] text-stone-400">
                <span>Optional</span>
                <span>·</span>
                <span className="tabular-nums">{bio.length} / 200</span>
              </div>
            </div>
            <textarea
              id="setup-bio"
              rows={2}
              maxLength={200}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A calm line about yourself..."
              disabled={isSubmitting}
              className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900/80 border border-stone-800/90 focus:border-stone-500 focus:outline-none text-stone-100 text-[14px] placeholder:text-stone-600 resize-none transition-colors"
            />
          </div>

          {/* Primary Submit Button */}
          <button
            id="btn-complete-identity"
            type="submit"
            disabled={!isFormReady}
            className="w-full h-12 mt-2 flex items-center justify-center gap-2 px-4 rounded-xl bg-stone-100 hover:bg-white active:scale-[0.99] text-stone-950 text-[13px] font-semibold tracking-tight transition-all disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
                <span>Creating identity...</span>
              </>
            ) : (
              <span>Enter Tchat</span>
            )}
          </button>
        </form>
      </div>

      {/* Footer Assurance */}
      <div className="pt-4 border-t border-stone-900/80 text-center">
        <p className="text-[11px] text-stone-400 leading-relaxed">
          Your profile is never part of an engagement algorithm. You can edit your name, photo, and bio anytime in settings.
        </p>
      </div>
    </div>
  );
}
