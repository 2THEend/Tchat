import React, { useState } from 'react';
import { 
  User as UserIcon, 
  LogOut, 
  Calendar, 
  Shield, 
  Users, 
  ArrowRight, 
  CheckCircle2, 
  Sparkles,
  Smartphone
} from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { TchatProfile, TchatAccount } from '../../domains/identity/types';
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
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  profile,
  account,
  connectionsCount,
  onOpenConnections,
  onSignOut,
  isSigningOut,
}) => {
  const [showConfirmSignOut, setShowConfirmSignOut] = useState(false);
  const { isInstalled } = usePWAInstall();

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
      {/* View Title */}
      <div className="space-y-1">
        <span className="text-[11px] font-semibold tracking-wider uppercase text-stone-400">
          Personal Space
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-stone-100">
          Profile & Account
        </h1>
      </div>

      {/* Main Identity Card */}
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
