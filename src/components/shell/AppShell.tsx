import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Database, RotateCcw, ShieldAlert, LogOut } from 'lucide-react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { NavigationPlace } from '../../types/navigation';
import { Navigation } from './Navigation';
import { AuthEntry } from '../auth/AuthEntry';
import { IdentitySetup } from '../identity/IdentitySetup';
import { HomeAuthenticatedView } from '../home/HomeAuthenticatedView';
import { ProfileView } from '../profile/ProfileView';
import { FeedView } from '../places/FeedView';
import { ConnectionsView } from '../connections/ConnectionsView';
import { checkIdentity } from '../../domains/identity/identityService';
import { signOut } from '../../domains/auth/authService';
import { TchatProfile, TchatAccount } from '../../domains/identity/types';
import { 
  getCachedIdentity, 
  saveCachedIdentity, 
  clearCachedIdentity 
} from '../../domains/identity/identityCache';
import { parseAuthUrlParams, formatAuthUrlError, clearAuthUrlParams } from '../../domains/auth/urlHandler';
import { getIncomingRequests, getConnections } from '../../domains/connections/connectionsService';
import { onConnectionEvent } from '../../domains/connections/events';
import { ConversationView } from '../conversations/ConversationView';
import { TchatConversation } from '../../domains/conversations/types';
import { 
  getUserConversations, 
  getOrCreateConversation,
  getConversationById 
} from '../../domains/conversations/conversationsService';
import { 
  getStoredActiveConversationId, 
  storeActiveConversationId, 
  clearStoredActiveConversationId 
} from '../../domains/conversations/conversationState';
import { onConversationEvent } from '../../domains/conversations/events';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { OfflineIndicator } from '../pwa/OfflineIndicator';

export function AppShell() {
  // Cached snapshot for instant authenticated resume without blocking screens
  const cachedIdentity = getCachedIdentity();

  // Navigation
  const [currentPlace, setCurrentPlace] = useState<NavigationPlace>('home');
  const [isViewingConnections, setIsViewingConnections] = useState<boolean>(false);
  const [incomingCount, setIncomingCount] = useState<number>(0);
  const [connectionsCount, setConnectionsCount] = useState<number>(0);

  // Conversations State
  const [conversations, setConversations] = useState<TchatConversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(false);
  const [activeConversation, setActiveConversation] = useState<TchatConversation | null>(null);

  // Auth State
  // If we already have a cached profile and account, we do not need to show the full-screen "Checking session..." loader
  const [isInitializing, setIsInitializing] = useState<boolean>(() => !cachedIdentity?.profile);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(() => {
    if (cachedIdentity?.userId) {
      return { id: cachedIdentity.userId, email: cachedIdentity.userEmail || null } as User;
    }
    return null;
  });
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  // Recovery & URL Error State
  const [isPasswordRecovery, setIsPasswordRecovery] = useState<boolean>(false);
  const [authInitialError, setAuthInitialError] = useState<string | null>(null);

  // Identity State
  const [isCheckingIdentity, setIsCheckingIdentity] = useState<boolean>(false);
  const [profile, setProfile] = useState<TchatProfile | null>(() => cachedIdentity?.profile || null);
  const [account, setAccount] = useState<TchatAccount | null>(() => cachedIdentity?.account || null);
  const [schemaPending, setSchemaPending] = useState<boolean>(false);

  // Ref to track latest profile in async callbacks without triggering re-subscriptions
  const profileRef = useRef<TchatProfile | null>(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Refresh Connection Counts
  const refreshConnectionCounts = useCallback(async (userId: string) => {
    try {
      const [inRes, connRes] = await Promise.all([
        getIncomingRequests(userId),
        getConnections(userId),
      ]);
      setIncomingCount(inRes.data?.length || 0);
      setConnectionsCount(connRes.data?.length || 0);
    } catch {
      // Gracefully ignore if tables pending
    }
  }, []);

  useEffect(() => {
    if (user && profile) {
      refreshConnectionCounts(user.id);
    }
  }, [user, profile, refreshConnectionCounts]);

  // Subscribe to connection domain events
  useEffect(() => {
    const unsub = onConnectionEvent(() => {
      if (user) {
        refreshConnectionCounts(user.id);
        refreshConversations(user.id);
      }
    });
    return unsub;
  }, [user, refreshConnectionCounts]);

  // Refresh Conversations
  const refreshConversations = useCallback(async (userId: string) => {
    setIsLoadingConversations(true);
    try {
      const res = await getUserConversations(userId);
      if (res.data) {
        setConversations(res.data);
      }
    } catch {
      // Gracefully ignore if schema pending
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    if (user && profile) {
      refreshConversations(user.id);
    }
  }, [user, profile, refreshConversations]);

  // Subscribe to conversation domain events
  useEffect(() => {
    const unsub = onConversationEvent(() => {
      if (user) {
        refreshConversations(user.id);
      }
    });
    return unsub;
  }, [user, refreshConversations]);

  const handleOpenConversation = useCallback((conv: TchatConversation) => {
    setActiveConversation(conv);
    storeActiveConversationId(conv.id);
  }, []);

  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    clearStoredActiveConversationId();
  }, []);

  const handleOpenConversationFromConnection = async (targetUserId: string, partnerProfile?: any) => {
    try {
      const res = await getOrCreateConversation(targetUserId);
      if (res.data) {
        const conv = res.data;
        if (partnerProfile && !conv.other_participant) {
          conv.other_participant = {
            id: partnerProfile.id,
            username: partnerProfile.username,
            display_name: partnerProfile.display_name,
            avatar_url: partnerProfile.avatar_url,
          };
        }
        handleOpenConversation(conv);
        setIsViewingConnections(false);
      }
    } catch (err) {
      console.error('Failed to open conversation:', err);
    }
  };

  // Check identity against Supabase database.
  // When isSilent=true (or when a profile is already in memory),
  // verification proceeds as a quiet background validation without tearing down
  // the active application tree or unmounting inputs.
  const verifyUserIdentity = useCallback(async (userId: string, isSilent = false) => {
    const shouldBlock = !isSilent && !profileRef.current;
    if (shouldBlock) {
      setIsCheckingIdentity(true);
    }
    setSchemaPending(false);
    try {
      const res = await checkIdentity(userId);
      if (res.error === 'DATABASE_SCHEMA_PENDING') {
        setSchemaPending(true);
        setProfile(null);
        setAccount(null);
        clearCachedIdentity();
      } else {
        setProfile(res.profile);
        setAccount(res.account);
        if (res.profile && res.account) {
          saveCachedIdentity(userId, res.profile, res.account, res.account.email);
        } else {
          clearCachedIdentity();
        }
      }
    } finally {
      if (shouldBlock) {
        setIsCheckingIdentity(false);
      }
    }
  }, []);

  // Process recreation & page reload restoration for active conversation
  const hasAttemptedRestoreRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !profile || activeConversation) return;

    const storedConvId = getStoredActiveConversationId();
    if (!storedConvId || hasAttemptedRestoreRef.current === storedConvId) return;

    hasAttemptedRestoreRef.current = storedConvId;

    // 1. Try finding in current conversations list if already loaded
    const found = conversations.find((c) => c.id === storedConvId);
    if (found && found.other_participant) {
      setActiveConversation(found);
      return;
    }

    // 2. Fetch directly and verify authorization with Supabase RLS
    getConversationById(storedConvId, user.id).then((res) => {
      if (res.data && res.data.other_participant) {
        setActiveConversation(res.data);
      } else {
        // Conversation not found or user is not an authorized participant
        clearStoredActiveConversationId();
      }
    }).catch(() => {
      clearStoredActiveConversationId();
    });
  }, [user, profile, activeConversation, conversations]);

  // Initialize Supabase Auth Session and URL handlers
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      if (!supabase) {
        if (isMounted) setIsInitializing(false);
        return;
      }

      // Check URL parameters for recovery state, verification links, or OAuth errors
      const urlParams = parseAuthUrlParams();
      if (urlParams.type === 'recovery') {
        if (isMounted) setIsPasswordRecovery(true);
      }

      const formattedUrlError = formatAuthUrlError(urlParams);
      if (formattedUrlError && isMounted) {
        setAuthInitialError(formattedUrlError);
      }

      // Clean address bar if auth-related params exist
      if (urlParams.type || urlParams.error || urlParams.errorCode || urlParams.errorDescription) {
        clearAuthUrlParams();
      }

      try {
        const { data } = await supabase.auth.getSession();
        if (isMounted) {
          setSession(data.session);
          setUser(data.session?.user || null);

          if (data.session?.user) {
            // Verify in background if we already had a cached profile, otherwise blocking
            const hasCachedProfile = Boolean(profileRef.current);
            await verifyUserIdentity(data.session.user.id, hasCachedProfile);
          } else {
            // No active session: clear any cached identity
            clearCachedIdentity();
            setProfile(null);
            setAccount(null);
          }
        }
      } catch (err) {
        console.error('Failed to get initial session:', err);
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    }

    initSession();

    // Listen to Supabase auth events
    const { data: authListener } = supabase?.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!isMounted) return;

        setSession(newSession);
        setUser(newSession?.user || null);

        if (event === 'PASSWORD_RECOVERY') {
          setIsPasswordRecovery(true);
        } else if (event === 'SIGNED_IN' && newSession?.user) {
          // If we already have a profile in memory, verify silently in background
          // so that Android file-picker returns or tab focus events do not unmount UI!
          const hasExistingProfile = Boolean(profileRef.current);
          await verifyUserIdentity(newSession.user.id, hasExistingProfile);
        } else if (event === 'TOKEN_REFRESHED' && newSession?.user) {
          // Routine token refresh is strictly background
          await verifyUserIdentity(newSession.user.id, true);
        } else if (event === 'SIGNED_OUT') {
          clearCachedIdentity();
          clearStoredActiveConversationId();
          setProfile(null);
          setAccount(null);
          setActiveConversation(null);
          setIsPasswordRecovery(false);
          setCurrentPlace('home');
        }
      }
    ) || { data: null };

    return () => {
      isMounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [verifyUserIdentity]);

  // Handle Logout
  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      clearCachedIdentity();
      clearStoredActiveConversationId();
      setSession(null);
      setUser(null);
      setProfile(null);
      setAccount(null);
      setActiveConversation(null);
      setIsPasswordRecovery(false);
      setCurrentPlace('home');
    } finally {
      setIsSigningOut(false);
    }
  };

  // Called when identity setup completes successfully
  const handleIdentityComplete = (newProfile: TchatProfile) => {
    setProfile(newProfile);
    if (user && account) {
      saveCachedIdentity(user.id, newProfile, account, account.email);
    }
    setCurrentPlace('home');
  };

  // 1. Initializing state
  if (isInitializing) {
    return (
      <div 
        id="app-viewport-root"
        className="w-full h-full min-h-screen bg-stone-950 flex items-center justify-center p-4 selection:bg-stone-800"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-10 h-10 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-stone-300" />
          </div>
          <span className="text-xs font-medium tracking-tight text-stone-400">
            Checking session...
          </span>
        </div>
      </div>
    );
  }

  // 2. Active Password Recovery Session
  if (isPasswordRecovery) {
    return (
      <div 
        id="app-viewport-root"
        className="w-full h-full min-h-screen bg-stone-950 flex items-center justify-center sm:p-4 selection:bg-stone-800"
      >
        <main
          id="app-shell-container"
          className="w-full h-full min-h-screen sm:min-h-0 sm:h-[844px] sm:max-w-md bg-stone-950 text-stone-100 flex flex-col relative sm:rounded-[40px] sm:border sm:border-stone-800/70 sm:shadow-2xl sm:shadow-black overflow-hidden"
        >
          <header 
            id="app-status-header"
            className="w-full pt-3 px-6 pb-2 flex items-center justify-between text-stone-400 text-[11px] font-medium select-none z-10 border-b border-stone-900/50"
          >
            <span className="tracking-tight text-stone-300 font-semibold">Tchat</span>
            <span className="text-[10px] text-amber-400 font-mono">recovery</span>
          </header>

          <section id="app-main-content" className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            <AuthEntry 
              initialView="reset_password"
              onAuthSuccess={() => {
                setIsPasswordRecovery(false);
                if (user) {
                  verifyUserIdentity(user.id);
                }
              }} 
            />
          </section>
        </main>
      </div>
    );
  }

  // 3. Unauthenticated state -> Auth Entry (Protected access to all screens)
  if (!session || !user) {
    return (
      <div 
        id="app-viewport-root"
        className="w-full h-full min-h-screen bg-stone-950 flex items-center justify-center sm:p-4 selection:bg-stone-800"
      >
        <main
          id="app-shell-container"
          className="w-full h-full min-h-screen sm:min-h-0 sm:h-[844px] sm:max-w-md bg-stone-950 text-stone-100 flex flex-col relative sm:rounded-[40px] sm:border sm:border-stone-800/70 sm:shadow-2xl sm:shadow-black overflow-hidden"
        >
          <header 
            id="app-status-header"
            className="w-full pt-3 px-6 pb-2 flex items-center justify-between text-stone-400 text-[11px] font-medium select-none z-10 border-b border-stone-900/50"
          >
            <span className="tracking-tight text-stone-300 font-semibold">Tchat</span>
            <div className="flex items-center gap-2">
              <PWAInstallButton variant="compact" />
              <span className="text-[10px] text-stone-500 font-mono">auth</span>
            </div>
          </header>

          <section id="app-main-content" className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            <AuthEntry 
              initialError={authInitialError}
              onClearUrlParams={() => setAuthInitialError(null)}
              onAuthSuccess={() => {
                // Session will be updated by onAuthStateChange
              }} 
            />
          </section>
        </main>
      </div>
    );
  }

  // 4. Authenticated but checking identity (ONLY on cold start when no profile is available yet)
  if (isCheckingIdentity && !profile) {
    return (
      <div 
        id="app-viewport-root"
        className="w-full h-full min-h-screen bg-stone-950 flex items-center justify-center sm:p-4"
      >
        <main className="w-full h-full min-h-screen sm:min-h-0 sm:h-[844px] sm:max-w-md bg-stone-950 text-stone-100 flex flex-col items-center justify-center sm:rounded-[40px] sm:border sm:border-stone-800/70 p-6 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-stone-400 mb-3" />
          <span className="text-xs text-stone-400 font-medium">Resolving Tchat identity...</span>
        </main>
      </div>
    );
  }

  // 5. Authenticated, but account is suspended or deactivated
  if (account && (account.status === 'suspended' || account.status === 'deactivated')) {
    return (
      <div 
        id="app-viewport-root"
        className="w-full h-full min-h-screen bg-stone-950 flex items-center justify-center sm:p-4"
      >
        <main className="w-full h-full min-h-screen sm:min-h-0 sm:h-[844px] sm:max-w-md bg-stone-950 text-stone-100 flex flex-col justify-between p-6 sm:rounded-[40px] sm:border sm:border-stone-800/70 overflow-y-auto">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-950/40 border border-rose-800/40 flex items-center justify-center text-rose-400">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-400">
                Account Status Restricted
              </span>
              <h1 className="text-xl font-semibold text-stone-100">
                Account {account.status === 'suspended' ? 'Suspended' : 'Deactivated'}
              </h1>
              <p className="text-xs text-stone-400 leading-relaxed">
                Your Tchat account is currently marked as <span className="font-semibold text-stone-300">{account.status}</span>. For the security of the community, active social features are restricted.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-stone-900 border border-stone-800 text-xs text-stone-400">
              If you believe this restriction is an error, please reach out through the official support channel with your registered email: <span className="text-stone-300 font-mono">{account.email}</span>.
            </div>
          </div>

          <div className="pt-6">
            <button
              id="btn-signout-restricted"
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </div>
        </main>
      </div>
    );
  }

  // 6. Authenticated, but database schema hasn't been executed on Supabase yet
  if (schemaPending) {
    return (
      <div 
        id="app-viewport-root"
        className="w-full h-full min-h-screen bg-stone-950 flex items-center justify-center sm:p-4"
      >
        <main className="w-full h-full min-h-screen sm:min-h-0 sm:h-[844px] sm:max-w-md bg-stone-950 text-stone-100 flex flex-col justify-between p-6 sm:rounded-[40px] sm:border sm:border-stone-800/70 overflow-y-auto">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-950/40 border border-amber-800/40 flex items-center justify-center text-amber-400">
              <Database className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                Database Migration Required
              </span>
              <h1 className="text-xl font-semibold text-stone-100">
                Execute Schema Migration
              </h1>
              <p className="text-xs text-stone-400 leading-relaxed">
                You are authenticated as <span className="text-stone-300 font-mono">{user.email || user.id.slice(0, 8)}</span>, but the application tables <code className="text-stone-300 bg-stone-900 px-1 py-0.5 rounded">accounts</code> and <code className="text-stone-300 bg-stone-900 px-1 py-0.5 rounded">profiles</code> do not exist in your Supabase project yet.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-stone-900 border border-stone-800 text-xs text-stone-300 space-y-2">
              <div className="font-semibold text-stone-200">Instructions:</div>
              <ol className="list-decimal list-inside space-y-1 text-stone-400 text-[11px] leading-relaxed">
                <li>Open your Supabase Project Dashboard.</li>
                <li>Go to the <span className="text-stone-200 font-medium">SQL Editor</span>.</li>
                <li>Copy and paste the contents of:</li>
              </ol>
              <div className="font-mono text-[10px] text-amber-300 bg-stone-950 p-2 rounded-lg break-all border border-stone-800">
                supabase/migrations/20260913000000_create_tchat_accounts_and_profiles.sql
              </div>
              <div className="text-[11px] text-stone-400">
                Then click <span className="text-stone-200 font-medium">Run</span> to create the tables, constraints, and RLS policies.
              </div>
            </div>
          </div>

          <div className="pt-6 space-y-2">
            <button
              id="btn-retry-schema"
              type="button"
              onClick={() => verifyUserIdentity(user.id)}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry Identity Check</span>
            </button>
            <button
              id="btn-signout-migration"
              type="button"
              onClick={handleSignOut}
              className="w-full py-2.5 px-4 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-stone-200 text-xs font-medium transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </main>
      </div>
    );
  }

  // 7. Authenticated, but no Tchat Profile completed yet -> Identity Setup
  if (!profile) {
    const requestedUsername = user.user_metadata?.requested_username || '';
    const initialDisplayName = user.user_metadata?.full_name || user.user_metadata?.name || '';
    const initialAvatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';

    return (
      <div 
        id="app-viewport-root"
        className="w-full h-full min-h-screen bg-stone-950 flex items-center justify-center sm:p-4 selection:bg-stone-800"
      >
        <main
          id="app-shell-container"
          className="w-full h-full min-h-screen sm:min-h-0 sm:h-[844px] sm:max-w-md bg-stone-950 text-stone-100 flex flex-col relative sm:rounded-[40px] sm:border sm:border-stone-800/70 sm:shadow-2xl sm:shadow-black overflow-hidden"
        >
          <header 
            id="app-status-header"
            className="w-full pt-3 px-6 pb-2 flex items-center justify-between text-stone-400 text-[11px] font-medium select-none z-10 border-b border-stone-900/50"
          >
            <span className="tracking-tight text-stone-300 font-semibold">Tchat</span>
            <button
              id="btn-signout-setup"
              type="button"
              onClick={handleSignOut}
              className="text-[10px] text-stone-500 hover:text-stone-300 font-mono transition-colors cursor-pointer"
            >
              sign out
            </button>
          </header>

          <section id="app-main-content" className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            <IdentitySetup
              userId={user.id}
              userEmail={user.email}
              initialUsername={requestedUsername}
              initialDisplayName={initialDisplayName}
              initialAvatarUrl={initialAvatarUrl}
              onIdentityComplete={handleIdentityComplete}
            />
          </section>
        </main>
      </div>
    );
  }

  // 8. Authenticated and Profile Completed -> Home / Feed / Profile
  return (
    <div 
      id="app-viewport-root"
      className="w-full h-full min-h-screen bg-stone-950 flex items-center justify-center sm:p-4 selection:bg-stone-800"
    >
      <main
        id="app-shell-container"
        className="w-full h-full min-h-screen sm:min-h-0 sm:h-[844px] sm:max-w-md bg-stone-950 text-stone-100 flex flex-col relative sm:rounded-[40px] sm:border sm:border-stone-800/70 sm:shadow-2xl sm:shadow-black overflow-hidden"
      >
        {/* Top Header (hidden when inside active 1:1 conversation) */}
        {!activeConversation && (
          <header 
            id="app-status-header"
            className="w-full pt-3 px-6 pb-2 flex items-center justify-between text-stone-400 text-[11px] font-medium select-none z-10 border-b border-stone-900/50"
          >
            <span className="tracking-tight text-stone-300 font-semibold">Tchat</span>
            <div className="flex items-center gap-2">
              <PWAInstallButton variant="compact" />
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] font-mono text-stone-300">@{profile.username}</span>
            </div>
          </header>
        )}

        {/* Place Content */}
        <section 
          id="app-main-content"
          className="flex-1 flex flex-col min-h-0 overflow-hidden relative"
        >
          {activeConversation && activeConversation.other_participant ? (
            <ConversationView
              conversationId={activeConversation.id}
              currentUserId={user.id}
              partner={activeConversation.other_participant}
              onBack={handleCloseConversation}
            />
          ) : currentPlace === 'home' && isViewingConnections ? (
            <ConnectionsView
              currentUserId={user.id}
              onBackToHome={() => setIsViewingConnections(false)}
              onOpenConversation={handleOpenConversationFromConnection}
            />
          ) : currentPlace === 'home' ? (
            <HomeAuthenticatedView
              user={user}
              profile={profile}
              account={account}
              onSignOut={handleSignOut}
              isSigningOut={isSigningOut}
              onOpenConnections={() => setIsViewingConnections(true)}
              incomingRequestsCount={incomingCount}
              connectionsCount={connectionsCount}
              conversations={conversations}
              isLoadingConversations={isLoadingConversations}
              onSelectConversation={handleOpenConversation}
            />
          ) : null}

          {!activeConversation && currentPlace === 'feed' && (
            <FeedView />
          )}

          {!activeConversation && currentPlace === 'profile' && isViewingConnections ? (
            <ConnectionsView
              currentUserId={user.id}
              onBackToHome={() => setIsViewingConnections(false)}
              onOpenConversation={handleOpenConversationFromConnection}
            />
          ) : !activeConversation && currentPlace === 'profile' ? (
            <ProfileView
              user={user}
              profile={profile}
              account={account}
              connectionsCount={connectionsCount}
              onOpenConnections={() => setIsViewingConnections(true)}
              onSignOut={handleSignOut}
              isSigningOut={isSigningOut}
            />
          ) : null}
        </section>

        {/* Permanent Places Navigation */}
        <Navigation 
          currentPlace={currentPlace} 
          onSelectPlace={(place) => {
            handleCloseConversation();
            setIsViewingConnections(false);
            setCurrentPlace(place);
          }} 
        />
      </main>
      <OfflineIndicator />
    </div>
  );
}
