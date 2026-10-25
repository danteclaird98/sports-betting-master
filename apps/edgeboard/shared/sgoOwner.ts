/** Account capture is checked again after delayed transport, including A -> B -> A switches. */
export function sgoRequestOwnerMatches(authenticatedOwner: string, expectedOwner: unknown): boolean {
  return Boolean(authenticatedOwner) && (expectedOwner === undefined || expectedOwner === authenticatedOwner);
}
export function createSgoOwnerSession(readOwner: () => Promise<string | null>, changed: (owner: string | null) => void) {
  let owner: string | null | undefined, epoch = 0, sequence = 0;
  function adopt(next: string | null) {
    if (owner !== next) { owner = next; epoch++; changed(next); }
  }
  async function sync() {
    const request = ++sequence;
    try {
      const next = await readOwner();
      if (request === sequence) adopt(next);
      return owner ?? null;
    } catch {
      if (request === sequence) adopt(null);
      throw Error('Account identity could not be verified. Sign in and retry.');
    }
  }
  return {
    sync,
    invalidate() { epoch++; sequence++; },
    async capture() {
      const current = await sync();
      if (!current) throw Error('Sign in before accessing provider requests or private history.');
      return { owner: current, epoch };
    },
    async accepts(ticket: { owner: string; epoch: number }, responseOwner: unknown) {
      const current = await sync();
      return ticket.epoch === epoch && ticket.owner === current && responseOwner === ticket.owner;
    },
  };
}
