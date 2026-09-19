import React from 'react';
import { 
  Users, 
  UserPlus, 
  ArrowRight, 
  Inbox, 
  Sparkles,
  MessageSquare,
  Plus
} from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { TchatProfile, TchatAccount } from '../../domains/identity/types';
import { TchatConversation } from '../../domains/conversations/types';
import { TodayConversationsList } from '../conversations/TodayConversationsList';

interface HomeAuthenticatedViewProps {
  user: User;
  profile: TchatProfile;
  account: TchatAccount | null;
  onSignOut?: () => void;
  isSigningOut?: boolean;
  onOpenConnections?: () => void;
  incomingRequestsCount?: number;
  connectionsCount?: number;
  conversations?: TchatConversation[];
  isLoadingConversations?: boolean;
  onSelectConversation?: (conversation: TchatConversation) => void;
  onCreateGroup?: () => void;
}

export function HomeAuthenticatedView({
  profile,
  onOpenConnections,
  incomingRequestsCount = 0,
  connectionsCount = 0,
  conversations = [],
  isLoadingConversations = false,
  onSelectConversation,
  onCreateGroup,
}: HomeAuthenticatedViewProps) {
  // Format today's human-friendly date
  const todayFormatted = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div 
      id="home-authenticated-view" 
      className="flex-1 overflow-y-auto px-5 py-6 space-y-6"
    >
      {/* 1. Today Day Header */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-stone-400 font-mono">
            {todayFormatted}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-100">
          Today
        </h1>
        <p className="text-xs text-stone-400">
          Social activity and active conversations for your day.
        </p>
      </div>

      {/* 2. Contextual Notification: Incoming Connection Requests */}
      {incomingRequestsCount > 0 && onOpenConnections && (
        <div 
          id="home-incoming-requests-alert"
          role="alert"
          onClick={onOpenConnections}
          className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/50 flex items-center justify-between gap-3 cursor-pointer hover:bg-amber-950/40 transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-900/60 border border-amber-700/60 flex items-center justify-center text-amber-300 shrink-0">
              <Inbox className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-200">
                {incomingRequestsCount} new connection {incomingRequestsCount === 1 ? 'request' : 'requests'}
              </p>
              <p className="text-[11px] text-amber-300/70 truncate">
                Someone shared context to connect with you
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 text-xs font-medium text-amber-200 shrink-0">
            <span>Review</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      )}

      {/* 3. Today's Conversations (Primary Living Social Activity) */}
      <TodayConversationsList
        conversations={conversations}
        isLoading={isLoadingConversations}
        onSelectConversation={(conv) => onSelectConversation?.(conv)}
        onOpenConnections={() => onOpenConnections?.()}
      />

      {/* 4. Intentional Temporary Groups Section */}
      {onCreateGroup && (
        <div 
          id="home-groups-context-bar"
          className="p-4 rounded-2xl bg-stone-900/50 border border-stone-800/70 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-stone-200">
                  Temporary Groups
                </h3>
                <p className="text-[11px] text-stone-400">
                  Intentional spaces with defined lifetimes
                </p>
              </div>
            </div>

            <button
              id="btn-home-create-group"
              type="button"
              onClick={onCreateGroup}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors cursor-pointer shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Group</span>
            </button>
          </div>

          <div className="pt-2 border-t border-stone-800/50 flex items-center justify-between text-[11px]">
            <span className="text-stone-400">
              Ephemeral gatherings of up to 30 people.
            </span>
          </div>
        </div>
      )}

      {/* 5. Contextual Connections & Discovery Bar */}
      {onOpenConnections && (
        <div 
          id="home-connections-context-bar"
          className="p-4 rounded-2xl bg-stone-900/50 border border-stone-800/70 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-stone-200">
                  Your Connections
                </h3>
                <p className="text-[11px] text-stone-400">
                  {connectionsCount} {connectionsCount === 1 ? 'connection' : 'connections'}
                </p>
              </div>
            </div>

            <button
              id="btn-home-manage-connections"
              type="button"
              onClick={onOpenConnections}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors cursor-pointer"
            >
              <span>Manage</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="pt-2 border-t border-stone-800/50 flex items-center justify-between text-[11px]">
            <span className="text-stone-400">
              Connections are intentional 1:1 human permissions.
            </span>
            <button
              id="btn-home-find-people"
              type="button"
              onClick={onOpenConnections}
              className="inline-flex items-center gap-1 text-stone-300 hover:text-stone-100 font-medium transition-colors cursor-pointer"
            >
              <UserPlus className="w-3 h-3" />
              <span>Find People</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
