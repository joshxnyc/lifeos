import "server-only";

/**
 * CSRF for the Google connect flow: the nonce/signature helpers are shared
 * with the Granola flow (lib/integrations/oauth-state.ts); only the cookie
 * name is Google's own.
 */
export { newNonce, signState, stateMatches } from "@/lib/integrations/oauth-state";

export const GOOGLE_STATE_COOKIE = "lifeos_google_oauth_state";
