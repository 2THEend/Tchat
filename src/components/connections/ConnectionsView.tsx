import { useState, useEffect, useCallback } from 'react';
import { 
  Users, 
  UserPlus, 
  Inbox, 
  Send, 
  ShieldAlert, 
  ArrowLeft, 
  RotateCw,
  Database,
  CheckCircle2,
  AlertCircle 
} from 'lucide-react';
import { 
  TchatConnection, 
  TchatConnectionRequest, 
  TchatBlock, 
  ConnectionsActiveTab 
} from '../../domains/connections/types';
import { 
  getConnections, 
  getIncomingRequests, 
  getSentRequests, 
  getBlockedUsers,
  sendConnectionRequest,
  acceptConnectionRequest,
  declineConnectionRequest,
  ignoreConnectionRequest,
  cancelConnectionRequest,
  unfriendUser,
  blockUser,
  unblockUser
} from '../../domains/connections/connectionsService';
import { ConnectionsList } from './ConnectionsList';
import { IncomingRequestsList } from './IncomingRequestsList';
import { SentRequestsList } from './SentRequestsList';
import { FindPeople } from './FindPeople';
import { BlockedUsersList } from './BlockedUsersList';

interface ConnectionsViewProps {
  currentUserId: string;
  onBackToHome: () => void;
  initialTab?: ConnectionsActiveTab;
  onOpenConversation?: (targetUserId: string, partnerProfile?: any) => void;
}

export function ConnectionsView({
  currentUserId,
  onBackToHome,
  initialTab = 'connections',
  onOpenConversation,
}: ConnectionsViewProps) {
  const [activeTab, setActiveTab] = useState<ConnectionsActiveTab>(initialTab);
  const [connections, setConnections] = useState<TchatConnection[]>([]);
  const [incoming, setIncoming] = useState<TchatConnectionRequest[]>([]);
  const [sent, setSent] = useState<TchatConnectionRequest[]>([]);
  const [blocks, setBlocks] = useState<TchatBlock[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSendingRequest, setIsSendingRequest] = useState<boolean>(false);
  const [isSchemaPending, setIsSchemaPending] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const [connRes, inRes, sentRes, blockRes] = await Promise.all([
        getConnections(currentUserId),
        getIncomingRequests(currentUserId),
        getSentRequests(currentUserId),
        getBlockedUsers(currentUserId),
      ]);

      if (connRes.isSchemaPending || inRes.isSchemaPending || sentRes.isSchemaPending || blockRes.isSchemaPending) {
        setIsSchemaPending(true);
      } else {
        setIsSchemaPending(false);
      }

      setConnections(connRes.data || []);
      setIncoming(inRes.data || []);
      setSent(sentRes.data || []);
      setBlocks(blockRes.data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error loading connections data.';
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  // 1. Send Request
  const handleSendRequest = async (recipientId: string, context: string) => {
    setIsSendingRequest(true);
    setStatusMessage(null);
    try {
      const res = await sendConnectionRequest(recipientId, context, currentUserId);
      if (!res.success) {
        throw new Error(res.error || 'Failed to send request.');
      }
      setStatusMessage({ type: 'success', text: 'Connection request sent.' });
      await loadData();
    } finally {
      setIsSendingRequest(false);
    }
  };

  // 2. Accept Incoming Request
  const handleAcceptRequest = async (requestId: string, senderId?: string) => {
    setStatusMessage(null);
    const res = await acceptConnectionRequest(requestId, currentUserId, senderId);
    if (!res.success) {
      throw new Error(res.error || 'Failed to accept request.');
    }
    setStatusMessage({ type: 'success', text: 'Connection established.' });
    await loadData();
  };

  // 3. Decline Request
  const handleDeclineRequest = async (requestId: string, senderId?: string) => {
    setStatusMessage(null);
    const res = await declineConnectionRequest(requestId, currentUserId, senderId);
    if (!res.success) {
      throw new Error(res.error || 'Failed to decline request.');
    }
    setStatusMessage({ type: 'success', text: 'Request declined.' });
    await loadData();
  };

  // 4. Ignore Request
  const handleIgnoreRequest = async (requestId: string) => {
    setStatusMessage(null);
    const res = await ignoreConnectionRequest(requestId, currentUserId);
    if (!res.success) {
      throw new Error(res.error || 'Failed to ignore request.');
    }
    setStatusMessage({ type: 'success', text: 'Request ignored.' });
    await loadData();
  };

  // 5. Cancel Sent Request
  const handleCancelSentRequest = async (requestId: string, recipientId: string) => {
    setStatusMessage(null);
    const res = await cancelConnectionRequest(requestId, recipientId, currentUserId);
    if (!res.success) {
      throw new Error(res.error || 'Failed to cancel request.');
    }
    setStatusMessage({ type: 'success', text: 'Request cancelled.' });
    await loadData();
  };

  // 6. Unfriend User
  const handleUnfriend = async (targetUserId: string) => {
    setStatusMessage(null);
    const res = await unfriendUser(targetUserId, currentUserId);
    if (!res.success) {
      throw new Error(res.error || 'Failed to unfriend user.');
    }
    setStatusMessage({ type: 'success', text: 'Connection removed.' });
    await loadData();
  };

  // 7. Block User
  const handleBlock = async (targetUserId: string) => {
    setStatusMessage(null);
    const res = await blockUser(targetUserId, currentUserId);
    if (!res.success) {
      throw new Error(res.error || 'Failed to block user.');
    }
    setStatusMessage({ type: 'success', text: 'User blocked.' });
    await loadData();
  };

  // 8. Unblock User
  const handleUnblock = async (targetUserId: string) => {
    setStatusMessage(null);
    const res = await unblockUser(targetUserId, currentUserId);
    if (!res.success) {
      throw new Error(res.error || 'Failed to unblock user.');
    }
    setStatusMessage({ type: 'success', text: 'User unblocked.' });
    await loadData();
  };

  const incomingCount = incoming.length;
  const connectionsCount = connections.length;
  const sentCount = sent.length;
  const blocksCount = blocks.length;

  return (
    <div id="connections-view" className="flex-1 flex flex-col min-h-0 overflow-hidden bg-stone-950">
      {/* View Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-stone-800/60 shrink-0">
        <div className="flex items-center gap-2.5">
          <button
            id="btn-connections-back"
            type="button"
            onClick={onBackToHome}
            title="Return to Home"
            className="p-1.5 -ml-1.5 rounded-xl text-stone-400 hover:text-stone-200 hover:bg-stone-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-base font-semibold text-stone-100 tracking-tight">
              Connections
            </h1>
            <p className="text-[11px] text-stone-400">
              Intentional 1:1 human relationships
            </p>
          </div>
        </div>

        <button
          id="btn-refresh-connections"
          type="button"
          onClick={handleRefresh}
          disabled={isLoading || isRefreshing}
          title="Refresh connections"
          className="p-2 rounded-xl bg-stone-900 border border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-stone-200' : ''}`} />
        </button>
      </div>

      {/* Database Schema Notification if tables need remote execution */}
      {isSchemaPending && (
        <div className="m-4 p-3.5 rounded-2xl bg-amber-950/40 border border-amber-800/60 text-xs text-stone-300 space-y-1.5 shrink-0">
          <div className="flex items-center gap-2 font-medium text-amber-300">
            <Database className="w-4 h-4 shrink-0" />
            <span>Remote Database Migration Ready</span>
          </div>
          <p className="text-[11px] text-stone-400 leading-relaxed">
            The SQL migration for Connections, Requests, and Blocks is generated at:
          </p>
          <code className="block p-1.5 rounded-lg bg-stone-950 font-mono text-[10px] text-amber-200/90 break-all border border-stone-800">
            supabase/migrations/20260913010000_create_tchat_connections_and_blocks.sql
          </code>
        </div>
      )}

      {/* Global Status Message */}
      {statusMessage && (
        <div className={`mx-4 mt-3 p-2.5 rounded-xl flex items-center gap-2 text-xs shrink-0 ${
          statusMessage.type === 'success' 
            ? 'bg-emerald-950/40 border border-emerald-900/60 text-emerald-300'
            : 'bg-rose-950/40 border border-rose-900/60 text-rose-300'
        }`}>
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="px-4 pt-3 pb-2 shrink-0 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-stone-900/90 border border-stone-800/80 min-w-max">
          <button
            id="tab-connections"
            type="button"
            onClick={() => setActiveTab('connections')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'connections'
                ? 'bg-stone-800 text-stone-100 shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Connections</span>
            <span className="text-[10px] font-mono opacity-80">({connectionsCount})</span>
          </button>

          <button
            id="tab-incoming"
            type="button"
            onClick={() => setActiveTab('incoming')}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'incoming'
                ? 'bg-stone-800 text-stone-100 shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Incoming</span>
            {incomingCount > 0 ? (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-stone-950 font-bold text-[9px]">
                {incomingCount}
              </span>
            ) : (
              <span className="text-[10px] font-mono opacity-80">(0)</span>
            )}
          </button>

          <button
            id="tab-find"
            type="button"
            onClick={() => setActiveTab('find')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'find'
                ? 'bg-stone-800 text-stone-100 shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Find People</span>
          </button>

          <button
            id="tab-sent"
            type="button"
            onClick={() => setActiveTab('sent')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'sent'
                ? 'bg-stone-800 text-stone-100 shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Sent</span>
            <span className="text-[10px] font-mono opacity-80">({sentCount})</span>
          </button>

          <button
            id="tab-blocked"
            type="button"
            onClick={() => setActiveTab('blocked')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'blocked'
                ? 'bg-stone-800 text-stone-100 shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Blocked</span>
            {blocksCount > 0 && (
              <span className="text-[10px] font-mono opacity-80">({blocksCount})</span>
            )}
          </button>
        </div>
      </div>

      {/* Main Tab Panel */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {activeTab === 'connections' && (
          <ConnectionsList
            connections={connections}
            onUnfriend={handleUnfriend}
            onBlock={handleBlock}
            isLoading={isLoading}
            onOpenConversation={onOpenConversation}
          />
        )}

        {activeTab === 'incoming' && (
          <IncomingRequestsList
            requests={incoming}
            onAccept={handleAcceptRequest}
            onDecline={handleDeclineRequest}
            onIgnore={handleIgnoreRequest}
            isLoading={isLoading}
          />
        )}

        {activeTab === 'find' && (
          <FindPeople
            currentUserId={currentUserId}
            onSendRequest={handleSendRequest}
            isSendingRequest={isSendingRequest}
          />
        )}

        {activeTab === 'sent' && (
          <SentRequestsList
            requests={sent}
            onCancel={handleCancelSentRequest}
            isLoading={isLoading}
          />
        )}

        {activeTab === 'blocked' && (
          <BlockedUsersList
            blocks={blocks}
            onUnblock={handleUnblock}
            isLoading={isLoading}
          />
        )}
      </div>
    </div>
  );
}
