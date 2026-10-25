/** EdgeFusion runtime. No AppDeploy network, storage or identity dependency. */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let connection: DatabaseSync;
function storage() {
  if (!connection) {
    const path = process.env.EDGEBOARD_DB || 'data/edgeboard.sqlite3';
    mkdirSync(dirname(path), {recursive:true});
    connection = new DatabaseSync(path);
    connection.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS records (seq INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(collection,id))');
  }
  return connection;
}
function records(table:string, ids:string[]) {
  const query=storage().prepare('SELECT id,body FROM records WHERE collection=? AND id=?');
  return ids.map(id=>{const r=query.get(table,id) as {id:string;body:string}|undefined;return r?{...JSON.parse(r.body),id:r.id}:null;});
}
function update(table:string, items:Array<{id:string;record:unknown}>) {
  // Upsert is required by the immutable-ID snapshot contract used by EdgeBoard.
  const query=storage().prepare('INSERT INTO records(collection,id,body) VALUES (?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body');
  return items.map(item=>{query.run(table,item.id,JSON.stringify(item.record));return true;});
}
export const db = {
  async add(table:string, items:unknown[]) {
    const query=storage().prepare('INSERT INTO records(collection,id,body) VALUES (?,?,?)');
    return items.map(item=>{const id=randomUUID();query.run(table,id,JSON.stringify(item));return id;});
  },
  async get<T>(table:string, ids:string[], _options?:unknown):Promise<Array<(T & {id:string})|null>> {return records(table,ids) as any;},
  async update(table:string, items:Array<{id:string;record:unknown}>) {return update(table,items);},
  async delete(table:string, ids:string[]) {
    const query=storage().prepare('DELETE FROM records WHERE collection=? AND id=?');
    return ids.map(id=>Number(query.run(table,id).changes)>0);
  },
  async list<T>(table:string, options:{limit?:number;nextToken?:string}={}) {
    const limit=Math.min(1000,Math.max(1,Math.trunc(options.limit||100)));
    const after=options.nextToken?Number(options.nextToken):0;
    if(!Number.isSafeInteger(after)||after<0)throw Error('Invalid pagination token');
    const rows=storage().prepare('SELECT seq,id,body FROM records WHERE collection=? AND seq>? ORDER BY seq LIMIT ?').all(table,after,limit+1) as Array<{seq:number;id:string;body:string}>;
    return {items:rows.slice(0,limit).map(r=>({...JSON.parse(r.body),id:r.id})) as Array<T & {id:string}>,nextToken:rows.length>limit?String(rows[limit-1].seq):null};
  },
  tx: {update:(table:string,items:Array<{id:string;record:unknown}>)=>({table,items})},
  async transact(operations:Array<{table:string;items:Array<{id:string;record:unknown}>}>) {
    const database=storage();database.exec('BEGIN IMMEDIATE');
    try {const result=operations.map(op=>update(op.table,op.items));database.exec('COMMIT');return result;}
    catch(error){database.exec('ROLLBACK');throw error;}
  }
};
const allowedSecrets=['PARLAY_API_KEY','CLEARSPORTS_API_KEY','PUCKAPI_API_KEY','SHARPAPI_KEY','THE_ODDS_API_KEY','SPORTSGAMEODDS_KEY','ODDS_API_KEY','ODDS_BACKEND_URL','ODDS_BACKEND_READ_TOKEN'];
export const secrets={
  async listSecretNames(){return allowedSecrets.filter(name=>Boolean(process.env[name]));},
  async readSecret(name:string){if(!allowedSecrets.includes(name)||!process.env[name])throw Error('Provider credential not configured');return process.env[name]!;}
};
export const auth={async getUser(event:any){return event?.user||null;}};
export function json(data:unknown,status=200){return {status,data};}
export function error(message:string,status=500){return {status,data:{error:message}};}
export function requireAuth(){return (ctx:any)=>ctx.user?undefined:error('Authentication required',401);}
export function router(routes:Record<string,Array<(ctx:any)=>any>>){
  return async (request:{method:string;path:string;query:Record<string,string>;body?:unknown;user?:unknown})=>{
    let handlers=routes[request.method+' '+request.path];
    const params:Record<string,string>={};
    if(!handlers){
      const actual=request.path.split('/');
      for(const [pattern,candidate] of Object.entries(routes)){
        const [method,path]=pattern.split(' ');
        if(method!==request.method || !path.includes('/:'))continue;
        const parts=path.split('/');
        if(parts.length!==actual.length || parts.some((part,i)=>!part.startsWith(':')&&part!==actual[i]))continue;
        for(let i=0;i<parts.length;i++){
          if(!parts[i].startsWith(':'))continue;
          let value:string;
          try{value=decodeURIComponent(actual[i]);}catch{return error('Invalid path parameter',400);}
          if(!value || value.includes('/') || value.includes('\0'))return error('Invalid path parameter',400);
          params[parts[i].slice(1)]=value;
        }
        handlers=candidate;
        break;
      }
    }
    if(!handlers)return error('Not found',404);
    const ctx={...request,params,event:{user:request.user}};
    for(const handler of handlers){const response=await handler(ctx);if(response!==undefined)return response;}
    return json(null,204);
  };
}
