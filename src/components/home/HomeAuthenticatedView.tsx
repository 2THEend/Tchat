import { User as UserIcon, LogOut, CheckCircle2, Shield, Calendar, Users, ArrowRight, UserPlus } from 'lucide-react';
import { TchatProfile, TchatAccount } from '../../domains/identity/types';
import { User } from '@supabase/supabase-js';
import { TchatConversation } from '../../domains/conversations/types';
import { TodayConversationsList } from '../conversations/TodayConversationsList';

interface HomeAuthenticatedViewProps {
  user: User;
  profile: TchatProfile;
  account: TchatAccount | null;
  onSignOut: () => void;
  isSigningOut: boolean;
  onOpenConnections?: () => void;
  incomingRequestsCount?: number;
  connectionsCount?: number;
  conversations?: TchatConversation[];
  isLoadingConversations?: boolean;
  onSelectConversation?: (conversation: TchatConversation) => void;
}

export function HomeAuthenticatedView({
  user,
  profile,
  account,
  onSignOut,
  isSigningOut,
  onOpenConnections,
  incomingRequestsCount = 0,
  connectionsCount = 0,
  conversations = [],
  isLoadingConversations = false,
  onSelectConversation,
}: HomeAuthenticatedViewProps) {
  const memberDate = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })
    : 'Today';

  return (
    <div id="home-authenticated-view" className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
      {/* Top Welcome Bar */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-stone-400">
            Tchat · Active Session
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-stone-100">
            Welcome, {profile.display_name || profile.username}
          </h1>
        </div>

        <button
          id="btn-signout"
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          title="Sign out of Tchat"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 border border-stone-800 text-stone-400 hover:text-rose-400 hover:border-rose-900/60 hover:bg-rose-950/20 text-xs font-medium transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>{isSigningOut ? 'Signing out...' : 'Sign out'}</span>
        </button>
      </div>

      {/* Contextual Connections Affordance */}
      {onOpenConnections && (
        <div 
          id="home-connections-card"
          className="p-4 rounded-3xl bg-gradient-to-b from-stone-900/90 to-stone-900/60 border border-stone-800/80 space-y-3 shadow-lg shadow-black/20"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-200 shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-stone-100">Connections</h3>
                  {incomingRequestsCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-400 text-stone-950 font-bold text-[10px]">
                      {incomingRequestsCount} new
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-stone-400">
                  {connectionsCount} {connectionsCount === 1 ? 'connection' : 'connections'} · Intentional 1:1 human permissions
                </p>
              </div>
            </div>

            <button
              id="btn-home-manage-connections"
              type="button"
              onClick={onOpenConnections}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold transition-colors cursor-pointer"
            >
              <span>Manage</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="pt-2 border-t border-stone-800/60 flex items-center justify-between text-[11px]">
            <span className="text-stone-400">
              Connections are separate from conversations.
            </span>
            <button
              id="btn-home-find-people"
              type="button"
              onClick={onOpenConnections}
              className="inline-flex items-center gap-1 text-stone-300 hover:text-white font-medium cursor-pointer"
            >
              <UserPlus className="w-3 h-3" />
              <span>Find People</span>
            </button>
          </div>
        </div>
      )}

      {/* Today's Social Activity & Conversations */}
      <TodayConversationsList
        conversations={conversations}
        isLoading={isLoadingConversations}
        onSelectConversation={(conv) => onSelectConversation?.(conv)}
        onOpenConnections={() => onOpenConnections?.()}
      />

      {/* Verified Profile Card */}
      <div 
        id="profile-identity-card"
        className="p-5 rounded-3xl bg-stone-900/70 border border-stone-800/80 space-y-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
            {profile.avatar_url ? (
              <img 
                src={profile.avatar_url} 
                alt={profile.display_name || profile.username} 
                className="w-full h-full object-cover"
              />
            ) : (
              <UserIcon className="w-7 h-7 stroke-[1.6]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-stone-100 truncate">
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

        {profile.bio && (
          <p className="text-xs text-stone-300 leading-relaxed pt-1 border-t border-stone-800/50">
            {profile.bio}
          </p>
        )}

        <div className="pt-2 border-t border-stone-800/50 grid grid-cols-2 gap-2 text-[11px] text-stone-400">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-stone-500" />
            <span>Member since {memberDate}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-stone-500" />
            <span className="capitalize">{account?.status || 'Active'} Account</span>
          </div>
        </div>
      </div>

      {/* Account Authentication Specs */}
      <div className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800/60 space-y-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
          Authenticated Supabase Credentials
        </h3>
        <div className="space-y-1.5 text-xs text-stone-300">
          <div className="flex items-center justify-between py-1 border-b border-stone-800/40">
            <span className="text-stone-400">Auth User ID</span>
            <span className="font-mono text-[11px] text-stone-300">{user.id.slice(0, 14)}...</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-stone-800/40">
            <span className="text-stone-400">Account Email</span>
            <span className="text-[11px] text-stone-300 truncate max-w-[200px]">{user.email || 'None on record'}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-stone-400">Auth Provider</span>
            <span className="text-[11px] text-stone-300 capitalize">{user.app_metadata?.provider || 'email'}</span>
          </div>
        </div>
      </div>

      {/* Domain Readiness Notice */}
      <div className="p-4 rounded-2xl bg-stone-900/20 border border-stone-800/40 space-y-1 text-center">
        <span className="text-[10px] uppercase font-semibold tracking-wider text-stone-400">
          Domain Roadmap
        </span>
        <p className="text-[11px] text-stone-400 leading-relaxed">
          Authentication and verified Identity established. Social features (1:1 conversations, ephemeral media, intentional streaks) will be enabled in forthcoming domain milestones.
        </p>
      </div>
    </div>
  );
}
