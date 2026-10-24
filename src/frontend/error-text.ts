import type { PveCallError } from "./api";

// Codes whose fix the user can act on get their own words; the rest show
// the server's message as it came.
const KEYS: Record<string, string> = {
  PVE_TLS_UNTRUSTED: "errors.tlsUntrusted",
  PVE_TLS_HOSTNAME: "errors.tlsHostname",
  PVE_TLS_EXPIRED: "errors.tlsExpired",
  PVE_NOT_ENABLED: "errors.notEnabled",
  PVE_HOST_ACCESS: "errors.hostAccess",
};

/** The text to show for a failed call. */
export function errorText(
  t: (key: string) => string,
  error: PveCallError,
): string {
  const key = error.code ? KEYS[error.code] : undefined;
  return key ? t(key) : error.message;
}
