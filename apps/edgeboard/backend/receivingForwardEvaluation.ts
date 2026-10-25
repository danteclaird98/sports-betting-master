import { receivingForwardHistory } from './receivingForward.ts';
import { receivingForwardProtocol, type ForwardReceipt } from './receivingForwardCore.ts';
import { evaluateReceivingForward } from './receivingForwardEvaluationCore.ts';
import { loadReceivingForwardOutcomes } from './receivingForwardOutcomes.ts';

type Page = Awaited<ReturnType<typeof receivingForwardHistory>>;
type Dependencies = {
  readPage?: (owner: string, token?: string) => Promise<Page>;
  loadOutcomes?: typeof loadReceivingForwardOutcomes;
  deadlineMs?: number;
};

/** Bounded, explicit, read-only evaluation. No client probabilities or outcomes are accepted. */
export function createReceivingForwardEvaluation(deps: Dependencies = {}) {
  const readPage = deps.readPage ?? receivingForwardHistory;
  const loadOutcomes = deps.loadOutcomes ?? loadReceivingForwardOutcomes;
  const deadlineMs = deps.deadlineMs ?? 26_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 26_000)
    throw Error('EVALUATION_DEADLINE_INVALID');
  return async (owner: string, body: unknown = {}) => {
    const controller = new AbortController();
    const deadlineAt = performance.now() + deadlineMs;
    const guardDeadline = () => {
      if (controller.signal.aborted || performance.now() >= deadlineAt) throw Error('EVALUATION_TIMEOUT');
    };
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      // Keep this timer referenced: even a storage promise that never settles
      // must terminate the request, and Node must not exit before that result.
      timer = setTimeout(() => {
        const failure = Error('EVALUATION_TIMEOUT');
        controller.abort(failure);
        reject(failure);
      }, deadlineMs);
    });
    const work = async () => {
      guardDeadline();
      if (!owner) throw Error('AUTHENTICATION_REQUIRED');
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['nextToken','finalGameOffset'].includes(key))) throw Error('INVALID_EVALUATION_REQUEST');
      const initial = (body as {nextToken?: unknown}).nextToken;
      const finalGameOffset = (body as {finalGameOffset?: unknown}).finalGameOffset ?? 0;
      if (typeof finalGameOffset !== 'number' || !Number.isSafeInteger(finalGameOffset) || finalGameOffset < 0 || finalGameOffset >= 200)
        throw Error('INVALID_EVALUATION_REQUEST');
      if (initial !== undefined && (typeof initial !== 'string' || initial.length === 0 || initial.length > 3000))
        throw Error('INVALID_HISTORY_TOKEN');
      const frozen = await receivingForwardProtocol();
      guardDeadline();
      const receipts: ForwardReceipt[] = [];
      const seen = new Set<string>();
      let token = initial as string | undefined;
      let nextToken: string | null = null;
      let pagesRead = 0;
      for (; pagesRead < 20;) {
        guardDeadline();
        if (token !== undefined && seen.has(token)) throw Error('HISTORY_PAGINATION_CYCLE');
        if (token !== undefined) seen.add(token);
        // History verifies every receipt before it is eligible for evaluation.
        const page = await readPage(owner, token);
        guardDeadline();
        if (page.owner !== owner || page.protocolSha256 !== frozen.protocolSha256
          || page.bettingDecision !== 'HOLD' || page.liveApproved !== false || page.executionEnabled !== false
          || !Array.isArray(page.items) || page.items.length > 10
          || page.items.some(row => row.owner !== owner)
          || !(page.nextToken === null || typeof page.nextToken === 'string' && page.nextToken.length > 0 && page.nextToken.length <= 3000))
          throw Error('HISTORY_RESPONSE_UNVERIFIED');
        receipts.push(...page.items);
        pagesRead++;
        nextToken = page.nextToken;
        if (nextToken === null) break;
        token = nextToken;
      }
      guardDeadline();
      const { outcomes, source } = await loadOutcomes(receipts, finalGameOffset, controller.signal);
      guardDeadline();
      const result = await evaluateReceivingForward({
        owner, receipts, outcomes, source,
        cohortComplete:initial === undefined && nextToken === null,
      });
      guardDeadline();
      return { ...result, historyRange:{
        startsAtBeginning:initial === undefined, startToken:initial ?? null,
        pagesRead, maximumRecords:200, nextToken,
        maximumFinalGameChecks:8,
      } };
    };
    try {
      return await Promise.race([work(), timeout]);
    } finally {
      clearTimeout(timer!);
    }
  };
}

export const receivingForwardEvaluation = createReceivingForwardEvaluation();
