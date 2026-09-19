import React from 'react';
import { 
  ArrowLeft, 
  Users, 
  Clock, 
  Lock, 
  Globe, 
  HelpCircle, 
  ShieldCheck, 
  Calendar, 
  CheckCircle2, 
  PlusCircle, 
  Image as ImageIcon 
} from 'lucide-react';
import { GroupDetails } from '../../domains/groups/types';

interface GroupArrivalViewProps {
  group: GroupDetails;
  onBack: () => void;
  onCreateAnother?: () => void;
}

export function GroupArrivalView({
  group,
  onBack,
  onCreateAnother,
}: GroupArrivalViewProps) {
  const expiresFormatted = new Date(group.expires_at).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const lifetimeLabel = group.lifetime === '1_day' 
    ? '1 Day' 
    : group.lifetime === '3_days' 
    ? '3 Days' 
    : '1 Week';

  return (
    <div 
      id="group-arrival-view" 
      className="flex-1 overflow-y-auto flex flex-col bg-stone-950 text-stone-100 selection:bg-stone-800"
    >
      {/* Top Header */}
      <header className="sticky top-0 z-20 bg-stone-950/90 backdrop-blur-md px-5 py-3.5 border-b border-stone-900/60 flex items-center justify-between">
        <button
          id="btn-back-from-group-arrival"
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 p-1.5 -ml-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer text-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Home</span>
        </button>

        <span className="text-[10px] font-semibold tracking-wider uppercase text-emerald-400 font-mono flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          <span>Group Created</span>
        </span>
      </header>

      {/* Main Content */}
      <div className="px-5 py-6 space-y-6 flex-1">
        {/* Cover Preview / Banner */}
        <div className="relative w-full h-40 rounded-3xl bg-stone-900/80 border border-stone-800/80 overflow-hidden flex items-center justify-center">
          {group.cover_url ? (
            <img 
              src={group.cover_url} 
              alt={group.name} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-stone-800/80 border border-stone-700/60 flex items-center justify-center text-stone-400">
              <Users className="w-8 h-8 stroke-[1.5]" />
            </div>
          )}

          {/* Visibility & Lifetime Overlay Badges */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-950/80 backdrop-blur-md border border-stone-700/50 text-[10px] font-mono text-stone-300">
              {group.visibility === 'private' ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
              <span className="capitalize">{group.visibility}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-950/80 backdrop-blur-md border border-stone-700/50 text-[10px] font-mono text-stone-300">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>{lifetimeLabel}</span>
            </span>
          </div>
        </div>

        {/* Group Identity & Purpose */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-mono">
              Intentional Temporary Space
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-100">
            {group.name}
          </h1>
          <p className="text-xs text-stone-300 leading-relaxed bg-stone-900/50 p-3.5 rounded-2xl border border-stone-800/70">
            {group.reason}
          </p>
        </div>

        {/* Real Invariant Properties */}
        <div className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800/70 space-y-3">
          <h2 className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider font-mono">
            Configuration & State
          </h2>

          <div className="grid grid-cols-2 gap-3 text-xs">
            {/* Access Mode */}
            <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-500 uppercase tracking-wide">Joining Method</span>
              <p className="font-semibold text-stone-200 capitalize flex items-center gap-1.5">
                {group.access_mode === 'question' && <HelpCircle className="w-3.5 h-3.5 text-amber-400" />}
                {group.access_mode}
              </p>
            </div>

            {/* Capacity */}
            <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-500 uppercase tracking-wide">Capacity</span>
              <p className="font-semibold text-stone-200">
                {group.member_count} of {group.max_size} members
              </p>
            </div>

            {/* Role */}
            <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-500 uppercase tracking-wide">Your Role</span>
              <p className="font-semibold text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Admin (Creator)</span>
              </p>
            </div>

            {/* Expiration */}
            <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-500 uppercase tracking-wide">Expires</span>
              <p className="font-semibold text-amber-300/90 text-[11px] truncate">
                {expiresFormatted}
              </p>
            </div>
          </div>

          {/* Joining Question (if present) */}
          {group.joining_question && (
            <div className="pt-2 border-t border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-500 uppercase tracking-wide flex items-center gap-1">
                <HelpCircle className="w-3 h-3 text-amber-400" />
                <span>Joining Question Prompt</span>
              </span>
              <p className="text-xs text-amber-200/90 italic bg-amber-950/20 p-2.5 rounded-xl border border-amber-900/30">
                "{group.joining_question}"
              </p>
            </div>
          )}
        </div>

        {/* Phase Boundary Notice */}
        <div className="p-4 rounded-2xl bg-stone-900/30 border border-stone-800/40 space-y-2">
          <div className="flex items-center gap-2 text-stone-300 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Phase 6.1 Creation Complete</span>
          </div>
          <p className="text-[11px] text-stone-400 leading-relaxed">
            The group was created via the server-authoritative <code className="text-stone-300 font-mono bg-stone-900 px-1 py-0.5 rounded">create_group</code> PostgreSQL RPC. You are registered as the initial active Admin.
          </p>
          <p className="text-[11px] text-stone-500 leading-relaxed">
            Subsequent phases will introduce the Group conversation experience, member management, and invite handling.
          </p>
        </div>

        {/* Action Controls */}
        <div className="space-y-2.5 pt-2 pb-6">
          <button
            id="btn-return-home"
            type="button"
            onClick={onBack}
            className="w-full py-3 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors cursor-pointer text-center"
          >
            Return to Home
          </button>

          {onCreateAnother && (
            <button
              id="btn-create-another-group"
              type="button"
              onClick={onCreateAnother}
              className="w-full py-2.5 px-4 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-stone-100 text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Create Another Group</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
