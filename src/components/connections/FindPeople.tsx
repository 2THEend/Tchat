import { useState, useEffect } from 'react';
import { Search, UserPlus, Check, Clock, UserCheck, ShieldOff, Loader2 } from 'lucide-react';
import { TchatProfileSummary } from '../../domains/connections/types';
import { searchPeople } from '../../domains/connections/connectionsService';
import { RequestModal } from './RequestModal';

interface FindPeopleProps {
  currentUserId: string;
  onSendRequest: (recipientId: string, context: string) => Promise<void>;
  isSendingRequest: boolean;
}

export function FindPeople({
  currentUserId,
  onSendRequest,
  isSendingRequest,
}: FindPeopleProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TchatProfileSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<TchatProfileSummary | null>(null);

  useEffect(() => {
    const cleanQuery = query.trim().replace(/^@/, '');
    if (cleanQuery.length === 0) {
      setResults([]);
      setHasSearched(false);
      setSearchError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const res = await searchPeople(cleanQuery, currentUserId);
        if (res.error) {
          setSearchError(res.error);
          setResults([]);
        } else {
          setResults(res.data);
        }
        setHasSearched(true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to search.';
        setSearchError(msg);
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query, currentUserId]);

  const handleSendSuccess = async (context: string) => {
    if (!selectedRecipient) return;
    await onSendRequest(selectedRecipient.id, context);
    // Update local result status to 'request_sent'
    setResults(prev => prev.map(p => 
      p.id === selectedRecipient.id ? { ...p, relationship_status: 'request_sent' } : p
    ));
    setSelectedRecipient(null);
  };

  return (
    <div id="find-people-view" className="space-y-4">
      {/* Search Input Box */}
      <div className="relative">
        <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id="input-search-people"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username (@handle) or name..."
          className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-stone-900 border border-stone-800 text-xs text-stone-100 placeholder:text-stone-400 focus:outline-none focus:border-stone-600 transition-colors"
        />
        {isSearching && (
          <Loader2 className="w-3.5 h-3.5 text-stone-400 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />
        )}
      </div>

      {searchError && (
        <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
          {searchError}
        </div>
      )}

      {/* Results List */}
      <div className="space-y-2">
        {results.map((person) => {
          const status = person.relationship_status || 'none';

          return (
            <div
              key={person.id}
              id={`person-card-${person.username}`}
              className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800/80 flex items-center justify-between gap-3 hover:border-stone-700/80 transition-all"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-11 h-11 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                  {person.avatar_url ? (
                    <img 
                      src={person.avatar_url} 
                      alt={person.display_name || person.username} 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <span className="text-xs font-semibold uppercase">{person.username.slice(0, 2)}</span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-stone-100 truncate">
                      {person.display_name || person.username}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-stone-400">
                    @{person.username}
                  </div>
                  {person.bio && (
                    <p className="text-[10px] text-stone-400 line-clamp-1 mt-0.5">
                      {person.bio}
                    </p>
                  )}
                </div>
              </div>

              {/* Relationship Action / Badge */}
              <div className="shrink-0">
                {status === 'connected' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 text-[10px] font-medium">
                    <UserCheck className="w-3 h-3" />
                    <span>Connected</span>
                  </span>
                )}

                {status === 'request_sent' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-800/80 border border-stone-700 text-stone-400 text-[10px] font-medium">
                    <Clock className="w-3 h-3" />
                    <span>Requested</span>
                  </span>
                )}

                {status === 'request_received' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-800/50 text-amber-300 text-[10px] font-medium">
                    <Check className="w-3 h-3" />
                    <span>Incoming</span>
                  </span>
                )}

                {status === 'blocked' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-400 text-[10px] font-medium">
                    <ShieldOff className="w-3 h-3" />
                    <span>Blocked</span>
                  </span>
                )}

                {status === 'none' && (
                  <button
                    id={`btn-connect-${person.username}`}
                    type="button"
                    onClick={() => setSelectedRecipient(person)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Connect</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {hasSearched && results.length === 0 && !isSearching && (
          <div className="p-8 text-center rounded-2xl bg-stone-900/30 border border-stone-800/40">
            <p className="text-xs text-stone-400">
              No matching profiles found for <span className="text-stone-300">"{query}"</span>.
            </p>
            <p className="text-[11px] text-stone-400 mt-1">
              Search by exact handle without spaces (e.g. @tonbi).
            </p>
          </div>
        )}

        {!hasSearched && query.trim().length === 0 && (
          <div className="p-6 text-center space-y-1 text-stone-400">
            <p className="text-xs font-medium text-stone-300">
              Intentional People Discovery
            </p>
            <p className="text-[11px] max-w-xs mx-auto leading-relaxed">
              Find others by their unique username handle or display name to initiate an intentional connection.
            </p>
          </div>
        )}
      </div>

      {/* Context Modal */}
      {selectedRecipient && (
        <RequestModal
          recipient={selectedRecipient}
          isOpen={true}
          onClose={() => setSelectedRecipient(null)}
          onSend={handleSendSuccess}
          isSending={isSendingRequest}
        />
      )}
    </div>
  );
}
