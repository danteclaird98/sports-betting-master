/** Legacy requests may omit owner. New clients bind their captured account so
 * SDK token changes cannot apply a pending request to a different account. */
export function ledgerRequestOwnerMatches(authenticatedOwner: string, body: unknown): boolean {
  if (!authenticatedOwner) return false;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return true;
  return !('owner' in body) || (body as Record<string, unknown>).owner === authenticatedOwner;
}
