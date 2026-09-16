/**
 * Tchat WebRTC Calling Engine (Phase 2)
 * 
 * Manages 1:1 microphone audio calling lifecycle:
 * - Peer-to-peer WebRTC (RTCPeerConnection)
 * - Ephemeral signaling over authorized Supabase Realtime Broadcast
 * - Audio track acquisition, mute/unmute, and playback
 * - Technical session transitions and server-side RPC confirmations
 * - Robust cleanup on hangup, failure, and window unload
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import {
  SignalingPayload,
  OfferSignalingPayload,
  AnswerSignalingPayload,
  IceCandidateSignalingPayload,
  ByeSignalingPayload,
  getCallSignalingTopic,
  isValidSignalingPayload,
} from './signaling';
import {
  startCallSession,
  confirmCallConnection,
  recordCallSessionFailure,
  endCallSession,
} from './callsService';

export type WebRTCConnectionStatus =
  | 'idle'
  | 'requesting_permissions'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'ended';

export interface WebRTCStateChange {
  status: WebRTCConnectionStatus;
  errorMessage?: string | null;
  sessionId?: string | null;
  isMuted?: boolean;
  remoteStream?: MediaStream | null;
}

export interface WebRTCCallOptions {
  callId: string;
  currentUserId: string;
  isInitiator: boolean;
  onStateChange: (state: WebRTCStateChange) => void;
  onRemoteStream?: (stream: MediaStream) => void;
}

// Standard public STUN servers for NAT traversal in 1:1 prototyping
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 2,
};

export class WebRTCCallManager {
  private callId: string;
  private currentUserId: string;
  private isInitiator: boolean;
  private sessionId: string | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private signalingChannel: RealtimeChannel | null = null;
  private onStateChange: (state: WebRTCStateChange) => void;
  private onRemoteStream?: (stream: MediaStream) => void;
  private status: WebRTCConnectionStatus = 'idle';
  private isMuted = false;
  private isCleaningUp = false;
  private offerRetryTimer: NodeJS.Timeout | null = null;
  private connectionTimeoutTimer: NodeJS.Timeout | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(options: WebRTCCallOptions) {
    this.callId = options.callId;
    this.currentUserId = options.currentUserId;
    this.isInitiator = options.isInitiator;
    this.onStateChange = options.onStateChange;
    this.onRemoteStream = options.onRemoteStream;
  }

  /**
   * Initializes media permissions, creates the call session, and starts signaling.
   */
  public async start(): Promise<void> {
    if (this.status !== 'idle') return;

    // 1. Check browser WebRTC API support
    if (
      typeof window === 'undefined' ||
      !window.RTCPeerConnection ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      this.updateStatus('failed', 'Your browser does not support WebRTC audio calls.');
      return;
    }

    try {
      // 2. Request microphone permission
      this.updateStatus('requesting_permissions');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (mediaErr: unknown) {
        const error = mediaErr as Error;
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          this.updateStatus(
            'failed',
            'Microphone access denied. Please grant microphone permissions to make calls.'
          );
          return;
        }
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          this.updateStatus('failed', 'No microphone detected on your device.');
          return;
        }
        this.updateStatus('failed', `Could not access microphone: ${error.message}`);
        return;
      }

      this.localStream = stream;

      // 3. Register or reuse technical call session via secure RPC
      this.updateStatus('connecting');
      const sessionResult = await startCallSession(this.callId);
      if (sessionResult.error || !sessionResult.data) {
        this.cleanupLocalMedia();
        this.updateStatus('failed', sessionResult.error || 'Failed to initialize call session.');
        return;
      }

      this.sessionId = sessionResult.data.session_id;

      // 4. Initialize RTCPeerConnection
      this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

      // Add local audio tracks to peer connection
      this.localStream.getAudioTracks().forEach((track) => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });

      // Handle remote audio track arrival
      this.peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          this.remoteStream = event.streams[0];
          this.onRemoteStream?.(this.remoteStream);
          this.onStateChange({
            status: this.status,
            remoteStream: this.remoteStream,
            isMuted: this.isMuted,
            sessionId: this.sessionId,
          });
        }
      };

      // Handle ICE candidate generation
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.sessionId) {
          this.broadcastSignaling({
            type: 'ice_candidate',
            call_id: this.callId,
            session_id: this.sessionId,
            sender_id: this.currentUserId,
            timestamp: new Date().toISOString(),
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // Handle connection state changes
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        if (state === 'connected') {
          this.handleConnected();
        } else if (state === 'failed' || state === 'disconnected') {
          this.handleConnectionFailure('WebRTC peer connection lost or failed.');
        }
      };

      // 5. Connect to authorized private Supabase Realtime Broadcast channel
      await this.setupSignalingChannel();

      // Set timeout for connection establishment (30s)
      this.connectionTimeoutTimer = setTimeout(() => {
        if (this.status === 'connecting') {
          this.handleConnectionFailure('Connection timed out. Remote peer did not connect.');
        }
      }, 30000);

      // 6. If initiator, create and send the initial SDP Offer
      if (this.isInitiator) {
        await this.createAndSendOffer();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error starting call.';
      this.handleConnectionFailure(msg);
    }
  }

  /**
   * Sets up the Supabase Realtime private signaling channel.
   */
  private async setupSignalingChannel(): Promise<void> {
    if (!supabase) throw new Error('Supabase client is not available.');

    const topic = getCallSignalingTopic(this.callId);

    // Create private channel with broadcast listening
    this.signalingChannel = supabase.channel(topic, {
      config: {
        private: true,
        broadcast: { ack: false, self: false },
      },
    });

    this.signalingChannel.on(
      'broadcast',
      { event: 'signal' },
      ({ payload }: { payload: unknown }) => {
        if (isValidSignalingPayload(payload)) {
          this.handleSignalingMessage(payload);
        }
      }
    );

    await new Promise<void>((resolve, reject) => {
      this.signalingChannel?.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          resolve();
        } else if (status === 'CHANNEL_ERROR') {
          reject(new Error(err?.message || 'Failed to subscribe to secure signaling channel.'));
        } else if (status === 'TIMED_OUT') {
          reject(new Error('Signaling channel subscription timed out.'));
        }
      });
    });
  }

  /**
   * Dispatches signaling messages over Realtime Broadcast.
   */
  private broadcastSignaling(message: SignalingPayload): void {
    if (!this.signalingChannel) return;
    this.signalingChannel.send({
      type: 'broadcast',
      event: 'signal',
      payload: message,
    }).catch((err) => {
      console.warn('[WebRTC Signaling] Broadcast send warning:', err);
    });
  }

  /**
   * Handles incoming signaling messages from the remote peer.
   */
  private async handleSignalingMessage(message: SignalingPayload): Promise<void> {
    // Ignore self messages or messages for a different call
    if (message.sender_id === this.currentUserId || message.call_id !== this.callId) {
      return;
    }

    try {
      switch (message.type) {
        case 'offer':
          await this.handleRemoteOffer(message);
          break;

        case 'answer':
          await this.handleRemoteAnswer(message);
          break;

        case 'ice_candidate':
          await this.handleRemoteIceCandidate(message);
          break;

        case 'bye':
          this.handleRemoteHangup(message.reason);
          break;
      }
    } catch (err) {
      console.error('[WebRTC Signaling] Error processing signaling message:', err);
    }
  }

  /**
   * Initiator: Creates and broadcasts the SDP offer.
   */
  private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection || !this.sessionId) return;

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await this.peerConnection.setLocalDescription(offer);

    const payload: OfferSignalingPayload = {
      type: 'offer',
      call_id: this.callId,
      session_id: this.sessionId,
      sender_id: this.currentUserId,
      timestamp: new Date().toISOString(),
      sdp: offer,
    };

    this.broadcastSignaling(payload);

    // Self-healing: if remote peer hasn't answered within 3 seconds, resend offer up to 4 times
    let retries = 0;
    this.offerRetryTimer = setInterval(() => {
      if (this.status !== 'connecting' || retries >= 4) {
        if (this.offerRetryTimer) clearInterval(this.offerRetryTimer);
        return;
      }
      retries++;
      if (this.peerConnection?.signalingState === 'have-local-offer') {
        this.broadcastSignaling(payload);
      }
    }, 3000);
  }

  /**
   * Recipient: Handles SDP offer and responds with SDP answer.
   */
  private async handleRemoteOffer(message: OfferSignalingPayload): Promise<void> {
    if (!this.peerConnection || !this.sessionId) return;

    // If we are already connected or have a local offer, follow polite peer logic
    if (this.peerConnection.signalingState !== 'stable' && !this.isInitiator) {
      await Promise.all([
        this.peerConnection.setLocalDescription({ type: 'rollback' }),
        this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp)),
      ]);
    } else {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
    }

    // Process any queued ICE candidates
    await this.drainPendingCandidates();

    // Create and broadcast answer
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    const answerPayload: AnswerSignalingPayload = {
      type: 'answer',
      call_id: this.callId,
      session_id: this.sessionId,
      sender_id: this.currentUserId,
      timestamp: new Date().toISOString(),
      sdp: answer,
    };

    this.broadcastSignaling(answerPayload);
  }

  /**
   * Initiator: Handles remote SDP answer.
   */
  private async handleRemoteAnswer(message: AnswerSignalingPayload): Promise<void> {
    if (!this.peerConnection) return;

    if (this.offerRetryTimer) {
      clearInterval(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }

    if (this.peerConnection.signalingState === 'have-local-offer') {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
      await this.drainPendingCandidates();
    }
  }

  /**
   * Adds an ICE candidate or queues it if remote description isn't ready.
   */
  private async handleRemoteIceCandidate(message: IceCandidateSignalingPayload): Promise<void> {
    if (!this.peerConnection) return;

    if (this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
      } catch (e) {
        console.warn('[WebRTC] Failed to add ICE candidate:', e);
      }
    } else {
      this.pendingCandidates.push(message.candidate);
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.peerConnection) return;
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('[WebRTC] Failed to drain ICE candidate:', e);
        }
      }
    }
  }

  /**
   * Called when RTCPeerConnection reaches 'connected' state.
   * Invokes authoritative database RPC to confirm connection.
   */
  private async handleConnected(): Promise<void> {
    if (this.status === 'connected') return;

    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
    if (this.offerRetryTimer) {
      clearInterval(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }

    this.updateStatus('connected');

    if (this.sessionId) {
      await confirmCallConnection(this.callId, this.sessionId);
    }
  }

  /**
   * Called on technical connection failure.
   * Invariant: Calls record_call_session_failure which reverts the durable call
   * from 'connecting' to 'accepted' without destroying the social agreement.
   */
  private async handleConnectionFailure(errorMessage: string): Promise<void> {
    if (this.isCleaningUp || this.status === 'failed' || this.status === 'ended') return;

    if (this.sessionId) {
      await recordCallSessionFailure(this.callId, this.sessionId, 'network_error');
    }

    this.cleanup();
    this.updateStatus('failed', errorMessage);
  }

  /**
   * Called when remote peer hangs up.
   */
  private handleRemoteHangup(reason?: string): void {
    this.cleanup();
    this.updateStatus('ended', reason || 'Call ended by partner.');
  }

  /**
   * User action: End call.
   */
  public async endCall(): Promise<void> {
    if (this.status === 'ended') return;

    // Broadcast bye to peer
    if (this.sessionId && this.signalingChannel) {
      const byePayload: ByeSignalingPayload = {
        type: 'bye',
        call_id: this.callId,
        session_id: this.sessionId,
        sender_id: this.currentUserId,
        timestamp: new Date().toISOString(),
        reason: 'User hung up',
      };
      this.broadcastSignaling(byePayload);
    }

    // Call server-side end call session
    await endCallSession(this.callId, this.sessionId || undefined);

    this.cleanup();
    this.updateStatus('ended');
  }

  /**
   * Toggles microphone mute state.
   */
  public toggleMute(): boolean {
    if (!this.localStream) return this.isMuted;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });
    this.onStateChange({
      status: this.status,
      isMuted: this.isMuted,
      remoteStream: this.remoteStream,
      sessionId: this.sessionId,
    });
    return this.isMuted;
  }

  private updateStatus(status: WebRTCConnectionStatus, errorMessage?: string | null): void {
    this.status = status;
    this.onStateChange({
      status,
      errorMessage,
      sessionId: this.sessionId,
      isMuted: this.isMuted,
      remoteStream: this.remoteStream,
    });
  }

  private cleanupLocalMedia(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }

  /**
   * Thorough resource cleanup: closes peer connection, stops tracks, unsubscribes signaling.
   */
  public cleanup(): void {
    this.isCleaningUp = true;

    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
    if (this.offerRetryTimer) {
      clearInterval(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }

    this.cleanupLocalMedia();

    if (this.peerConnection) {
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.signalingChannel) {
      this.signalingChannel.unsubscribe();
      if (supabase) {
        supabase.removeChannel(this.signalingChannel);
      }
      this.signalingChannel = null;
    }

    this.remoteStream = null;
    this.pendingCandidates = [];
  }
}
