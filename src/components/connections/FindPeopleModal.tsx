import React, { useState } from 'react';
import { X, UserPlus } from 'lucide-react';
import { FindPeople } from './FindPeople';
import { sendConnectionRequest } from '../../domains/connections/connectionsService';
import { OtherUserProfileModal } from '../profile/OtherUserProfileModal';

interface FindPeopleModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  onOpenProfile?: (userId: string) => void;
}

export const FindPeopleModal: React.FC<FindPeopleModalProps> = ({
  isOpen,
  onClose,
  currentUserId,
  onOpenProfile,
}) => {
  const [isSendingRequest, setIsSendingRequest] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [internalProfileUserId, setInternalProfileUserId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSendRequest = async (recipientId: string, context: string) => {
    setIsSendingRequest(true);
    setSendError(null);
    try {
      const res = await sendConnectionRequest(recipientId, currentUserId, context);
      if (!res.success) {
        setSendError(res.error || 'Failed to send connection request.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send request.';
      setSendError(msg);
    } finally {
      setIsSendingRequest(false);
    }
  };

  const handleProfileClick = (userId: string) => {
    if (onOpenProfile) {
      onOpenProfile(userId);
    } else {
      setInternalProfileUserId(userId);
    }
  };

  return (
    <>
      <div
        id="find-people-modal-backdrop"
        className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
        onClick={onClose}
      >
        <div
          id="find-people-modal"
          className="w-full max-w-md max-h-[85vh] bg-stone-900 border border-stone-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-stone-800/80 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-stone-100">Find People</h2>
                <p className="text-[11px] text-stone-400">Search members and initiate intentional connections</p>
              </div>
            </div>
            <button
              id="btn-close-find-people-modal"
              type="button"
              onClick={onClose}
              aria-label="Close find people modal"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Global Error Banner if any */}
          {sendError && (
            <div className="mx-4 mt-3 p-2.5 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 shrink-0">
              {sendError}
            </div>
          )}

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-4">
            <FindPeople
              currentUserId={currentUserId}
              onSendRequest={handleSendRequest}
              isSendingRequest={isSendingRequest}
              onOpenProfile={handleProfileClick}
            />
          </div>
        </div>
      </div>

      {internalProfileUserId && (
        <OtherUserProfileModal
          targetUserId={internalProfileUserId}
          currentUserId={currentUserId}
          isOpen={!!internalProfileUserId}
          onClose={() => setInternalProfileUserId(null)}
        />
      )}
    </>
  );
};
