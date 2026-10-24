import { db } from '@appdeploy/sdk';
type Receipt = { ticketId: string; event: string; selectionSignature: string; jurisdiction: string; 
  acceptedAmerican: number; acceptedStake: number; acceptedAt: string;
  offeredAmerican: number|null; offeredAt: string|null; sourceClaim: string; note: string;
  capturedAt: string; providerAuthenticated: false; ownerUserId: string };
function table(userId: string) {
  // Stable SDK-safe table name. Never concatenate arbitrary user IDs into identifiers.
  let a = 2166136261, b = 4100225161;
  for (let i = 0; i < userId.length; i++) {
    const c = userId.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
  }
  return 'caesars_execution_' + a.toString(16).padStart(8,'0') + '_' + b.toString(16).padStart(8,'0');
}
const time = (raw: unknown, required: boolean) => {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw Error('Accepted timestamp is required.');
    return null;
  }
  if (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw)) || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(raw)) throw Error('Timestamp must be ISO 8601 with timezone.');
  return raw;
};
export async function listExecutionEvidence(userId: string) {
  const result = await db.list<Receipt>(table(userId),{limit:100});
  return { entries: result.items.filter(r=>r.ownerUserId===userId).map(({ownerUserId, ...r})=>({id:r.id,...r})), authenticated:true, note:'User-reported receipts only; provider entitlement and actual fills not independently verified.' };
}
export async function saveExecutionEvidence(userId: string, input: unknown) {
  const v=input as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.receiptConfirmed !== true) throw Error('Confirm values come from an accepted Caesars ticket.');
  for(const name of ['ticketId','event','selectionSignature','jurisdiction']) {
    if (typeof v[name] !== 'string' || !(v[name] as string).trim() || (v[name] as string).length > 240) throw Error(name+' is required (up to 240 characters).');
  }
  const acceptedAmerican=Number(v.acceptedAmerican), acceptedStake=Number(v.acceptedStake);
  if (!Number.isFinite(acceptedAmerican) || Math.abs(acceptedAmerican)<100 || !Number.isFinite(acceptedStake) || acceptedStake<=0 || acceptedStake>500000) throw Error('Invalid accepted odds or stake.');
  const offeredAmerican=(v.offeredAmerican === undefined||v.offeredAmerican === null||v.offeredAmerican === '') ? null:Number(v.offeredAmerican);
  if(offeredAmerican !== null && (!Number.isFinite(offeredAmerican)||Math.abs(offeredAmerican)<100)) throw Error('Invalid offered odds.');
  const acceptedAt=time(v.acceptedAt,true)!;
  const offeredAt=time(v.offeredAt,false);
  if (Date.parse(acceptedAt) > Date.now() + 300000) throw Error('Accepted time cannot be in the future.');
  if (offeredAmerican !== null && !offeredAt) throw Error('Offer time is required when offered odds are supplied.');
  if (offeredAt && Date.parse(offeredAt) > Date.parse(acceptedAt)) throw Error('Offer time must precede acceptance.');
  const note=typeof v.note==='string'?v.note.slice(0,800):'';
  const items=await db.list<Receipt>(table(userId),{limit:100});
  if (items.items.some(item => item.ownerUserId===userId && item.ticketId===v.ticketId && item.selectionSignature===v.selectionSignature)) throw Error('That ticket and selection are already recorded.');
  const record:Receipt={ticketId:String(v.ticketId).trim(),event:String(v.event).trim(),
    selectionSignature:String(v.selectionSignature).trim(),jurisdiction:String(v.jurisdiction).trim(),
    acceptedAmerican,acceptedStake,acceptedAt,
    offeredAmerican,offeredAt,sourceClaim:'USER_ENTERED_ACCEPTED_TICKET',
    note,capturedAt:new Date().toISOString(),providerAuthenticated:false,ownerUserId:userId};
  const [id]=await db.add(table(userId),[record]);
  if(!id) throw Error('Receipt archive failed.');
  return {recordId:id, status:'RECORDED_USER_CLAIM',providerAuthenticated:false,acceptedAmerican,acceptedStake,
    message:'User-confirmed receipt logged. This does not establish independent Caesars execution verification.'};
}
