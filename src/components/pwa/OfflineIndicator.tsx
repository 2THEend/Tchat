import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) {
    return null;
  }

  return (
    <div 
      id="status-offline-indicator"
      role="status"
      aria-live="polite"
      className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-stone-900/95 border border-stone-700 text-stone-300 text-[11px] font-medium shadow-lg backdrop-blur-sm pointer-events-none"
    >
      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
      <WifiOff className="w-3.5 h-3.5 text-stone-400" />
      <span>Offline — Cached app shell</span>
    </div>
  );
}
