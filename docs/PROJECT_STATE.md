# Tchat — Project State

> **CRITICAL RULE FOR FUTURE AGENTS:**
> **«PROJECT_STATE.md is a living checkpoint, not proof that functionality works. The repository, database state, tests, and actual verification evidence remain authoritative.»**
>
> - Do not claim verification without evidence.
> - Do not silently remove blockers.
> - Do not mark deferred work as completed.
> - Update this file after every major implementation/verification task.
> - Keep it concise; do not turn it into a giant PRD.

---

## Current Stage

**Groups — Phase 6.3: Group Conversation & Ephemeral Media Implemented, Migrated & Verified.**
- Core client foundations (React 18, TypeScript, Vite, Tailwind CSS v4) active with clean mobile-first ergonomics (`max-w-md` shell).
- Group Conversation Experience (`ActiveGroupView`):
  - Group-specific contextual header: name, avatar/thumbnail, lifetime remaining badge (`1d left`, etc.), member count badge with modal launcher, role pill (Admin, Mod, Special, Member), and pending join-request review banner for Admins/Mods.
  - Chronological message stream with sender avatar, display name, handle, role badge, timestamp, and consecutive grouping.
  - Full ephemeral media support: photos, videos, audio, documents with 24-hour expiration indicators (`Clock` countdown), full-screen viewer modal, recipient save action (`Bookmark`), and sender restriction indicators (`Lock`).
  - Lifecycle-aware composer (`GroupMessageComposer`): disabled when group is `read_only`, `expired`, or `deleted`.
  - Supabase Realtime channel integration with reconnect resync catchup and forward-only monotonic read marker tracking.
- Database & RPC enhancements:
  - Updated `save_media_asset` RPC to support group media assets with group membership validation and active/read_only lifecycle authorization.
  - Group media upload and storage path integration: `groups/{groupId}/{assetId}-{filename}` in `conversation-media` bucket.
- 10 automated end-to-end checks verified passing in `test/group_conversation_phase6_3.test.ts`.
- Production build and TypeScript linting clean with 0 errors.

---

## Product Boundaries

These conceptual distinctions must **NEVER** be collapsed:

1. **Connection ≠ conversation**: A connection does not automatically spawn a conversation thread or message channel.
2. **Connection ≠ Home activity**: Home reflects intentional today-activity, not a static list of connections.
3. **Home ≠ history/archive**: Home is a living space for today's social context, not a permanent chronological log.
4. **Presence ≠ availability**: Presence means currently active in Tchat; it does not indicate willingness or obligation to respond.
5. **Public interaction ≠ connection**: Interacting publicly (e.g. on Feed) creates zero connection status.
6. **Streak ≠ daily punishment/loss-aversion**: Streaks represent mutual continuity; a missed day makes a streak dormant, never reset or punitive.
7. **Media ≠ permanent archive**: Media is ephemeral by default.
8. **Group ≠ automatically permanent community**: Groups are temporary by default with intentional renewal.
9. **Circle ≠ permanent channel**: Circles are temporary activity spaces, not static Discord channels.
10. **Contextual event ≠ permanent navigation**: Permanent navigation is strictly for places (`Home`, `Feed`, `Profile`). Contextual navigation is for transient events (requests, calls, notifications).

---

## Implemented

- **Architecture & Build**: React 18, TypeScript, Vite 6, Tailwind CSS v4, Lucide icons, mobile-first responsive container (`max-w-md` shell with safe-area support).
- **Supabase Client**: Initialized in `src/lib/supabase.ts` with publishable key fallback (`VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_ANON_KEY`). Service-role keys are strictly forbidden and excluded.
- **Authentication Domain**:
  - Email/password sign-in and sign-up.
  - Username-based sign-in/up via custom PostgreSQL RPC `get_auth_email_for_login`.
  - Google OAuth invocation using `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`.
  - Password reset request and update flow with URL hash parsing (`recovery` mode).
  - Resend verification email with 60-second cooldown timer.
  - Legal modal terms/privacy acknowledgment during registration.
- **Identity Domain**:
  - `accounts` table with account status enforcement (`active`, `suspended`, `deactivated`).
  - `profiles` table with unique username validation, display name, and avatar URL.
  - Profile setup view for first-time sign-ins missing profile records.
- **Connections Domain**:
  - `connection_requests` table with 3–300 character mandatory context constraint.
  - Request lifecycle statuses: `pending`, `accepted`, `declined`, `ignored`, `cancelled`.
  - Canonical `connections` table storing ordered pairs `(user_a_id < user_b_id)`.
  - Unfriend logic removing bidirectional connections.
  - `blocks` table with bidirectional request and profile discovery prevention.
  - 9 PostgreSQL RPC business logic functions with caller identity verification (`auth.uid()`).
  - Client-side event bus (`onConnectionEvent`) synchronizing UI count badges.
- **Conversations Domain**:
  - Persistent 1:1 conversation model initiated strictly between confirmed connections.
  - PostgreSQL migration `20260913020000_create_tchat_conversations_and_messages.sql` with RLS policies, unread tracking, and delivery receipts.
  - Supabase Realtime channel subscriptions for live message ingestion and status synchronization.
  - Strict product distinction: accepting a connection or opening a thread does not create Home activity; only meaningful interaction during the local day surfaces in Today's Conversations.
  - Full optimistic message lifecycle with sending, sent, delivered, read, and retry on failure.
  - Automatic graceful degradation with schema-pending indicator when migrations are awaiting execution.
- **Ephemeral Media Domain**:
  - Generic `MediaAsset` model supporting `image`, `video`, `audio`, and `file`.
  - Authoritative 24-hour expiration model: `expires_at = sent_at + interval '24 hours'`.
  - Ephemeral by default; viewing does not reset or pause the 24-hour timer.
  - Recipient save action: converts ephemeral asset into a persistent attachment (`is_saved = true`), stopping expiration.
  - Sender-controlled save restriction: senders can disable recipient saving per asset (`allow_recipient_save = false`).
  - Private Supabase Storage bucket `conversation-media` (50MB max limit).
  - Storage RLS security: storage access strictly requires conversation membership AND (`is_saved = true OR expires_at > now()`). Expired media cannot be fetched or resolved.
  - Realtime event bus (`onMediaEvent`) dispatches `media:created` and `media:saved` events.
  - Lightweight one-time educational tip (`FirstUseMediaSaveTip`) explaining the 24-hour retention and save action.
  - PWA Service Worker caching policy updated to strictly forbid caching conversation media and Supabase storage responses.
  - PostgreSQL migration created: `supabase/migrations/20260914030000_create_tchat_media_assets.sql`.
- **Groups Domain**:
  - **Stage 3 (Core Schema & RLS Foundation)**:
    - Tables: `groups`, `group_members`, `group_join_requests`, `group_bans`.
    - Hard structural database constraints for lifetime (`1_day`, `3_days`, `1_week`), max size (<= 30), visibility (`discoverable`, `private`), access mode (`open`, `request`, `question`), and joining question requirement.
    - Exactly-One-Admin invariant for operating active groups via deferred constraint trigger and unique index.
    - Role capacity limits (maximum 1 mod, maximum 5 specials) enforced via database triggers.
    - Dynamic 50% capacity surge protection via `get_group_effective_access_mode`.
    - Strict Row Level Security policies protecting private groups, member lists, and banned users.
    - Migration applied: `supabase/migrations/20260918090000_create_tchat_groups_phase1.sql`.
  - **Stage 4 (Membership & Access Operations)**:
    - Server-authoritative, race-safe `SECURITY DEFINER` RPCs with row-level locks (`FOR UPDATE`):
      - `create_group`: Atomically inserts group and provisions caller as initial `admin`.
      - `join_group`: Direct join on open groups with capacity check (`< max_size`), dynamic 50% surge protection, rejoining role reset (rejoins strictly as `member`), ban/removal checks, and mutual block prevention.
      - `request_to_join_group`: Validates request mode, answering joining questions, duplicate pending request prevention, removed/banned member blocks, and mutual safety blocks.
      - `cancel_group_join_request`: Requester-only cancellation of pending requests.
      - `approve_group_join_request`: Admin/mod review with race-safe capacity check under row lock.
      - `decline_group_join_request`: Admin/mod review marking request declined.
      - `assign_group_member_role`: Admin-only promotion/demotion respecting role limits (1 mod, 5 specials).
      - `transfer_group_admin`: Atomic admin handoff with predecessor demoted to `member`, preserving exactly-one-admin invariant.
      - `leave_group`: Enforces admin succession requirement when group has other active members; sole Admin departure marks group as `deleted` because the group is now empty.
      - `remove_group_member`: Admin/mod member removal; prevents mod removing admin or peer mod; records removal and blocks rejoining via normal paths.
      - `ban_group_member`: Admin/mod user banning; removes active membership, creates ban record, cancels pending join requests; blocks rejoining.
      - `unban_group_member`: Admin/mod unban operation deleting ban record.
      - `get_group_details` & `list_group_members`: Authenticated read helpers with visibility and ban enforcement.
      - `get_group_join_requests`: Admin/mod access for viewing pending requests.
    - Canonical Invariants & Lifecycle Rules:
      - Canonical Validation Limits: Group name (2–60 characters), reason (3–300 characters).
      - Sole-Admin Lifecycle: Admin with other active members cannot leave without atomically designating an active successor; Admin transfer is strictly atomic; Admin cannot be removed or banned; leaving as sole remaining member transitions group to `deleted` (empty group cleanup).
    - Client Domain Service (`src/domains/groups/`):
      - Comprehensive TypeScript types (`Group`, `GroupMember`, `GroupJoinRequest`, `GroupBan`, etc.).
      - Client-side input validation (`validateGroupName`, `validateGroupReason`, `validateGroupLifetime`, `validateGroupSize`, `validateCreateGroupInput`).
      - In-memory event bus (`emitGroupEvent`, `onGroupEvent`) for real-time UI synchronization.
      - `groupsService` providing client RPC invocation wrappers with authentication guards.
    - Migration applied: `supabase/migrations/20260918100000_groups_membership_and_access_operations.sql`.
  - **Phase 6.2: Group Entry & Membership (UI & End-to-End Integration)**:
    - User Interface components:
      - `DiscoverGroupsModal`: Browse discoverable active groups, access modes, capacity pills, and search filter.
      - `GroupDetailView`: Dedicated non-member view showing reason, access mode badge, lifetime countdown, joining question prompts with validation, join/request actions, and pending state indicator.
      - `ActiveGroupView`: Dedicated temporary space for active members with header metadata, active member counter, member list modal, join request review modal, and leave action.
      - `GroupMembersModal`: Active member list with role badges (Admin, Mod, Special, Member) and management actions.
      - `GroupJoinRequestsModal`: Pending applicant review list with question answers, approve, and decline actions.
      - `GroupLeaveModal`: Leave confirmation with mandatory successor selector when the leaving user is the group administrator.
    - AppShell & Home Integration:
      - AppShell tracks contextual group state (`selectedGroupId`, `activeGroupSpace`, `isDiscoveringGroups`).
      - Home displays "Active Groups" horizontal cards section separated from 1:1 conversation items, honoring the core principle: "Group activity must not appear as ordinary 1:1 Home conversation activity."
      - Event listeners synchronized across group join, leave, request, and role change events.
    - Error & Invariant Handling:
      - Human-readable error formatting via `formatGroupError` preventing raw Postgres/Supabase traces from showing in the UI.
      - Fixed atomic succession order in `leave_group` so old admin departs before new admin is promoted, cleanly satisfying the `idx_group_members_unique_admin` constraint.
    - Automated tests: `test/groups_entry_membership_ui_flow.test.ts` (7 suites) and `test/groups_membership.test.ts` (14 suites) passing cleanly.
  - **Phase 6.3: Group Conversation & Ephemeral Media**:
    - Complete conversation experience in `ActiveGroupView`:
      - Contextual header with group avatar/cover, lifetime expiration, member count button with modal launcher, role badge (Admin, Mod, Special, Member), and pending join-request banner for Admins/Mods.
      - Chronological message stream with sender avatar, name, handle, role, timestamp, and consecutive message grouping.
      - Ephemeral group media bubbles (`GroupMediaBubble`) with independent 24-hour expiration calculation, formatted time remaining (`formatMediaTimeRemaining`), recipient save action (`saveGroupMediaAsset`), and sender-controlled save restrictions.
      - Media viewer modal for expanded full-screen preview.
      - Lifecycle-aware composer (`GroupMessageComposer`) with 2000-character counter, ephemeral media file picker, and automatic read-only disabling for non-active/expired groups.
    - Database & RPC enhancements:
      - Updated `public.save_media_asset` RPC with dual authorization: works for both 1:1 conversations and group members in active/read-only groups.
      - Group media storage path isolation (`groups/{groupId}/{assetId}-{filename}`) using the `conversation-media` bucket.
    - Automated tests: `test/group_conversation_phase6_3.test.ts` (10 suites) and `test/groups_messaging.test.ts` (9 suites) passing with 100% success.
- **UI Organization & Coherence Pass**:
  - Navigation architecture: "Permanent navigation is for places (`Home`, `Feed`, `Profile`). Contextual navigation is for things happening (`Connections`, `Conversation`)."
  - `Home`: Standardized "Today" header with day/date hierarchy, unread badge indicators, connection alerts banner, and filtered Today's conversations list.
  - `Connections`: Consistent contextual header with back navigation, unified horizontal tab pills, full empty/active states for Connections, Incoming requests, Find people (with mandatory context modal), Sent requests, and Blocked accounts.
  - `Conversation`: Dedicated full-height 1:1 messaging space with partner header, auto-resizing composer, and delivery/read indicator status.
  - `Profile`: Dedicated identity management screen displaying username handle, bio, account email, creation date, presence indicator, and sign-out action.
  - `Feed`: Dedicated discovery screen reflecting the principle that public interaction does not imply connection.
  - Visual Foundation: Calm, mobile-first, neutral dark aesthetic with warm stone palette, consistent typography, generous spacing, and Lucide icons throughout.
- **PWA Foundation**:
  - Web App Manifest (`manifest.webmanifest`) with `standalone` display, `#121214` theme, `#0c0a09` background.
  - Standard PNG icons: `192x192`, `512x512`, `512x512` maskable (15% safe margin), `apple-touch-icon.png` (180x180), `favicon.png`.
  - Workbox Service Worker precaching static JS/CSS/HTML only.
  - **PWA Security**: Under no circumstances are Supabase Auth responses, session tokens, profile records, connections, or API requests cached.
  - In-app install button (`PWAInstallButton`) with Safari iOS step-by-step guidance modal.
  - Non-intrusive `OfflineIndicator` reporting network drop without breaking app state.
- **Vercel Deployment Configuration**:
  - `vercel.json` with SPA catch-all rewrites to `/index.html`.
  - Cache headers: `max-age=0, must-revalidate` for `/sw.js` and `/manifest.webmanifest`; immutable caching for hashed `/assets/*`.

---

## Verified

### Automated Verification
- **TypeScript**: `tsc --noEmit` passed with 0 errors.
- **Linter**: `npm run lint` passed cleanly.
- **Production Build**: `npm run build` generates clean `dist/` bundle including Service Worker (`sw.js`), Workbox runtime, and manifest.
- **Unit & Domain Tests**: `npm test` runs 39 passing automated unit tests (13 Connections + 26 Ephemeral Media):
  - Connections: context reason length enforcement (3–300 chars, trimming, null handling), canonical pair ordering `LEAST(a, b) < GREATEST(a, b)`, event bus lifecycle.
  - Ephemeral Media: filename sanitization, 0-byte rejection, category-specific file size limits (20MB photos, 25MB audio, 50MB video/docs), MIME whitelist, authoritative 24-hour expiration calculation, active vs. expired detection, saved asset lifetime preservation, recipient-only save authorization, and time remaining formatters.

### Database Verification
- Applied migrations on remote Supabase:
  - `20260913000000_create_tchat_accounts_and_profiles.sql`
  - `20260913010000_create_tchat_connections_and_blocks.sql`
- Pending migrations for Supabase SQL Editor:
  - `20260913020000_create_tchat_conversations_and_messages.sql` (Conversations)
  - `20260914030000_create_tchat_media_assets.sql` (Ephemeral Media & Storage RLS)
- Remote schema inspection confirmed all 9 RPC functions active in schema cache:
  `search_profiles`, `send_connection_request`, `accept_connection_request`, `decline_connection_request`, `ignore_connection_request`, `cancel_connection_request`, `unfriend_user`, `block_user`, `unblock_user`.
- Constraints confirmed active: canonical connection ordering, non-empty context, self-request block, bidirectional unique block index.

### Live Security Verification
- Anonymous REST queries to `accounts`, `connections`, `connection_requests`, and `blocks` return `401 Unauthorized (code: 42501 permission denied)`.
- Direct invocation of RPC functions without an authenticated session returns `400 Not authenticated`.
- `profiles` allows public read access for search while protecting private emails.

### Manual Verification
- Tested account sign-in and profile fetch against remote Supabase instance for existing user (`tonbi360`).

---

## Blocked

### Authentication
- **Default SMTP Rate Limit**: Supabase's default email service returns `AuthApiError: email rate limit exceeded (status 429, code over_email_send_rate_limit)`. Live sign-up with new email addresses is rate-limited until a custom SMTP provider (e.g. Resend, SendGrid) is connected.
- **Google OAuth Dashboard Setup**: Google sign-in trigger exists in frontend, but requires Google Cloud OAuth credentials (Client ID / Secret) configured in Supabase Dashboard -> Authentication -> Providers -> Google.
- **Production Auth Redirect URLs**: Supabase Auth Site URL and Redirect URLs must be updated with the final production Vercel deployment URL.

### Connections
- **Multi-User Live Testing**: Real end-to-end two-account connection tests in browser remain blocked until secondary test accounts can be provisioned through email or dashboard.
- **Interactive In-Browser Testing**: Manual point-and-click UI verification in a live browser across mobile viewports remains required.

---

## Deferred UI/UX Pass

The following UI/UX improvements are intentionally deferred and do not block functional domain progress:
- Pre-auth / splash brand intro experience.
- Password visibility toggle (eye icon) on auth forms.
- Overall auth/identity visual refinement and fine spacing adjustments.
- Direct avatar upload via Supabase Storage (currently accepts image URLs).
- Final color palette tuning and stone contrast polish.
- Polishing transitions and haptic micro-interactions for mobile touch targets.

---

## Unresolved Product/System Decisions

These architectural and UX decisions remain intentionally open; do not speculate or build arbitrary defaults:
- Exact streak qualifying interaction types and visual continuity representation.
- Media save / retention and server-side deletion lifecycle.
- Timezone handling for daily "today" boundary.
- Group expiration duration and explicit renewal mechanics.
- Actionable vs. passive notification presentation.
- Status lifecycle, expiration, and presence rules.
- Hot Take interaction mechanics and expiration.
- Music matching and shared listening details.
- Circle time limits, active participant caps, and grace behavior.
- In-call UI, call contexts, and WebRTC signalling architecture.
- Group member permissions and circle creator roles.
- Feed discovery sorting and content eligibility criteria.

---

## Manual Actions Required (Tonbi)

The following actions require access to external dashboards (Vercel and Supabase):

1. **Deploy Frontend to Vercel**:
   - Import the Tchat repository into Vercel.
   - Set Build Command: `npm run build`
   - Set Output Directory: `dist`
   - Configure Environment Variables in Vercel Project Settings:
     - `VITE_SUPABASE_URL`: `https://<your-project>.supabase.co`
     - `VITE_SUPABASE_PUBLISHABLE_KEY`: `<your-supabase-anon/publishable-key>`
     - `VITE_APP_URL`: `https://<your-deployed-vercel-project>.vercel.app`
2. **Update Supabase Auth URLs**:
   - In Supabase Dashboard -> **Authentication** -> **URL Configuration**:
     - **Site URL**: Set to `https://<your-deployed-vercel-project>.vercel.app`
     - **Redirect URLs**: Add `https://<your-deployed-vercel-project>.vercel.app/**`
3. **Configure Custom SMTP (To unblock multi-user signups)**:
   - In Supabase Dashboard -> **Project Settings** -> **Authentication** -> **SMTP Settings**:
     - Enable Custom SMTP using Resend, SendGrid, Postmark, or AWS SES to remove the default 3 emails/hour rate limit.
4. **Configure Google OAuth (Optional for initial test)**:
   - In Google Cloud Console: Create OAuth 2.0 Client ID for Web.
   - In Supabase Dashboard -> **Authentication** -> **Providers** -> **Google**: Add Client ID and Secret.

---

## Current Task

**Calls — Phase 1: Core Schema + Immediate Call Requests (Complete)**
- Created migration `supabase/migrations/20260916050000_create_tchat_calls.sql` establishing `calls` and `call_sessions` tables.
- Executed migration on live Supabase instance (`jqghykhnnrfsjkkjhekf`) via `npm run db:migrate`.
- Created and verified remote tables: `calls`, `call_sessions` with RLS and foreign key constraints.
- Created and verified remote RPCs: `create_call_request`, `respond_to_call`, `cancel_call`, `get_conversation_calls`, `get_active_call_for_conversation`.
- Created and verified relationship triggers: `trg_connection_deleted_calls` and `trg_block_created_calls` ensuring pending calls cancel when unfriended or blocked.
- Implemented frontend calls domain layer:
  - `src/domains/calls/types.ts`: models, statuses, outcomes, preset reasons, provisional expiration constant (120s).
  - `src/domains/calls/validation.ts`: context reason validation, mode validation (immediate only), expiration calculations.
  - `src/domains/calls/events.ts`: event bus for call lifecycle synchronization.
  - `src/domains/calls/callsService.ts`: RPC wrapper service with schema error tolerance.
  - `src/domains/calls/realtime.ts`: Supabase Realtime channel subscription helper.
- Implemented minimal contextual UI:
  - `src/components/conversations/calls/PendingCallBanner.tsx`: in-conversation banner with countdown timer, reason, Accept/Decline (for recipient) and Cancel (for initiator).
  - `src/components/conversations/calls/CallRequestModal.tsx`: bottom sheet to select context presets or custom note.
  - Integrated with `ConversationHeader` and `ConversationView`.
- Added 6 automated tests in `test/calls.test.ts`. Total 81 passing tests across 6 test suites.
- Typecheck (`tsc --noEmit`) and production build (`npm run build`) passing with 0 errors.

---

## Next Task

**Calls — Phase 2: Call Media / WebRTC Signaling & Active Call Session Layer**:
- Define technical signaling architecture for WebRTC handshake using Supabase Realtime channels.
- Implement microphone permissions and audio stream management for accepted calls.
- Track call duration and record technical session records in `call_sessions`.
- Handle network disconnects, caller abandonment, and graceful call termination.
