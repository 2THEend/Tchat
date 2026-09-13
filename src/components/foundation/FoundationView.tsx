import { CheckCircle2, ShieldCheck, Database, Smartphone, Layers, AlertTriangle } from 'lucide-react';
import { NavigationPlace } from '../../types/navigation';
import { env } from '../../config/env';

interface FoundationViewProps {
  currentPlace: NavigationPlace;
}

export function FoundationView({ currentPlace }: FoundationViewProps) {
  if (currentPlace === 'feed') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-stone-900 border border-stone-800/80 flex items-center justify-center mb-4 text-stone-400">
          <Layers className="w-5 h-5 stroke-[1.8]" />
        </div>
        <h2 className="text-base font-semibold text-stone-200 mb-1">Discovery Feed</h2>
        <p className="text-xs text-stone-400 max-w-xs leading-relaxed">
          Broader social discovery space. Scheduled for implementation following core identity and connection domains.
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-stone-900 border border-stone-800 text-stone-400">
          Domain: feed · Planned
        </span>
      </div>
    );
  }

  if (currentPlace === 'profile') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-stone-900 border border-stone-800/80 flex items-center justify-center mb-4 text-stone-400">
          <ShieldCheck className="w-5 h-5 stroke-[1.8]" />
        </div>
        <h2 className="text-base font-semibold text-stone-200 mb-1">Identity & Profile</h2>
        <p className="text-xs text-stone-400 max-w-xs leading-relaxed">
          User account identity, intentional presence, and privacy controls. Scheduled for subsequent review cycle.
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-stone-900 border border-stone-800 text-stone-400">
          Domain: identity · Planned
        </span>
      </div>
    );
  }

  // 'home' place - primary landing showing foundation status
  return (
    <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
      {/* Header section */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-wider uppercase text-stone-400">
            System Initialization
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Foundation Ready
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-100">
          Tchat
        </h1>
        <p className="text-xs text-stone-400 leading-relaxed">
          Intentional, temporary human interaction. Application shell and mobile runtime foundation verified.
        </p>
      </div>

      {/* Supabase backend status */}
      <div 
        id="status-supabase-card"
        className="p-4 rounded-2xl bg-stone-900/70 border border-stone-800/80 space-y-3"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
              env.isSupabaseConfigured 
                ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-400' 
                : 'bg-amber-950/40 border-amber-800/40 text-amber-400'
            }`}>
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-stone-200">Supabase Backend</div>
              <div className="text-[11px] text-stone-400">
                {env.isSupabaseConfigured ? 'Connection credentials configured' : 'Awaiting project credentials'}
              </div>
            </div>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
            env.isSupabaseConfigured
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/50'
              : 'bg-amber-950/80 text-amber-300 border-amber-800/50'
          }`}>
            {env.isSupabaseConfigured ? 'Ready' : 'Pending Env'}
          </span>
        </div>

        {!env.isSupabaseConfigured && (
          <div className="flex items-start gap-2 pt-2 border-t border-stone-800/60 text-[11px] text-stone-400">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Provide <code className="text-stone-300 bg-stone-800/80 px-1 py-0.5 rounded">VITE_SUPABASE_URL</code> and <code className="text-stone-300 bg-stone-800/80 px-1 py-0.5 rounded">VITE_SUPABASE_PUBLISHABLE_KEY</code> to enable live database and auth sessions.
            </span>
          </div>
        )}
      </div>

      {/* Verified Foundation Checklist */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400 px-1">
          Verified Capabilities
        </h2>
        <div className="space-y-2">
          {[
            {
              id: 'mobile-shell',
              icon: Smartphone,
              title: 'Mobile-First Shell',
              desc: 'Calm, responsive iOS-inspired layout with safe-area spacing and touch optimization.',
            },
            {
              id: 'navigation',
              icon: Layers,
              title: 'Contextual Navigation',
              desc: 'Permanent 3-place model (Home, Feed, Profile). Contextual surfaces reserved for events.',
            },
            {
              id: 'architecture',
              icon: ShieldCheck,
              title: 'Modular Monolith Architecture',
              desc: 'Separation of domains, strict TypeScript types, and honest unmocked state lifecycle.',
            },
            {
              id: 'error-handling',
              icon: CheckCircle2,
              title: 'Error Boundary & Stability',
              desc: 'Graceful fault containment with safe recovery and zero unhandled crash surfaces.',
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                id={`check-${item.id}`}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-stone-900/40 border border-stone-800/60"
              >
                <div className="w-6 h-6 rounded-lg bg-stone-800/70 border border-stone-700/40 flex items-center justify-center text-stone-300 shrink-0 mt-0.5">
                  <Icon className="w-3.5 h-3.5 stroke-[2]" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-stone-200 leading-snug">
                    {item.title}
                  </div>
                  <div className="text-[11px] text-stone-400 mt-0.5 leading-relaxed">
                    {item.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Intentional Product Principles Note */}
      <div className="p-4 rounded-2xl bg-stone-900/30 border border-stone-800/50 space-y-1.5">
        <div className="text-[11px] font-semibold text-stone-300">
          Core Operating Principle
        </div>
        <p className="text-[11px] text-stone-400 leading-relaxed">
          Home represents user social activity today. Connections and conversations remain separate concepts, media is ephemeral by default, and presence conveys active session use rather than forced availability.
        </p>
      </div>
    </div>
  );
}
