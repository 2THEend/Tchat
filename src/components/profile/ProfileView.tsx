import React, { useState, useEffect, useRef } from 'react';
import { 
  User as UserIcon, 
  LogOut, 
  Calendar, 
  Shield, 
  Users, 
  ArrowRight, 
  CheckCircle2, 
  Smartphone,
  Pencil,
  Camera,
  Trash2,
  Loader2,
  AlertCircle,
  X,
  Check
} from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { TchatProfile, TchatAccount } from '../../domains/identity/types';
import { 
  validateUsername, 
  validateDisplayName, 
  validateBio, 
  normalizeUsername,
  validateAvatarFile 
} from '../../domains/identity/validation';
import { 
  isUsernameAvailable, 
  updateOwnProfile, 
  uploadAvatar, 
  deleteAvatar 
} from '../../domains/identity/identityService';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { usePWAInstall } from '../pwa/usePWAInstall';

interface ProfileViewProps {
  user: User;
  profile: TchatProfile;
  account: TchatAccount | null;
  connectionsCount: number;
  onOpenConnections: () => void;
  onSignOut: () => void;
  isSigningOut: boolean;
  onProfileUpdated?: (updatedProfile: TchatProfile) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  profile,
  account,
  connectionsCount,
  onOpenConnections,
  onSignOut,
  isSigningOut,
  onProfileUpdated,
}) => {
  const [showConfirmSignOut, setShowConfirmSignOut] = useState(false);
  const { isInstalled } = usePWAInstall();

  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState(profile.display_name || '');
  const [editUsername, setEditUsername] = useState(profile.username);
  const [editBio, setEditBio] = useState(profile.bio || '');
  
  // Avatar handling
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(profile.avatar_url);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [hasRemovedAvatar, setHasRemovedAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Username availability & validation state
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<{
    valid: boolean;
    available?: boolean;
    message?: string;
  }>({ valid: true, available: true });

  // Form submission state
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Reset form when profile prop changes or when opening edit mode
  const handleStartEditing = () => {
    setEditDisplayName(profile.display_name || '');
    setEditUsername(profile.username);
    setEditBio(profile.bio || '');
    setAvatarPreviewUrl(profile.avatar_url);
    setSelectedAvatarFile(null);
    setHasRemovedAvatar(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    setUsernameStatus({ valid: true, available: true });
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    if (selectedAvatarFile && avatarPreviewUrl && avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarPreviewUrl(profile.avatar_url);
    setSelectedAvatarFile(null);
    setHasRemovedAvatar(false);
    setErrorMessage(null);
    setIsEditing(false);
  };

  // Debounced username availability validation
  useEffect(() => {
    if (!isEditing) return;

    const raw = editUsername.trim();
    if (!raw) {
      setUsernameStatus({ valid: false, message: 'Username is required.' });
      return;
    }

    const validation = validateUsername(raw);
    if (!validation.isValid) {
      setUsernameStatus({ valid: false, message: validation.error });
      return;
    }

    // If unchanged from user's current username, mark valid immediately
    if (normalizeUsername(raw) === profile.normalized_username) {
      setUsernameStatus({ valid: true, available: true });
      return;
    }

    let isCurrent = true;
    setCheckingUsername(true);

    const timer = setTimeout(async () => {
      const res = await isUsernameAvailable(raw, user.id);
      if (!isCurrent) return;

      setCheckingUsername(false);
      if (res.available) {
        setUsernameStatus({
          valid: true,
          available: true,
          message: `@${normalizeUsername(raw)} is available`,
        });
      } else {
        setUsernameStatus({
          valid: false,
          available: false,
          message: res.error || 'Username is already taken.',
        });
      }
    }, 350);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [editUsername, isEditing, profile.normalized_username, user.id]);

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateAvatarFile(file);
    if (!validation.isValid) {
      setErrorMessage(validation.error || 'Invalid image file.');
      return;
    }

    setErrorMessage(null);
    if (selectedAvatarFile && avatarPreviewUrl && avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }

    setSelectedAvatarFile(file);
    setHasRemovedAvatar(false);
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl(objectUrl);
  };

  const handleRemoveAvatar = () => {
    if (selectedAvatarFile && avatarPreviewUrl && avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setSelectedAvatarFile(null);
    setHasRemovedAvatar(true);
    setAvatarPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validation checks
    const userVal = validateUsername(editUsername);
    if (!userVal.isValid) {
      setErrorMessage(userVal.error || 'Invalid username.');
      return;
    }

    const nameVal = validateDisplayName(editDisplayName);
    if (!nameVal.isValid) {
      setErrorMessage(nameVal.error || 'Invalid display name.');
      return;
    }

    const bioVal = validateBio(editBio);
    if (!bioVal.isValid) {
      setErrorMessage(bioVal.error || 'Invalid bio.');
      return;
    }

    if (usernameStatus.available === false) {
      setErrorMessage(usernameStatus.message || 'Username is already taken.');
      return;
    }

    setIsSaving(true);

    try {
      let finalAvatarUrl: string | null = profile.avatar_url;

      // 1. Upload new avatar if selected
      if (selectedAvatarFile) {
        const uploadRes = await uploadAvatar(selectedAvatarFile, user.id);
        if (!uploadRes.success || !uploadRes.publicUrl) {
          setIsSaving(false);
          setErrorMessage(uploadRes.error || 'Failed to upload avatar image.');
          return;
        }
        finalAvatarUrl = uploadRes.publicUrl;

        // Clean up previous storage asset if it was hosted in avatars bucket
        if (profile.avatar_url && profile.avatar_url !== finalAvatarUrl) {
          deleteAvatar(profile.avatar_url, user.id).catch(() => {});
        }
      } else if (hasRemovedAvatar) {
        finalAvatarUrl = null;
        if (profile.avatar_url) {
          deleteAvatar(profile.avatar_url, user.id).catch(() => {});
        }
      }

      // 2. Perform atomic profile update
      const updateRes = await updateOwnProfile({
        username: editUsername.trim(),
        display_name: editDisplayName.trim() || null,
        bio: editBio.trim() || null,
        avatar_url: finalAvatarUrl,
      });

      if (!updateRes.success || !updateRes.profile) {
        setIsSaving(false);
        setErrorMessage(updateRes.error || 'Failed to update profile.');
        return;
      }

      // 3. Success handling
      setIsSaving(false);
      setIsEditing(false);
      setSuccessMessage('Profile updated successfully.');
      setTimeout(() => setSuccessMessage(null), 4000);

      if (onProfileUpdated) {
        onProfileUpdated(updateRes.profile);
      }
    } catch (err: unknown) {
      setIsSaving(false);
      const msg = err instanceof Error ? err.message : 'An error occurred while saving.';
      setErrorMessage(msg);
    }
  };

  const memberDate = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : 'Recently';

  return (
    <div 
      id="profile-view-container" 
      className="flex-1 overflow-y-auto px-5 py-6 space-y-6"
    >
      {/* View Title & Action */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-stone-400">
            Personal Space
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-stone-100">
            Profile & Identity
          </h1>
        </div>

        {!isEditing && (
          <button
            id="btn-edit-profile-trigger"
            type="button"
            onClick={handleStartEditing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800/80 hover:bg-stone-700/80 border border-stone-700/60 text-stone-200 text-xs font-medium transition-colors cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Edit Profile</span>
          </button>
        )}
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Main Identity Card (View Mode vs. Edit Mode) */}
      {isEditing ? (
        <form
          id="profile-edit-form"
          onSubmit={handleSaveProfile}
          className="p-5 rounded-3xl bg-stone-900/80 border border-stone-800 space-y-5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-stone-800/80">
            <h2 className="text-sm font-semibold text-stone-200">
              Edit Your Profile
            </h2>
            <button
              type="button"
              onClick={handleCancelEditing}
              disabled={isSaving}
              className="text-stone-400 hover:text-stone-200 p-1 rounded-lg transition-colors cursor-pointer"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Avatar Upload / Preview */}
          <div className="flex items-center gap-4">
            <div className="relative group shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-stone-800 border border-stone-700/80 flex items-center justify-center text-stone-300 overflow-hidden">
                {avatarPreviewUrl ? (
                  <img 
                    src={avatarPreviewUrl} 
                    alt="Avatar preview" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserIcon className="w-10 h-10 stroke-[1.5]" />
                )}
              </div>

              {/* Camera Upload Trigger */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSaving}
                className="absolute inset-0 bg-black/40 hover:bg-black/60 rounded-2xl flex items-center justify-center text-stone-100 transition-colors cursor-pointer"
                title="Change photo"
              >
                <Camera className="w-6 h-6 stroke-[1.8]" />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAvatarFileChange}
                className="hidden"
                id="profile-avatar-file-input"
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="text-xs font-medium text-stone-200">
                Profile Photo
              </div>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                JPG, PNG, WebP or GIF up to 5MB.
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSaving}
                  className="text-xs text-stone-300 hover:text-stone-100 underline underline-offset-2 transition-colors cursor-pointer"
                >
                  Upload new
                </button>
                {avatarPreviewUrl && (
                  <>
                    <span className="text-stone-400">·</span>
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      disabled={isSaving}
                      className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Display Name Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="edit-display-name" className="font-medium text-stone-300">
                Display Name
              </label>
              <span className="text-[10px] text-stone-400">
                {editDisplayName.trim().length} / 50
              </span>
            </div>
            <input
              id="edit-display-name"
              type="text"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              maxLength={50}
              placeholder="What people call you"
              disabled={isSaving}
              className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950/70 border border-stone-800 text-stone-100 placeholder-stone-400 text-xs focus:outline-none focus:border-stone-600 transition-colors"
            />
          </div>

          {/* Username Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="edit-username" className="font-medium text-stone-300">
                Username handle
              </label>
              <span className="text-[10px] text-stone-400">
                {normalizeUsername(editUsername).length} / 24
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 text-xs font-mono">
                @
              </span>
              <input
                id="edit-username"
                type="text"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                maxLength={25}
                placeholder="username"
                disabled={isSaving}
                className="w-full pl-8 pr-10 py-2.5 rounded-xl bg-stone-950/70 border border-stone-800 text-stone-100 placeholder-stone-400 text-xs font-mono focus:outline-none focus:border-stone-600 transition-colors"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {checkingUsername ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />
                ) : usernameStatus.valid && usernameStatus.available ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : editUsername.trim() ? (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                ) : null}
              </div>
            </div>

            {/* Username Status / Helper */}
            {usernameStatus.message && (
              <p className={`text-[11px] ${usernameStatus.available === false || !usernameStatus.valid ? 'text-rose-400' : 'text-stone-400'}`}>
                {usernameStatus.message}
              </p>
            )}
            <p className="text-[10px] text-stone-400">
              3-24 characters containing letters, numbers, or underscores.
            </p>
          </div>

          {/* Bio Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="edit-bio" className="font-medium text-stone-300">
                Bio
              </label>
              <span className="text-[10px] text-stone-400">
                {editBio.trim().length} / 200
              </span>
            </div>
            <textarea
              id="edit-bio"
              value={editBio}
              onChange={(e) => setEditBio(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="A few words about yourself..."
              disabled={isSaving}
              className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950/70 border border-stone-800 text-stone-100 placeholder-stone-400 text-xs focus:outline-none focus:border-stone-600 transition-colors resize-none leading-relaxed"
            />
          </div>

          {/* Form Error Banner */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-stone-800/80">
            <button
              type="button"
              onClick={handleCancelEditing}
              disabled={isSaving}
              className="flex-1 py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="btn-save-profile"
              type="submit"
              disabled={isSaving || checkingUsername || (usernameStatus.available === false)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-900 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      ) : (
        <div 
          id="profile-primary-card"
          className="p-5 rounded-3xl bg-stone-900/60 border border-stone-800/80 space-y-4"
        >
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
              {profile.avatar_url ? (
                <img 
                  src={profile.avatar_url} 
                  alt={profile.display_name || profile.username} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserIcon className="w-8 h-8 stroke-[1.6]" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-lg font-semibold text-stone-100 truncate">
                  {profile.display_name || profile.username}
                </h2>
                <span className="inline-flex items-center text-emerald-400" title="Verified Identity">
                  <CheckCircle2 className="w-4 h-4 fill-emerald-950 stroke-emerald-400" />
                </span>
              </div>
              <div className="text-xs text-stone-400 font-mono mt-0.5">
                @{profile.username}
              </div>
            </div>
          </div>

          {profile.bio ? (
            <p className="text-xs text-stone-300 leading-relaxed pt-2 border-t border-stone-800/60">
              {profile.bio}
            </p>
          ) : (
            <p className="text-xs text-stone-400 italic pt-2 border-t border-stone-800/60">
              No bio provided yet.
            </p>
          )}

          {/* Member Details */}
          <div className="pt-2 border-t border-stone-800/60 grid grid-cols-2 gap-2 text-[11px] text-stone-400">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-stone-400" />
              <span>Joined {memberDate}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-stone-400" />
              <span className="capitalize">{account?.status || 'Active'} status</span>
            </div>
          </div>
        </div>
      )}

      {/* Connections Affordance */}
      <div 
        id="profile-connections-section"
        className="p-4 rounded-2xl bg-stone-900/60 border border-stone-800/80 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-200 shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-stone-200">
              Connections
            </h3>
            <p className="text-[11px] text-stone-400">
              {connectionsCount} intentional {connectionsCount === 1 ? 'relationship' : 'relationships'}
            </p>
          </div>
        </div>

        <button
          id="btn-profile-manage-connections"
          type="button"
          onClick={onOpenConnections}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors cursor-pointer shrink-0"
        >
          <span>Manage</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Account Info (Calm, Private Summary) */}
      <div className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800/60 space-y-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
          Account Details
        </h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-stone-800/40">
            <span className="text-stone-400">Registered Email</span>
            <span className="text-stone-300 font-mono text-[11px] truncate max-w-[200px]">
              {user.email || 'Email not linked'}
            </span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-stone-800/40">
            <span className="text-stone-400">Sign-in Provider</span>
            <span className="text-stone-300 capitalize text-[11px]">
              {user.app_metadata?.provider || 'Email'}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-stone-400">Security Model</span>
            <span className="text-stone-400 text-[11px]">Row-Level Security Active</span>
          </div>
        </div>
      </div>

      {/* Standalone PWA Option (if not installed) */}
      {!isInstalled && (
        <div className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800/60 space-y-2">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-stone-400" />
            <h3 className="text-xs font-semibold text-stone-200">
              Install Tchat App
            </h3>
          </div>
          <p className="text-[11px] text-stone-400 leading-relaxed">
            Install to your device home screen for a focused, standalone experience without browser chrome.
          </p>
          <div className="pt-1">
            <PWAInstallButton variant="badge" />
          </div>
        </div>
      )}

      {/* Sign Out Section */}
      <div className="pt-2">
        {showConfirmSignOut ? (
          <div className="p-4 rounded-2xl bg-stone-900/80 border border-stone-800 space-y-3">
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-stone-200">
                Confirm sign out?
              </h4>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                Your session will end. You can sign back in anytime with your credentials.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmSignOut(false)}
                disabled={isSigningOut}
                className="flex-1 py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-signout"
                type="button"
                onClick={onSignOut}
                disabled={isSigningOut}
                className="flex-1 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isSigningOut ? 'Signing out...' : 'Sign Out'}
              </button>
            </div>
          </div>
        ) : (
          <button
            id="btn-profile-signout"
            type="button"
            onClick={() => setShowConfirmSignOut(true)}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-stone-900/70 border border-stone-800/80 hover:border-rose-900/60 hover:bg-rose-950/20 text-stone-400 hover:text-rose-300 text-xs font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out of Tchat</span>
          </button>
        )}
      </div>

      <div className="text-center pt-2 pb-4">
        <p className="text-[10px] font-mono text-stone-400">
          Tchat v0.2 · Intentional social communication
        </p>
      </div>
    </div>
  );
};
