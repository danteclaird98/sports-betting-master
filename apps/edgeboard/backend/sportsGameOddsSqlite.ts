/** Local durable implementation for the imported provider's conditional transactions.
 * Uses a dedicated table in the existing research DB; never changes other ledgers.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSgoStore, type SgoDatabase } from './sportsGameOddsStore.ts';
class StoreError extends Error { code:string; constructor(code:string){super(code);this.code=code;} }
export async function createLocalSgoStore(owner:string,path=process.env.EDGEBOARD_DB || 'data/edgeboard.sqlite3') {
 if(!owner || owner.length>200)throw Error('INVALID_OWNER');
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const sql=new DatabaseSync(path); sql.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS sgo_records(collection TEXT,id TEXT,body TEXT,PRIMARY KEY(collection,id));');
 const key=createHash('sha256').update(owner).digest('hex').slice(0,32);
 const allowed=(table:string)=>{if(!(table===`sgo_gate_${key}` || table.startsWith(`sgo_${key}_`)))throw Error('OWNER_SCOPE_MISMATCH');};
 const get=(table:string,id:string)=>{allowed(table);const row=sql.prepare('SELECT body FROM sgo_records WHERE collection=? AND id=?').get(table,id) as any;return row?JSON.parse(row.body):null;};
 const api={
  async get(table:string,ids:string[]){return ids.map(id=>get(table,id));},
  async list(table:string,opts:any={}){allowed(table);let before=Number.MAX_SAFE_INTEGER;if(opts.nextToken){let cursor;try{cursor=JSON.parse(Buffer.from(opts.nextToken,'base64url').toString());}catch{throw Error('INVALID_HISTORY_TOKEN');}if(cursor.table!==table || !Number.isSafeInteger(cursor.before) || cursor.before<1)throw Error('INVALID_HISTORY_TOKEN');before=cursor.before;}const limit=Math.min(100,Math.max(1,opts.limit||3));const rows=sql.prepare('SELECT rowid,id,body FROM sgo_records WHERE collection=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(table,before,limit+1) as any[];const page=rows.slice(0,limit);return {items:page.map(r=>({...JSON.parse(r.body),id:r.id})),nextToken:rows.length>limit?Buffer.from(JSON.stringify({table,before:Number(page.at(-1).rowid)})).toString('base64url'):null};},
  tx:{add:(table:string,items:any[])=>({kind:'add',table,items}),update:(table:string,items:any[],opts:any={})=>({kind:'update',table,items,opts})},
  async transact(ops:any[]){sql.exec('BEGIN IMMEDIATE');try{const targets=new Set();const result=ops.map(op=>{allowed(op.table);return op.items.map((item:any)=>{const id=op.kind==='add'?item.id:item.id;if(typeof id!=='string'||!id)throw Error('INVALID_RECORD_ID');const target=JSON.stringify([op.table,id]);if(targets.has(target))throw Error('DUPLICATE_TRANSACTION_TARGET');targets.add(target);const old=get(op.table,id);if(op.kind==='add'&&old)throw new StoreError('AppDatabaseDuplicateId');if(op.kind==='update'&&((op.opts.patch&&!old)||Object.entries(item.if||{}).some(([k,v])=>JSON.stringify(old?.[k])!==JSON.stringify(v))))throw new StoreError('AppDatabaseConditionFailed');const record=op.kind==='add'?item:op.opts.patch?{...old,...item.record}:item.record;sql.prepare('INSERT INTO sgo_records VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body').run(op.table,id,JSON.stringify(record));return op.kind==='add'?id:true;});});sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}
 };
 const store=await createSgoStore(owner,api as unknown as SgoDatabase,(error:unknown):error is StoreError=>error instanceof StoreError);
 // The facade closes this per-request connection in a finally block.
 return {...store,close:()=>sql.close()};
}
