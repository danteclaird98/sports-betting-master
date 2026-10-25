import { db } from '../../../runtime/sdk.ts';
import { randomUUID } from 'node:crypto';
import type { LiveQuote } from './liveTypes';

const tableFor = (userId:string) => {
  if(!userId||userId.length>48)throw Error('Authenticated quote owner is required.');
  return 'live_quotes_'+Array.from(userId).map(char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
};
const snapshotTableFor = (userId:string) => {
  tableFor(userId); // Preserve the existing authenticated-owner validation.
  return 'live_quote_snapshots_'+Buffer.from(userId,'utf8').toString('hex');
};
type Index = {owner:string;eventId:string;version:string;chunks:string[];captureId?:string;kind?:string};
type Pointer = {owner:string;eventId:string;version:string;captureId?:string;kind?:string;chunks?:string[]};
type Chunk = {owner:string;eventId:string;version:string;captureId?:string;kind?:string;quotes:LiveQuote[]};
const validCapture = (value:string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function validateScope(eventId:string,kind:string) {
  if(!/^\d{6,12}$/.test(eventId)||!['periods','props'].includes(kind))throw Error('Invalid quote snapshot identity.');
}
export async function saveLiveSnapshot(userId:string,eventId:string,kind:string,quotes:LiveQuote[]) {
  validateScope(eventId,kind);
  const table=tableFor(userId),archive=snapshotTableFor(userId),prefix=eventId+'_'+kind;
  // Each invocation represents a new capture, even for identical observations.
  // Unknown write outcomes must be reconciled, never retried as a new capture.
  const version=new Date().toISOString(),captureId=randomUUID(),capturePrefix=prefix+'_'+captureId;
  const groups:LiveQuote[][]=[];
  let group:LiveQuote[]=[];
  let bytes=0;
  for(const quote of quotes) {
    if(quote.eventId!==eventId)throw Error('Quote belongs to another event.');
    const size=new TextEncoder().encode(JSON.stringify(quote)).length;
    if(size>180_000)throw Error('Individual quote exceeds archive limit.');
    if(bytes+size>180_000&&group.length){groups.push(group);group=[];bytes=0;}
    group.push(quote);bytes+=size;
  }
  if(group.length)groups.push(group);
  if(groups.length>12)throw Error('Quote snapshot exceeds the bounded archive limit.');
  const chunks=groups.map((_,i)=>capturePrefix+'_part_'+i);
  const items:Array<{id:string;record:Record<string,unknown>}>=groups.map((quotes,i)=>({id:chunks[i],record:{owner:userId,eventId,kind,version,captureId,quotes}}));
  items.push({id:capturePrefix+'_index',record:{owner:userId,eventId,kind,version,captureId,chunks}});
  // Evidence inserts and the separate mutable latest pointer commit atomically.
  // Existing legacy chunks are never rewritten or removed.
  const result=await db.transact([
    db.tx.insert(archive,items),
    db.tx.update(table,[{id:prefix+'_index',record:{owner:userId,eventId,kind,version,captureId}}])
  ]);
  if(result.some(group=>group.some(value=>!value)))throw Error('Quote snapshot was not fully saved.');
  return {stored:true,version,captureId,quoteCount:quotes.length};
}
async function readChunks(table:string,index:Index,userId:string,eventId:string,kind:string,captureId?:string) {
  if(index.owner!==userId||index.eventId!==eventId||!Array.isArray(index.chunks)||index.chunks.length>12||
    (captureId&&(index.captureId!==captureId||index.kind!==kind)))throw Error('Quote archive ownership or scope mismatch.');
  const prefix=eventId+'_'+kind+(captureId?'_'+captureId:'');
  if(index.chunks.some((id,i)=>id!==prefix+'_part_'+i))throw Error('Quote archive chunk identity mismatch.');
  const chunks=await db.get<Chunk>(table,index.chunks,{consistent:true});
  const out:LiveQuote[]=[];
  for(const chunk of chunks) {
    if(!chunk||chunk.owner!==userId||chunk.eventId!==eventId||chunk.version!==index.version||
      (captureId&&(chunk.captureId!==captureId||chunk.kind!==kind))||!Array.isArray(chunk.quotes)||
      chunk.quotes.some(quote=>!quote||quote.eventId!==eventId||typeof quote.id!=='string'))throw Error('Quote snapshot changed or was incomplete; refresh instead of using mixed observations.');
    out.push(...chunk.quotes);
  }
  return out;
}
// A capture receipt remains readable after a later capture replaces the pointer.
export async function readLiveSnapshotCapture(userId:string,eventId:string,kind:string,captureId:string) {
  validateScope(eventId,kind);
  if(!validCapture(captureId))throw Error('Invalid quote capture identity.');
  const table=snapshotTableFor(userId),id=eventId+'_'+kind+'_'+captureId+'_index';
  const [index]=await db.get<Index>(table,[id],{consistent:true});
  if(!index)throw Error('Quote capture was not found.');
  return {version:index.version,quotes:await readChunks(table,index,userId,eventId,kind,captureId)};
}
export async function readLiveSnapshots(userId:string,eventId:string) {
  if(!/^\d{6,12}$/.test(eventId))throw Error('Invalid event identity.');
  const table=tableFor(userId),ids=['periods','props'].map(kind=>eventId+'_'+kind+'_index');
  const indices=await db.get<Pointer>(table,ids,{consistent:true});
  const out:LiveQuote[]=[];
  for(let i=0;i<indices.length;i++) {
    const index=indices[i],kind=['periods','props'][i];
    if(!index)continue;
    if(index.owner!==userId||index.eventId!==eventId)throw Error('Quote archive ownership or scope mismatch.');
    if(index.captureId!==undefined) {
      const capture=await readLiveSnapshotCapture(userId,eventId,kind,index.captureId);
      if(index.kind!==kind||capture.version!==index.version)throw Error('Quote archive pointer mismatch.');
      out.push(...capture.quotes);
    } else {
      // Read legacy archives without moving or modifying their evidence.
      out.push(...await readChunks(table,index as Index,userId,eventId,kind));
    }
  }
  return [...new Map(out.map(quote=>[quote.id,quote])).values()];
}
