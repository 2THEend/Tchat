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

**Streaks UI/UX Layer & Remote Database Schema Fully Implemented & Verified.**
- Core client foundations (React 18, TypeScript, Vite, Tailwind CSS v4) are active with clean mobile-first ergonomics (`max-w-md` shell).
- Full Supabase backend schemas for Auth, Identity, Connections, Blocks, Conversations, Ephemeral Media, and Streaks are applied on the remote Supabase instance (`jqghykhnnrfsjkkjhekf`).
- Ephemeral Media domain implemented with private bucket `conversation-media`.
- Streaks backend/persistence foundation active via `scripts/migrate.mjs`:
  - Tables `streaks`, `streak_participant_days`, `streak_progress_days` active with RLS.
  - All RPCs (`initiate_streak`, `accept_streak`, `decline_streak`, `cancel_streak`, `end_streak`, `get_conversation_streaks`, `get_streak_progress_history`, `evaluate_streak_dormancy`, `record_streak_qualifying_interaction`) active.
- Streaks UI/UX layer implemented within 1:1 Conversation view:
  - `StreakBadges`: Compact, calm badge bar showing active/dormant streaks with explicit "days" unit (e.g. `Chat · 18 days`). Never bare numbers or flame gamification.
  - `PendingStreakBanner`: In-conversation banner displaying pending invitations with Accept / Decline for recipients and Cancel for initiators.
  - `StreaksModal`: Intentional bottom sheet/modal to view continuity, today's qualification status, and start uninitiated types (Chat, Photo, Video).
  - Seamless real-time event updates via `onStreakEvent` and auto-resync upon message sending/receiving.
- 75 total automated tests passing across 5 test suites (`connections.test.ts`, `media.test.ts`, `lifecycle.test.ts`, `streaks.test.ts`, `streaks_ui.test.ts`).
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

**Streaks Domain & Remote Database Migration (Complete)**
- Configured automated migration runner `scripts/migrate.mjs` using `SUPABASE_ACCESS_TOKEN` via the Supabase Management API.
- Executed and verified `supabase/migrations/20260915040000_create_tchat_streaks.sql` on remote Supabase instance `jqghykhnnrfsjkkjhekf` in 0.54s.
- Created and verified remote tables: `streaks`, `streak_participant_days`, `streak_progress_days` (all RLS-secured).
- Verified remote RPCs: `initiate_streak`, `accept_streak`, `decline_streak`, `cancel_streak`, `end_streak`, `get_conversation_streaks`, `get_streak_progress_history`, `evaluate_streak_dormancy`, `record_streak_qualifying_interaction`.
- Added `npm run db:migrate` npm script for running migrations automatically.
- Total 70 automated tests passing across 4 test suites with 0 lint errors and clean builds.

---

## Next Task

**Streak UI Layer Implementation (Next Phase)**:
- Build intentional, calm Streak indicators in 1:1 conversation headers.
- Build Streak initiation modal/drawer with type selector (`chat`, `photo`, `video`).
- Build pending streak invitation banner with Accept/Decline actions for recipients.
- Visually communicate dormant state without punitive reset counters or noisy gamification.
