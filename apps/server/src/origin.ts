/** Accepts any origin when none is configured, which keeps local development simple. */
export function isAllowedOrigin(origin: string | undefined, allowed: string | undefined): boolean {
  if (!allowed) return true;
  return origin === allowed;
}
