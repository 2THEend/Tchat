import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Sparkles, 
  Users, 
  Clock, 
  Lock, 
  Globe, 
  HelpCircle, 
  Image as ImageIcon, 
  AlertCircle, 
  Check, 
  Loader2,
  ShieldAlert,
  Calendar
} from 'lucide-react';
import { 
  GroupLifetime, 
  GroupVisibility, 
  GroupAccessMode, 
  CreateGroupInput,
  GroupDetails 
} from '../../domains/groups/types';
import { 
  validateCreateGroupInput,
  validateGroupName,
  validateGroupReason
} from '../../domains/groups/validation';
import { createGroup, getGroupDetails } from '../../domains/groups/groupsService';

interface CreateGroupViewProps {
  currentUserId: string;
  onBack: () => void;
  onGroupCreated: (group: GroupDetails) => void;
}

const LIFETIME_OPTIONS: { id: GroupLifetime; label: string; description: string }[] = [
  { id: '1_day', label: '1 Day', description: 'Brief ephemeral gathering or event' },
  { id: '3_days', label: '3 Days', description: 'Focused multi-day collaborative sprint' },
  { id: '1_week', label: '1 Week', description: 'Intentional weekly temporary circle' },
];

const VISIBILITY_OPTIONS: { id: GroupVisibility; label: string; description: string; icon: typeof Lock }[] = [
  { id: 'private', label: 'Private', description: 'Invite & request only; hidden from feed', icon: Lock },
  { id: 'discoverable', label: 'Discoverable', description: 'Visible in Feed & search for social discovery', icon: Globe },
];

export function CreateGroupView({
  onBack,
  onGroupCreated,
}: CreateGroupViewProps) {
  // Form State
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [lifetime, setLifetime] = useState<GroupLifetime>('3_days');
  const [visibility, setVisibility] = useState<GroupVisibility>('discoverable');
  const [accessMode, setAccessMode] = useState<GroupAccessMode>('request');
  const [joiningQuestion, setJoiningQuestion] = useState('');
  const [maxSize, setMaxSize] = useState<number>(30);
  const [coverUrl, setCoverUrl] = useState('');
  const [isTestingCover, setIsTestingCover] = useState(false);
  const [coverLoadFailed, setCoverLoadFailed] = useState(false);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Invariant Enforcement: Private cannot be Open
  useEffect(() => {
    if (visibility === 'private' && accessMode === 'open') {
      setAccessMode('request');
    }
  }, [visibility, accessMode]);

  // Clean up joining question if mode changed away from question
  useEffect(() => {
    if (accessMode !== 'question') {
      setJoiningQuestion('');
    }
  }, [accessMode]);

  // Handle Cover URL Preview Check
  useEffect(() => {
    const trimmed = coverUrl.trim();
    if (!trimmed) {
      setCoverLoadFailed(false);
      setIsTestingCover(false);
      return;
    }

    try {
      new URL(trimmed);
    } catch {
      setCoverLoadFailed(true);
      setIsTestingCover(false);
      return;
    }

    setIsTestingCover(true);
    setCoverLoadFailed(false);

    const img = new Image();
    img.onload = () => {
      setIsTestingCover(false);
      setCoverLoadFailed(false);
    };
    img.onerror = () => {
      setIsTestingCover(false);
      setCoverLoadFailed(true);
    };
    img.src = trimmed;
  }, [coverUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const input: CreateGroupInput = {
      name: name.trim(),
      reason: reason.trim(),
      lifetime,
      visibility,
      access_mode: accessMode,
      joiningQuestion: accessMode === 'question' ? joiningQuestion.trim() : undefined,
      maxSize,
      coverUrl: coverUrl.trim() && !coverLoadFailed ? coverUrl.trim() : undefined,
    };

    // Client-side invariant check
    const validation = validateCreateGroupInput(input);
    if (!validation.isValid) {
      setSubmitError(validation.error || 'Please correct the highlighted errors.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createGroup(input);
      if (res.error || !res.data) {
        setSubmitError(res.error || 'Failed to create group on server.');
        return;
      }

      const groupId = res.data.group_id;

      // Fetch the full authoritative group details to transition cleanly
      const detailsRes = await getGroupDetails(groupId);
      if (detailsRes.data) {
        onGroupCreated(detailsRes.data);
      } else {
        // Fallback to returned RPC payload with required fields
        const fallbackGroup: GroupDetails = {
          id: groupId,
          name: res.data.name || input.name,
          reason: res.data.reason || input.reason,
          cover_url: input.coverUrl || null,
          lifetime: res.data.lifetime || input.lifetime,
          expires_at: res.data.expires_at || new Date().toISOString(),
          grace_expires_at: res.data.grace_expires_at || new Date().toISOString(),
          visibility: res.data.visibility || input.visibility,
          access_mode: res.data.access_mode || input.access_mode,
          effective_access_mode: res.data.effective_access_mode || input.access_mode,
          joining_question: input.joiningQuestion || null,
          max_size: res.data.max_size || input.maxSize || 30,
          lifecycle_status: 'active',
          member_count: 1,
          admin: {
            username: 'you',
            display_name: 'You',
            avatar_url: null,
          },
          membership: {
            role: 'admin',
            status: 'active',
            joined_at: new Date().toISOString(),
          },
        };
        onGroupCreated(fallbackGroup);
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'An unexpected network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isNameValid = name.trim().length >= 2 && name.trim().length <= 60;
  const isReasonValid = reason.trim().length >= 3 && reason.trim().length <= 300;
  const isQuestionValid = accessMode !== 'question' || (joiningQuestion.trim().length >= 3 && joiningQuestion.trim().length <= 300);

  return (
    <div 
      id="create-group-view" 
      className="flex-1 overflow-y-auto flex flex-col bg-stone-950 text-stone-100 selection:bg-stone-800"
    >
      {/* Top Header */}
      <header className="sticky top-0 z-20 bg-stone-950/90 backdrop-blur-md px-5 py-3.5 border-b border-stone-900/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            id="btn-back-from-create-group"
            type="button"
            onClick={onBack}
            className="p-1.5 -ml-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <span className="text-[10px] font-semibold tracking-wider uppercase text-stone-400 font-mono">
              Temporary Space
            </span>
            <h1 className="text-base font-semibold text-stone-100 tracking-tight">
              Create a Group
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-stone-400 font-mono">
          <Users className="w-3.5 h-3.5" />
          <span>Max 30</span>
        </div>
      </header>

      {/* Main Form Content */}
      <form onSubmit={handleSubmit} className="px-5 py-6 space-y-6 flex-1">
        {/* Error Banner */}
        {submitError && (
          <div 
            id="create-group-error-banner"
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs leading-snug"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1">{submitError}</div>
          </div>
        )}

        {/* 1. Cover Image Section */}
        <section id="group-cover-section" className="space-y-2">
          <label htmlFor="group-cover-url" className="flex items-center justify-between text-[11px] font-medium text-stone-300">
            <span className="flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-stone-400" />
              <span>Cover (Optional)</span>
            </span>
            {coverUrl && !coverLoadFailed && !isTestingCover && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" /> Valid image
              </span>
            )}
            {coverLoadFailed && (
              <span className="text-[10px] text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Could not load image
              </span>
            )}
          </label>

          {/* Cover Preview Area */}
          <div className="relative w-full h-32 rounded-2xl bg-stone-900/80 border border-stone-800 overflow-hidden flex items-center justify-center">
            {coverUrl && !coverLoadFailed ? (
              <img 
                src={coverUrl} 
                alt="Group cover preview" 
                className="w-full h-full object-cover"
                onError={() => setCoverLoadFailed(true)}
              />
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-stone-500 text-center p-4">
                <ImageIcon className="w-6 h-6 stroke-[1.5]" />
                <span className="text-[11px]">No cover selected</span>
              </div>
            )}
            {isTestingCover && (
              <div className="absolute inset-0 bg-stone-950/70 flex items-center justify-center text-xs text-stone-300 gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                <span>Checking image...</span>
              </div>
            )}
          </div>

          {/* Input & Storage Note */}
          <div className="space-y-1">
            <input
              id="group-cover-url"
              type="url"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://example.com/cover.jpg"
              className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900/80 border border-stone-800 text-stone-100 placeholder-stone-600 text-xs focus:outline-none focus:border-stone-600 transition-colors"
            />
            <p className="text-[10px] text-stone-500 leading-relaxed">
              Permanent device upload will arrive when the public storage bucket is configured. You can provide an image link or continue without a cover.
            </p>
          </div>
        </section>

        {/* 2. Group Name */}
        <section id="group-name-section" className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="group-name-input" className="text-[11px] font-medium text-stone-300">
              Group Name <span className="text-amber-400">*</span>
            </label>
            <span className={`text-[10px] font-mono ${name.trim().length > 60 || (name.trim().length > 0 && name.trim().length < 2) ? 'text-rose-400' : 'text-stone-500'}`}>
              {name.trim().length}/60
            </span>
          </div>
          <input
            id="group-name-input"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekend Film Lab"
            maxLength={60}
            className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900/80 border border-stone-800 text-stone-100 placeholder-stone-600 text-xs focus:outline-none focus:border-stone-600 transition-colors"
          />
        </section>

        {/* 3. Group Reason / Purpose */}
        <section id="group-reason-section" className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="group-reason-input" className="text-[11px] font-medium text-stone-300">
              Reason / Intentional Purpose <span className="text-amber-400">*</span>
            </label>
            <span className={`text-[10px] font-mono ${reason.trim().length > 300 || (reason.trim().length > 0 && reason.trim().length < 3) ? 'text-rose-400' : 'text-stone-500'}`}>
              {reason.trim().length}/300
            </span>
          </div>
          <textarea
            id="group-reason-input"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe the shared temporary purpose for this group..."
            maxLength={300}
            className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900/80 border border-stone-800 text-stone-100 placeholder-stone-600 text-xs focus:outline-none focus:border-stone-600 transition-colors resize-none leading-relaxed"
          />
          <p className="text-[10px] text-stone-500">
            Tchat groups are centered around a clear, temporary intention rather than indefinite channels.
          </p>
        </section>

        {/* 4. Lifetime (1 day, 3 days, 1 week) */}
        <section id="group-lifetime-section" className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-stone-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-stone-400" />
              <span>Lifetime</span>
            </label>
            <span className="text-[10px] text-stone-500">Temporary by default</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {LIFETIME_OPTIONS.map((opt) => {
              const isSelected = lifetime === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`lifetime-option-${opt.id}`}
                  type="button"
                  onClick={() => setLifetime(opt.id)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[76px] ${
                    isSelected
                      ? 'bg-stone-100 border-stone-100 text-stone-950 font-medium shadow-sm'
                      : 'bg-stone-900/50 border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                  }`}
                >
                  <span className="text-xs font-semibold">{opt.label}</span>
                  <span className={`text-[10px] leading-tight line-clamp-2 ${isSelected ? 'text-stone-700' : 'text-stone-500'}`}>
                    {opt.description}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 5. Visibility (Private vs Discoverable) */}
        <section id="group-visibility-section" className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-stone-300">
              Visibility
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {VISIBILITY_OPTIONS.map((opt) => {
              const isSelected = visibility === opt.id;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  id={`visibility-option-${opt.id}`}
                  type="button"
                  onClick={() => setVisibility(opt.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-stone-100 border-stone-100 text-stone-950 font-medium'
                      : 'bg-stone-900/50 border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" />
                    <span className="text-xs font-semibold">{opt.label}</span>
                  </div>
                  <span className={`text-[10px] leading-tight ${isSelected ? 'text-stone-700' : 'text-stone-500'}`}>
                    {opt.description}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 6. Joining Method (Open, Request, Question) */}
        <section id="group-access-mode-section" className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-stone-300">
              Joining Method
            </label>
            {visibility === 'private' && (
              <span className="text-[10px] text-amber-400/90 font-medium">
                Open is unavailable for Private groups
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Open */}
            <button
              id="access-mode-open"
              type="button"
              disabled={visibility === 'private'}
              onClick={() => setAccessMode('open')}
              className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[74px] ${
                visibility === 'private'
                  ? 'opacity-40 cursor-not-allowed bg-stone-900/30 border-stone-800/40 text-stone-600'
                  : accessMode === 'open'
                  ? 'bg-stone-100 border-stone-100 text-stone-950 font-medium cursor-pointer'
                  : 'bg-stone-900/50 border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700 cursor-pointer'
              }`}
            >
              <span className="text-xs font-semibold">Open</span>
              <span className={`text-[10px] leading-tight ${accessMode === 'open' && visibility !== 'private' ? 'text-stone-700' : 'text-stone-500'}`}>
                Anyone can join immediately
              </span>
            </button>

            {/* Request */}
            <button
              id="access-mode-request"
              type="button"
              onClick={() => setAccessMode('request')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[74px] ${
                accessMode === 'request'
                  ? 'bg-stone-100 border-stone-100 text-stone-950 font-medium'
                  : 'bg-stone-900/50 border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700'
              }`}
            >
              <span className="text-xs font-semibold">Request</span>
              <span className={`text-[10px] leading-tight ${accessMode === 'request' ? 'text-stone-700' : 'text-stone-500'}`}>
                Requires admin / mod approval
              </span>
            </button>

            {/* Question */}
            <button
              id="access-mode-question"
              type="button"
              onClick={() => setAccessMode('question')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[74px] ${
                accessMode === 'question'
                  ? 'bg-stone-100 border-stone-100 text-stone-950 font-medium'
                  : 'bg-stone-900/50 border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700'
              }`}
            >
              <span className="text-xs font-semibold">Question</span>
              <span className={`text-[10px] leading-tight ${accessMode === 'question' ? 'text-stone-700' : 'text-stone-500'}`}>
                Members must answer your prompt
              </span>
            </button>
          </div>

          {/* Conditional Joining Question Field */}
          {accessMode === 'question' && (
            <div id="joining-question-field" className="pt-2 space-y-1.5 animate-fadeIn">
              <div className="flex items-center justify-between">
                <label htmlFor="input-joining-question" className="text-[11px] font-medium text-amber-300 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Joining Question <span className="text-amber-400">*</span></span>
                </label>
                <span className={`text-[10px] font-mono ${joiningQuestion.trim().length > 300 || (joiningQuestion.trim().length > 0 && joiningQuestion.trim().length < 3) ? 'text-rose-400' : 'text-stone-500'}`}>
                  {joiningQuestion.trim().length}/300
                </span>
              </div>
              <textarea
                id="input-joining-question"
                required
                rows={2}
                value={joiningQuestion}
                onChange={(e) => setJoiningQuestion(e.target.value)}
                placeholder="e.g. What brings you to this lab, or what would you like to build?"
                maxLength={300}
                className="w-full px-3.5 py-2.5 rounded-xl bg-amber-950/20 border border-amber-800/40 text-stone-100 placeholder-stone-500 text-xs focus:outline-none focus:border-amber-600 transition-colors resize-none leading-relaxed"
              />
              <p className="text-[10px] text-stone-500">
                Applicants must provide an answer when requesting to join. You review the answer before admitting them.
              </p>
            </div>
          )}
        </section>

        {/* 7. Maximum Size (2–30) */}
        <section id="group-max-size-section" className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="group-max-size-slider" className="text-[11px] font-medium text-stone-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-stone-400" />
              <span>Maximum Size</span>
            </label>
            <span className="text-xs font-mono font-semibold text-stone-200">
              {maxSize} {maxSize === 1 ? 'member' : 'members'}
            </span>
          </div>

          <div className="flex items-center gap-4 bg-stone-900/50 p-3.5 rounded-xl border border-stone-800/70">
            <input
              id="group-max-size-slider"
              type="range"
              min={2}
              max={30}
              step={1}
              value={maxSize}
              onChange={(e) => setMaxSize(Number(e.target.value))}
              className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-stone-200"
            />
          </div>
          <div className="flex justify-between text-[10px] text-stone-500 font-mono px-1">
            <span>2 min</span>
            <span>30 max</span>
          </div>
        </section>

        {/* Submit Button */}
        <div className="pt-2 pb-6">
          <button
            id="btn-submit-create-group"
            type="submit"
            disabled={isSubmitting || !isNameValid || !isReasonValid || !isQuestionValid}
            className="w-full py-3.5 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-black/40"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-stone-800" />
                <span>Creating Group on Server...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-stone-800" />
                <span>Create Group</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
