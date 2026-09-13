import { useState } from 'react';
import { Download, Share2, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from './usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'badge' | 'full';
  className?: string;
}

export function PWAInstallButton({ variant = 'compact', className = '' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState<boolean>(false);

  // Do not render anything if already installed as standalone PWA
  if (isInstalled) {
    return null;
  }

  // Neither Android/desktop beforeinstallprompt fired, nor iOS
  if (!isInstallable && !isIOS) {
    return null;
  }

  const handleAction = () => {
    if (isInstallable) {
      install();
    } else if (isIOS) {
      setShowIOSModal(true);
    }
  };

  return (
    <>
      {variant === 'compact' ? (
        <button
          id="btn-pwa-install-compact"
          type="button"
          onClick={handleAction}
          title="Install Tchat"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900/90 hover:bg-stone-800 text-stone-300 hover:text-stone-100 border border-stone-800 text-[11px] font-medium transition-colors cursor-pointer ${className}`}
        >
          {isIOS ? <Share2 className="w-3 h-3 text-stone-400" /> : <Download className="w-3 h-3 text-stone-400" />}
          <span>Install</span>
        </button>
      ) : variant === 'badge' ? (
        <button
          id="btn-pwa-install-badge"
          type="button"
          onClick={handleAction}
          className={`w-full flex items-center justify-between p-3 rounded-xl bg-stone-900/60 border border-stone-800/80 hover:border-stone-700 text-left transition-colors cursor-pointer ${className}`}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-stone-800/80 flex items-center justify-center text-stone-300">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-stone-200">Install Tchat App</p>
              <p className="text-[11px] text-stone-500">Add to home screen for full standalone experience</p>
            </div>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-stone-800 text-stone-300 text-[11px] font-medium">
            Install
          </div>
        </button>
      ) : (
        <button
          id="btn-pwa-install-full"
          type="button"
          onClick={handleAction}
          className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors cursor-pointer ${className}`}
        >
          {isIOS ? <Share2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
          <span>Install Tchat to Home Screen</span>
        </button>
      )}

      {/* iOS Safari Guided Install Sheet */}
      {showIOSModal && (
        <div 
          id="modal-ios-install"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={() => setShowIOSModal(false)}
        >
          <div 
            className="w-full max-w-sm rounded-2xl bg-stone-900 border border-stone-800 p-5 shadow-2xl text-stone-100 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-stone-950 border border-stone-800 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-amber-500/90" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-stone-100">Install Tchat on iPhone / iPad</h3>
                  <p className="text-[11px] text-stone-400">Mobile Safari Home Screen setup</p>
                </div>
              </div>
              <button
                id="btn-close-ios-modal"
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 py-2 text-xs text-stone-300">
              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/60">
                <span className="w-5 h-5 rounded-full bg-stone-800 text-stone-300 font-mono text-[10px] flex items-center justify-center shrink-0 mt-0.5">1</span>
                <p>
                  Tap the <strong className="text-stone-100 font-semibold">Share</strong> button in the bottom Safari toolbar.
                </p>
              </div>
              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/60">
                <span className="w-5 h-5 rounded-full bg-stone-800 text-stone-300 font-mono text-[10px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                <p>
                  Scroll down the share sheet and tap <strong className="text-stone-100 font-semibold">Add to Home Screen</strong>.
                </p>
              </div>
              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/60">
                <span className="w-5 h-5 rounded-full bg-stone-800 text-stone-300 font-mono text-[10px] flex items-center justify-center shrink-0 mt-0.5">3</span>
                <p>
                  Tap <strong className="text-stone-100 font-semibold">Add</strong> in the top-right corner to launch Tchat standalone.
                </p>
              </div>
            </div>

            <button
              id="btn-dismiss-ios-guide"
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="mt-4 w-full py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
