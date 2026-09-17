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
  private disconnectGraceTimer: NodeJS.Timeout | null = null;
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

    console.info(`[Tchat WebRTC] Starting call session (callId: ${this.callId}, role: ${this.isInitiator ? 'initiator' : 'recipient'})`);

    // 1. Check browser WebRTC API support
    if (
      typeof window === 'undefined' ||
      !window.RTCPeerConnection ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      const err = 'Your browser does not support WebRTC audio calls.';
      console.error('[Tchat WebRTC] Browser unsupported:', err);
      this.updateStatus('failed', err);
      return;
    }

    try {
      // 2. Request microphone permission
      this.updateStatus('requesting_permissions');
      console.info('[Tchat WebRTC] Requesting microphone permission via getUserMedia...');
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
        console.info(`[Tchat WebRTC] getUserMedia granted: ${stream.getAudioTracks().length} audio track(s)`);
      } catch (mediaErr: unknown) {
        const error = mediaErr as Error;
        console.error('[Tchat WebRTC] getUserMedia failed:', error.name, error.message);
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
      console.info('[Tchat WebRTC] Calling startCallSession RPC...');
      const sessionResult = await startCallSession(this.callId);
      if (sessionResult.error || !sessionResult.data) {
        console.error('[Tchat WebRTC] startCallSession RPC failed:', sessionResult.error);
        this.cleanupLocalMedia();
        this.updateStatus('failed', sessionResult.error || 'Failed to initialize call session.');
        return;
      }

      this.sessionId = sessionResult.data.session_id;
      console.info(`[Tchat WebRTC] startCallSession active session: ${this.sessionId} (status: ${sessionResult.data.status})`);

      // 4. Initialize RTCPeerConnection
      this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

      // Add local audio tracks to peer connection
      this.localStream.getAudioTracks().forEach((track) => {
        console.info(`[Tchat WebRTC] Adding local audio track to RTCPeerConnection (id: ${track.id}, enabled: ${track.enabled})`);
        this.peerConnection?.addTrack(track, this.localStream!);
      });

      // Handle remote audio track arrival
      this.peerConnection.ontrack = (event) => {
        const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
        console.info(`[Tchat WebRTC] Remote track arrived: kind=${event.track.kind}, id=${event.track.id}, readyState=${event.track.readyState}`);
        this.remoteStream = stream;
        this.onRemoteStream?.(this.remoteStream);
        this.onStateChange({
          status: this.status,
          remoteStream: this.remoteStream,
          isMuted: this.isMuted,
          sessionId: this.sessionId,
        });
      };

      // Handle ICE candidate generation
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.sessionId) {
          console.info(`[Tchat WebRTC] Local ICE candidate generated (${event.candidate.type || 'candidate'}, proto: ${event.candidate.protocol || 'any'})`);
          this.broadcastSignaling({
            type: 'ice_candidate',
            call_id: this.callId,
            session_id: this.sessionId,
            sender_id: this.currentUserId,
            timestamp: new Date().toISOString(),
            candidate: event.candidate.toJSON(),
          });
        } else if (!event.candidate) {
          console.info('[Tchat WebRTC] Local ICE candidate gathering finished');
        }
      };

      // Handle ICE gathering state changes
      this.peerConnection.onicegatheringstatechange = () => {
        console.info(`[Tchat WebRTC] ICE gathering state: ${this.peerConnection?.iceGatheringState}`);
      };

      // Handle ICE connection state changes
      this.peerConnection.oniceconnectionstatechange = () => {
        const iceState = this.peerConnection?.iceConnectionState;
        console.info(`[Tchat WebRTC] ICE connection state: ${iceState}`);
        if (iceState === 'connected' || iceState === 'completed') {
          this.handleConnected();
        } else if (iceState === 'failed') {
          this.handleConnectionFailure('ICE connection failed: could not establish media path.');
        } else if (iceState === 'disconnected') {
          this.handleTransientDisconnect('ICE connection disconnected.');
        }
      };

      // Handle overall peer connection state changes
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        console.info(`[Tchat WebRTC] Peer connection state: ${state}`);
        if (state === 'connected') {
          this.handleConnected();
        } else if (state === 'failed') {
          this.handleConnectionFailure('WebRTC peer connection failed: candidate pairs exhausted.');
        } else if (state === 'disconnected') {
          this.handleTransientDisconnect('WebRTC peer connection temporarily disconnected.');
        }
      };

      // 5. Connect to authorized private Supabase Realtime Broadcast channel
      await this.setupSignalingChannel();

      // Set timeout for connection establishment (30s)
      this.connectionTimeoutTimer = setTimeout(() => {
        if (this.status === 'connecting') {
          console.error('[Tchat WebRTC] Connection attempt timed out after 30 seconds.');
          this.handleConnectionFailure('Connection timed out. Remote peer did not connect.');
        }
      }, 30000);

      // 6. If initiator, create and send the initial SDP Offer
      if (this.isInitiator) {
        await this.createAndSendOffer();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error starting call.';
      console.error('[Tchat WebRTC] Exception during call start:', msg);
      this.handleConnectionFailure(msg);
    }
  }

  /**
   * Sets up the Supabase Realtime private signaling channel.
   */
  private async setupSignalingChannel(): Promise<void> {
    if (!supabase) throw new Error('Supabase client is not available.');

    const topic = getCallSignalingTopic(this.callId);
    console.info(`[Tchat WebRTC] Subscribing to secure signaling channel: ${topic}`);

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
        } else {
          console.warn('[Tchat WebRTC] Received invalid signaling payload:', payload);
        }
      }
    );

    await new Promise<void>((resolve, reject) => {
      this.signalingChannel?.subscribe((status, err) => {
        console.info(`[Tchat WebRTC] Signaling channel status: ${status}`);
        if (status === 'SUBSCRIBED') {
          resolve();
        } else if (status === 'CHANNEL_ERROR') {
          const errMsg = err?.message || 'Failed to subscribe to secure signaling channel.';
          console.error('[Tchat WebRTC] Signaling channel error:', errMsg);
          reject(new Error(errMsg));
        } else if (status === 'TIMED_OUT') {
          const errMsg = 'Signaling channel subscription timed out.';
          console.error('[Tchat WebRTC] Signaling channel timed out:', errMsg);
          reject(new Error(errMsg));
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
      console.warn('[Tchat WebRTC] Broadcast send warning:', err);
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
          console.info('[Tchat WebRTC] Handling remote offer...');
          await this.handleRemoteOffer(message);
          break;
        case 'answer':
          console.info('[Tchat WebRTC] Handling remote answer...');
          await this.handleRemoteAnswer(message);
          break;
        case 'ice_candidate':
          await this.handleRemoteIceCandidate(message);
          break;
        case 'bye':
          console.info(`[Tchat WebRTC] Remote peer sent bye: ${message.reason || 'No reason specified'}`);
          this.handleRemoteHangup(message.reason);
          break;
      }
    } catch (err) {
      console.error('[Tchat WebRTC] Error processing signaling message:', err);
    }
  }

  /**
   * Initiator: Creates and broadcasts the SDP offer.
   */
  private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection || !this.sessionId) return;

    console.info('[Tchat WebRTC] Creating local SDP offer...');
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

    console.info('[Tchat WebRTC] Broadcasting local SDP offer');
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
        console.info(`[Tchat WebRTC] Resending offer (retry ${retries}/4)...`);
        this.broadcastSignaling(payload);
      }
    }, 3000);
  }

  /**
   * Recipient: Handles SDP offer and responds with SDP answer.
   */
  private async handleRemoteOffer(message: OfferSignalingPayload): Promise<void> {
    if (!this.peerConnection || !this.sessionId) return;

    // Sequential rollback if in collision state (polite peer pattern)
    if (this.peerConnection.signalingState !== 'stable' && !this.isInitiator) {
      console.info('[Tchat WebRTC] Rolling back local offer before setting remote offer (polite peer)');
      await this.peerConnection.setLocalDescription({ type: 'rollback' });
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
    } else {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
    }

    // Process any queued ICE candidates
    await this.drainPendingCandidates();

    // Create and broadcast answer
    console.info('[Tchat WebRTC] Creating local SDP answer...');
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

    console.info('[Tchat WebRTC] Broadcasting local SDP answer');
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
      console.info('[Tchat WebRTC] Applying remote SDP answer');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
      await this.drainPendingCandidates();
    } else {
      console.warn(`[Tchat WebRTC] Received answer but signalingState is ${this.peerConnection.signalingState}`);
    }
  }

  /**
   * Adds an ICE candidate or queues it if remote description isn't ready.
   */
  private async handleRemoteIceCandidate(message: IceCandidateSignalingPayload): Promise<void> {
    if (!this.peerConnection) return;

    if (this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
      try {
        await this.peerConnection.addIceCandidate(message.candidate);
      } catch (e) {
        console.warn('[Tchat WebRTC] Failed to add ICE candidate:', e);
      }
    } else {
      this.pendingCandidates.push(message.candidate);
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.peerConnection) return;
    if (this.pendingCandidates.length > 0) {
      console.info(`[Tchat WebRTC] Draining ${this.pendingCandidates.length} queued ICE candidate(s)`);
    }
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(candidate);
        } catch (e) {
          console.warn('[Tchat WebRTC] Failed to drain ICE candidate:', e);
        }
      }
    }
  }

  /**
   * Handles transient disconnect states with a 6-second recovery grace period.
   */
  private handleTransientDisconnect(reason: string): void {
    if (this.status === 'failed' || this.status === 'ended' || this.isCleaningUp) return;

    console.warn(`[Tchat WebRTC] Transient disconnect: ${reason}. Starting 6s recovery grace timer...`);
    if (!this.disconnectGraceTimer) {
      this.disconnectGraceTimer = setTimeout(() => {
        this.disconnectGraceTimer = null;
        if (this.status !== 'connected') {
          console.error('[Tchat WebRTC] Disconnect grace period expired. Failing call.');
          this.handleConnectionFailure('Connection lost: network failed to recover within 6 seconds.');
        }
      }, 6000);
    }
  }

  /**
   * Called when RTCPeerConnection reaches 'connected' state.
   * Invokes authoritative database RPC to confirm connection.
   */
  private async handleConnected(): Promise<void> {
    if (this.status === 'connected') return;

    console.info('[Tchat WebRTC] Peer connection established! Transitioning to connected.');

    if (this.disconnectGraceTimer) {
      clearTimeout(this.disconnectGraceTimer);
      this.disconnectGraceTimer = null;
    }
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
      console.info('[Tchat WebRTC] Confirming call connection in database via confirmCallConnection...');
      const confirmRes = await confirmCallConnection(this.callId, this.sessionId);
      if (confirmRes.error) {
        console.error('[Tchat WebRTC] confirmCallConnection RPC failed:', confirmRes.error);
      } else {
        console.info('[Tchat WebRTC] confirmCallConnection confirmed in database.');
      }
    }
  }

  /**
   * Called on technical connection failure.
   * Invariant: Calls record_call_session_failure which reverts the durable call
   * from 'connecting' to 'accepted' without destroying the social agreement.
   */
  private async handleConnectionFailure(errorMessage: string): Promise<void> {
    if (this.isCleaningUp || this.status === 'failed' || this.status === 'ended') return;

    console.error(`[Tchat WebRTC] Connection failure: ${errorMessage}`);

    if (this.sessionId) {
      console.info('[Tchat WebRTC] Recording call session failure in database...');
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
    if (this.disconnectGraceTimer) {
      clearTimeout(this.disconnectGraceTimer);
      this.disconnectGraceTimer = null;
    }

    this.cleanupLocalMedia();

    if (this.peerConnection) {
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.onicegatheringstatechange = null;
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
