import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  AlertCircle, 
  RotateCw, 
  Volume2, 
  Loader2 
} from 'lucide-react';
import { TchatCall } from '../../../domains/calls/types';
import { formatCallReason } from '../../../domains/calls/validation';
import { 
  WebRTCCallManager, 
  WebRTCConnectionStatus, 
  WebRTCStateChange 
} from '../../../domains/calls/webrtcService';
import { endCallSession } from '../../../domains/calls/callsService';

interface ActiveCallSessionProps {
  call: TchatCall;
  currentUserId: string;
  partnerName: string;
  onCallUpdated: () => void;
}

export const ActiveCallSession: React.FC<ActiveCallSessionProps> = ({
  call,
  currentUserId,
  partnerName,
  onCallUpdated,
}) => {
  const [webrtcStatus, setWebrtcStatus] = useState<WebRTCConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [durationSeconds, setDurationSeconds] = useState<number>(0);
  const [isEnding, setIsEnding] = useState<boolean>(false);

  const managerRef = useRef<WebRTCCallManager | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isInitiator = call.initiator_id === currentUserId;

  const onCallUpdatedRef = useRef(onCallUpdated);
  useEffect(() => {
    onCallUpdatedRef.current = onCallUpdated;
  }, [onCallUpdated]);

  // Handles state updates from WebRTC engine
  const handleStateChange = useCallback((state: WebRTCStateChange) => {
    console.info(`[ActiveCallSession] WebRTC state change: ${state.status}`, state.errorMessage || '');
    setWebrtcStatus(state.status);
    setIsMuted(!!state.isMuted);

    if (state.errorMessage) {
      setErrorMessage(state.errorMessage);
    }

    if (state.status === 'connected') {
      setErrorMessage(null);
    }

    if (state.status === 'ended') {
      onCallUpdatedRef.current();
    }
  }, []);

  const handleRemoteStream = useCallback((stream: MediaStream) => {
    console.info('[ActiveCallSession] Remote stream attached to audio element');
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play().catch((err) => {
        console.warn('[ActiveCallSession] Audio autoplay prevented:', err);
      });
    }
  }, []);

  // Initialize and start WebRTC calling engine
  const startCall = useCallback(() => {
    if (managerRef.current) {
      console.info('[ActiveCallSession] Cleaning up previous WebRTC manager before starting new session');
      managerRef.current.cleanup();
      managerRef.current = null;
    }

    setErrorMessage(null);
    setWebrtcStatus('connecting');

    const manager = new WebRTCCallManager({
      callId: call.id,
      currentUserId,
      isInitiator,
      onStateChange: handleStateChange,
      onRemoteStream: handleRemoteStream,
    });

    managerRef.current = manager;
    manager.start();
  }, [call.id, currentUserId, isInitiator, handleStateChange, handleRemoteStream]);

  // Automatically initiate WebRTC connection on mount for this call
  // CRITICAL: We depend strictly on call.id, NOT call.status.
  // When call.status transitions (e.g. accepted -> connecting -> connected),
  // we must NOT tear down and destroy the active RTCPeerConnection!
  useEffect(() => {
    if (call.status === 'accepted' || call.status === 'connecting' || call.status === 'connected') {
      if (!managerRef.current) {
        startCall();
      }
    }

    return () => {
      if (managerRef.current) {
        console.info('[ActiveCallSession] Unmounting or call ID changed; cleaning up WebRTC manager');
        managerRef.current.cleanup();
        managerRef.current = null;
      }
    };
  }, [call.id, startCall]);

  // Duration counter when call is connected
  useEffect(() => {
    if (webrtcStatus === 'connected') {
      const interval = setInterval(() => {
        setDurationSeconds((prev) => prev + 1);
      }, 1000);
      durationTimerRef.current = interval;
      return () => clearInterval(interval);
    } else {
      setDurationSeconds(0);
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    }
  }, [webrtcStatus]);

  // Window unload cleanup
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (managerRef.current) {
        managerRef.current.cleanup();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const handleToggleMute = () => {
    if (managerRef.current) {
      const muted = managerRef.current.toggleMute();
      setIsMuted(muted);
    }
  };

  const handleEndCall = async () => {
    setIsEnding(true);
    try {
      if (managerRef.current) {
        await managerRef.current.endCall();
        managerRef.current = null;
      } else {
        await endCallSession(call.id);
      }
      onCallUpdated();
    } catch (err: unknown) {
      console.error('[ActiveCallSession] Failed to end call:', err);
    } finally {
      setIsEnding(false);
    }
  };

  const formatDuration = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formattedReason = formatCallReason(call);

  return (
    <div
      id={`active-call-session-${call.id}`}
      className="px-4 py-3 bg-stone-900 border-b border-stone-800 backdrop-blur-md shadow-lg transition-all animate-in fade-in duration-200"
    >
      {/* Hidden audio element for remote audio stream playback */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="flex items-center justify-between gap-3">
        {/* Left side: Call Info & Status */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
              webrtcStatus === 'connected'
                ? 'bg-emerald-950/80 border-emerald-600 text-emerald-400 animate-pulse'
                : webrtcStatus === 'failed'
                ? 'bg-rose-950/80 border-rose-700 text-rose-400'
                : 'bg-stone-800 border-stone-700 text-amber-400'
            }`}
          >
            {webrtcStatus === 'connected' ? (
              <Volume2 className="w-5 h-5" />
            ) : webrtcStatus === 'failed' ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-stone-100 truncate">
                {partnerName}
              </span>

              {webrtcStatus === 'connected' && (
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                  {formatDuration(durationSeconds)}
                </span>
              )}

              {webrtcStatus === 'requesting_permissions' && (
                <span className="text-xs text-amber-400 bg-amber-950/50 border border-amber-800/40 px-2 py-0.5 rounded-full">
                  Requesting mic access...
                </span>
              )}

              {webrtcStatus === 'connecting' && (
                <span className="text-xs text-amber-400 bg-amber-950/50 border border-amber-800/40 px-2 py-0.5 rounded-full">
                  Connecting audio...
                </span>
              )}

              {webrtcStatus === 'failed' && (
                <span className="text-xs text-rose-400 bg-rose-950/50 border border-rose-800/40 px-2 py-0.5 rounded-full">
                  Connection failed
                </span>
              )}
            </div>

            <p className="text-xs text-stone-400 mt-0.5 truncate">
              {formattedReason}
            </p>

            {errorMessage && (
              <p className="text-xs text-rose-400 mt-1 font-mono flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {errorMessage}
              </p>
            )}
          </div>
        </div>

        {/* Right side: Interactive Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {webrtcStatus === 'connected' && (
            <button
              type="button"
              onClick={handleToggleMute}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors border ${
                isMuted
                  ? 'bg-rose-950/80 border-rose-700 text-rose-300 hover:bg-rose-900'
                  : 'bg-stone-800 border-stone-700 text-stone-200 hover:bg-stone-750'
              }`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}

          {webrtcStatus === 'failed' && (
            <button
              type="button"
              onClick={startCall}
              className="px-3 py-1.5 rounded-lg bg-stone-800 border border-stone-700 text-stone-200 hover:bg-stone-750 text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}

          <button
            type="button"
            onClick={handleEndCall}
            disabled={isEnding}
            className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-medium flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
            title="End Call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>End Call</span>
          </button>
        </div>
      </div>
    </div>
  );
};
