import React from 'react';
import { Compass, Sparkles, MessageCircle, ShieldCheck } from 'lucide-react';

export const FeedView: React.FC = () => {
  return (
    <div 
      id="feed-view-container" 
      className="flex-1 overflow-y-auto px-5 py-6 space-y-6"
    >
      {/* Title */}
      <div className="space-y-1">
        <span className="text-[11px] font-semibold tracking-wider uppercase text-stone-400">
          Discovery Space
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-stone-100">
          Feed
        </h1>
      </div>

      {/* Discovery Philosophy Card */}
      <div className="p-5 rounded-3xl bg-stone-900/60 border border-stone-800/80 space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300">
          <Compass className="w-6 h-6 stroke-[1.7]" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-stone-100">
            Broader Social Discovery
          </h2>
          <p className="text-xs text-stone-400 leading-relaxed">
            Feed is designed for intentional social discovery, not an infinite engagement loop. Posts here are temporary human perspectives shared with the community.
          </p>
        </div>

        <div className="pt-2 border-t border-stone-800/60 space-y-2.5 text-xs text-stone-300">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
            <span className="text-[11px] text-stone-400 leading-relaxed">
              Public interaction does not automatically create a connection. Every 1:1 relationship requires mutual intent.
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
            <span className="text-[11px] text-stone-400 leading-relaxed">
              Content is designed with natural expiration rather than algorithm-driven virality.
            </span>
          </div>
        </div>
      </div>

      {/* Upcoming Milestone Notice */}
      <div className="p-4 rounded-2xl bg-stone-900/30 border border-stone-800/40 text-center space-y-1.5">
        <p className="text-xs font-medium text-stone-300">
          Discovery Domain In Development
        </p>
        <p className="text-[11px] text-stone-400 max-w-xs mx-auto leading-relaxed">
          The public feed domain will be integrated in a dedicated milestone following 1:1 conversation maturity.
        </p>
      </div>
    </div>
  );
};
