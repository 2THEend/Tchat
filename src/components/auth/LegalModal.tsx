import { X, ShieldAlert, FileText, Lock } from 'lucide-react';
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
    >
      <div 
        id="legal-modal-content"
        className="w-full sm:max-w-md max-h-[85vh] bg-stone-950 border border-stone-800 rounded-t-[32px] sm:rounded-3xl flex flex-col overflow-hidden text-stone-100 shadow-2xl"
      >
        {/* Header */}
        <header className="px-6 pt-5 pb-3 border-b border-stone-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isTerms ? (
              <FileText className="w-4 h-4 text-stone-400 stroke-[2]" />
            ) : (
              <Lock className="w-4 h-4 text-stone-400 stroke-[2]" />
            )}
            <h2 id="legal-modal-title" className="text-sm font-semibold tracking-tight text-stone-200">
              {isTerms ? 'Terms of Service' : 'Privacy Policy'}
            </h2>
          </div>
          <button
            id="btn-close-legal-modal"
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-900 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs leading-relaxed text-stone-400">
          {/* Explicit Pending Status Notice */}
          <div 
            id="legal-status-banner"
            className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300/90 text-[11px] leading-snug"
          >
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-300">Status: Pending Official Legal Publication</span>
              <p className="mt-0.5 text-amber-300/80">
                Official legal documentation is currently pending final publication. The points below outline the structural principles governing Tchat.
              </p>
            </div>
          </div>

          {isTerms ? (
            <div className="space-y-3.5">
              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">1. Intentional Interaction</h3>
                <p>
                  Tchat is a space designed for intentional, temporary human communication. Accounts are created to foster meaningful, temporary touchpoints rather than continuous engagement metrics.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">2. Ephemeral Media & Circles</h3>
                <p>
                  By default, media, daily circles, and social activities are designed to be ephemeral. Users acknowledge that temporary content expires according to platform rules.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">3. Account Responsibility</h3>
                <p>
                  You are responsible for securing your login credentials and maintaining an accessible email address for account recovery. Usernames must conform to platform naming standards.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">4. Misuse & Suspension</h3>
                <p>
                  Harassment, automated scraping, unauthorized credential access, or circumventing platform boundaries are prohibited and may result in account deactivation.
                </p>
              </section>
            </div>
          ) : (
            <div className="space-y-3.5">
              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">1. Data Minimization</h3>
                <p>
                  We collect only the minimum information required to authenticate you and deliver temporary social interactions: your email address for account security, your chosen username, and optional profile fields.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">2. Privacy of Authentication Credentials</h3>
                <p>
                  Your email address is strictly an authentication and recovery mechanism. It is never displayed publicly or accessible to other users through Tchat profile discovery.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">3. Ephemeral Storage</h3>
                <p>
                  Social media and temporary activities are subject to automatic lifecycle expiration, reducing unnecessary long-term data retention.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-stone-200">4. Third-Party Authentication</h3>
                <p>
                  When using third-party providers such as Google, we receive only the authorized email and basic profile data necessary to initiate your Tchat account.
                </p>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 border-t border-stone-900 bg-stone-950/80 flex justify-end">
          <button
            id="btn-understand-legal"
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold transition-colors cursor-pointer"
          >
            Understood
          </button>
        </footer>
      </div>
    </div>
  );
}
