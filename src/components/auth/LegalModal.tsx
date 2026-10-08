import { X, FileText, Lock } from 'lucide-react';
import { LegalDocumentType } from '../../domains/auth/types';

interface LegalModalProps {
  type: LegalDocumentType;
  onClose: () => void;
}

export function LegalModal({ type, onClose }: LegalModalProps) {
  const isTerms = type === 'terms';

  return (
    <div 
      id="legal-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div 
        id="legal-modal-content"
        className="w-full sm:max-w-md max-h-[85vh] bg-stone-950 border border-stone-800/90 rounded-t-[32px] sm:rounded-3xl flex flex-col overflow-hidden text-stone-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-6 pt-5 pb-4 border-b border-stone-900 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isTerms ? (
              <FileText className="w-4 h-4 text-stone-400" />
            ) : (
              <Lock className="w-4 h-4 text-stone-400" />
            )}
            <h2 id="legal-modal-title" className="text-sm font-semibold tracking-tight text-stone-100">
              {isTerms ? 'Terms of Service' : 'Privacy Policy'}
            </h2>
          </div>
          <button
            id="btn-close-legal-modal"
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-stone-400 hover:text-stone-100 hover:bg-stone-900 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs leading-relaxed text-stone-400">
          <div 
            id="legal-status-banner"
            className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800/80 text-stone-300 text-xs leading-relaxed"
          >
            <p className="font-medium text-stone-200">Core Platform Principles</p>
            <p className="mt-1 text-stone-400">
              The principles below govern how Tchat operates as a low-noise, temporary social communication space.
            </p>
          </div>

          {isTerms ? (
            <div className="space-y-4">
              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">01. Intentional Interaction</h3>
                <p>
                  Tchat is built for deliberate, temporary human communication. Connections and conversations remain distinct, and interaction is never driven by algorithmic feeds.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">02. Ephemeral Media & Circles</h3>
                <p>
                  Media, temporary groups, and circles expire by default according to their lifecycle rules rather than accumulating permanent public archives.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">03. Account Responsibility</h3>
                <p>
                  You are responsible for safeguarding your credentials and maintaining a valid recovery email address. Usernames must follow community naming standards.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">04. Safety & Respect</h3>
                <p>
                  Harassment, automated scraping, or attempts to bypass blocking and platform boundaries result in account restriction.
                </p>
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">01. Data Minimization</h3>
                <p>
                  We collect only what is required to authenticate you and deliver intentional social interactions: your private recovery email, your public handle, and optional profile details.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">02. Private Credentials</h3>
                <p>
                  Your email address is used strictly for authentication and account recovery. It is never displayed on your public profile or exposed in search.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">03. Ephemeral Lifecycles</h3>
                <p>
                  Temporary media, posts, and group spaces expire automatically in accordance with their configured lifecycles.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">04. Third-Party Sign-In</h3>
                <p>
                  When signing in with Google, Tchat receives only your verified email address and basic profile fields needed to initialize your account.
                </p>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 border-t border-stone-900 bg-stone-950 flex justify-end">
          <button
            id="btn-understand-legal"
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto h-10 px-5 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold transition-colors cursor-pointer"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
