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

**Frontend Deployment Preparation + PWA Foundation + Pre-Conversations Checkpoint.**
- Core client foundations (React 18, TypeScript, Vite, Tailwind CSS v4) are active.
- Full Supabase backend schemas for Auth, Identity, Connections, and Blocks are applied and active on the remote Supabase instance.
- Offline-safe, conservative PWA installability with valid Web App Manifest, PNG/SVG icons, and Service Worker caching is implemented and verified.
- Prepared for Vercel deployment with `vercel.json` SPA routing rewrites and cache controls.
- Next major domain is **Conversations** (1:1 messaging architecture between confirmed connections).

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
- **Unit & Domain Tests**: `npm test` runs 13 passing automated unit tests for the Connections domain:
  - Context reason length enforcement (min 3 chars, max 300 chars, whitespace trimming, null handling).
  - Canonical pair ordering invariant `LEAST(a, b) < GREATEST(a, b)`.
  - Connection event bus listener dispatch and unsubscription lifecycle.

### Database Verification
- Applied migrations on remote Supabase:
  - `20260913000000_create_tchat_accounts_and_profiles.sql`
  - `20260913010000_create_tchat_connections_and_blocks.sql`
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

**Frontend Deployment + PWA + Project State Checkpoint**

---

## Next Task

**Conversations Domain**:
- 1:1 messaging architecture restricted strictly to confirmed connections.
- PostgreSQL schema for conversations and messages.
- Ephemeral default retention model.
- Realtime subscription integration via Supabase Realtime.
- Unread status tracking separated from Home activity.
