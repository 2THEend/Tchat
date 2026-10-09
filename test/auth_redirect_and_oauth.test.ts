/**
 * Production Auth Redirect, Callback Parsing, and Google OAuth Handling Unit Tests
 */

import {
  DEFAULT_PRODUCTION_APP_URL,
  getAuthRedirectUrl,
  parseAuthUrlParams,
  hasAuthUrlParams,
  formatAuthUrlError,
  clearAuthUrlParams,
} from '../src/domains/auth/urlHandler';

let mockHref = 'https://tchat-bay.vercel.app/';
let mockOrigin = 'https://tchat-bay.vercel.app';
let mockPathname = '/';
let mockSearch = '';
let mockHash = '';

const mockLocation = {
  get href() { return mockHref; },
  get origin() { return mockOrigin; },
  get pathname() { return mockPathname; },
  get search() { return mockSearch; },
  get hash() { return mockHash; },
};

let replacedUrl = '';
const mockHistory = {
  replaceState: (_state: unknown, _title: string, url: string) => {
    replacedUrl = url;
  },
};

(globalThis as unknown as Record<string, unknown>).window = {
  location: mockLocation,
  history: mockHistory,
};
(globalThis as unknown as Record<string, unknown>).document = {
  title: 'Tchat',
};

function runAuthRedirectTests() {
  console.log('=== Running Production Auth Redirect & Callback Tests ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Canonical Redirect URL Resolution
  console.log('--- Redirect URL Resolution (getAuthRedirectUrl) ---');
  assert(
    getAuthRedirectUrl('https://tchat-bay.vercel.app', null) === 'https://tchat-bay.vercel.app',
    'Uses deployed production origin when running on https://tchat-bay.vercel.app'
  );
  assert(
    getAuthRedirectUrl('http://localhost:3000', null) === 'http://localhost:3000',
    'Preserves http://localhost:3000 origin during local development'
  );
  assert(
    getAuthRedirectUrl(null, 'https://tchat-bay.vercel.app/some/path') === 'https://tchat-bay.vercel.app',
    'Falls back to normalized VITE_APP_URL origin when window origin is unavailable'
  );
  assert(
    getAuthRedirectUrl(null, null) === DEFAULT_PRODUCTION_APP_URL &&
      !DEFAULT_PRODUCTION_APP_URL.includes('localhost'),
    'Never falls back to localhost when window origin and VITE_APP_URL are absent'
  );

  // 2. Callback Parameter Parsing (Hash + Search Query)
  console.log('\n--- Auth Callback Parameter Parsing (parseAuthUrlParams) ---');
  const hashTokens = parseAuthUrlParams(
    '',
    '#access_token=jwt-acc-123&refresh_token=ref-456&type=signup'
  );
  assert(hashTokens.accessToken === 'jwt-acc-123', 'Extracts access_token from URL hash');
  assert(hashTokens.refreshToken === 'ref-456', 'Extracts refresh_token from URL hash');
  assert(hashTokens.type === 'signup', 'Extracts type=signup from URL hash');
  assert(hasAuthUrlParams(hashTokens) === true, 'Detects presence of hash auth tokens');

  const pkceQuery = parseAuthUrlParams('?code=pkce-auth-code-789', '');
  assert(pkceQuery.code === 'pkce-auth-code-789', 'Extracts PKCE code from query string');
  assert(hasAuthUrlParams(pkceQuery) === true, 'Detects presence of PKCE code parameter');

  const tokenHashQuery = parseAuthUrlParams('?token_hash=th_abc123&type=signup', '');
  assert(tokenHashQuery.tokenHash === 'th_abc123', 'Extracts token_hash from email verification link');
  assert(tokenHashQuery.type === 'signup', 'Extracts type=signup from query string');
  assert(hasAuthUrlParams(tokenHashQuery) === true, 'Detects presence of token_hash parameter');

  // 3. Error Formatting
  console.log('\n--- Auth Callback Error Formatting (formatAuthUrlError) ---');
  const expiredErr = formatAuthUrlError(
    parseAuthUrlParams('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  );
  assert(
    Boolean(expiredErr && expiredErr.includes('expired')),
    'Formats expired email verification link into clear user message'
  );

  const disabledProviderErr = formatAuthUrlError(
    parseAuthUrlParams('?error=server_error&error_description=Unsupported+provider%3A+provider+is+not+enabled', '')
  );
  assert(
    Boolean(disabledProviderErr && disabledProviderErr.includes('Google sign-in is not yet enabled')),
    'Formats disabled Google OAuth provider error cleanly'
  );

  // 4. URL Parameter Cleanup
  console.log('\n--- Address Bar Cleanup (clearAuthUrlParams) ---');
  mockHref = 'https://tchat-bay.vercel.app/?code=pkce-123&type=signup#access_token=abc&refresh_token=def';
  mockSearch = '?code=pkce-123&type=signup';
  mockHash = '#access_token=abc&refresh_token=def';
  clearAuthUrlParams();
  assert(replacedUrl === '/', 'Strips auth query params and access_token hash after session consumption');

  mockHref = 'https://tchat-bay.vercel.app/#c=conv-1234';
  mockSearch = '';
  mockHash = '#c=conv-1234';
  clearAuthUrlParams();
  assert(replacedUrl === '/#c=conv-1234', 'Preserves non-auth conversation hash (#c=...) when cleaning URL');

  console.log(`\nAuth redirect & callback tests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAuthRedirectTests();
