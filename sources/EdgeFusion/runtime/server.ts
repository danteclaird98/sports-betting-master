import http from 'node:http';
import oddsConversion from '../integrations/alexbet/odds-conversion.cjs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { handler as edgeboard } from '../apps/edgeboard/backend/index.ts';

const root=resolve(process.cwd());
const port=Number(process.env.PORT||3000);
const host=process.env.HOST||'127.0.0.1';
const hosted=!['localhost','127.0.0.1','::1'].includes(host);
const password=process.env.WORKSPACE_PASSWORD||'';
const username=process.env.WORKSPACE_USER||'owner';
const secret=process.env.WORKSPACE_SESSION_SECRET||randomBytes(32).toString('hex');
const secure=Boolean(process.env.RENDER_EXTERNAL_HOSTNAME)||process.env.COOKIE_SECURE==='true';
if(hosted&&password.length<16)throw Error('Set WORKSPACE_PASSWORD to at least 16 characters before hosting.');
const internalPort=Number(process.env.FUSION_INTERNAL_PORT||8788);
const child=spawn('python3',['app.py','--port',String(internalPort),'--db',process.env.EDGEFUSION_DB||'data/edgefusion.sqlite3'],{cwd:root,stdio:['ignore','inherit','inherit']});
child.on('error',()=>{console.error('Could not start Python backend');process.exit(1);});
child.on('exit',()=>{if(!closing){console.error('Python backend stopped');process.exit(1);}});
let closing=false;
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function signature(value:string){return createHmac('sha256',secret).update(value).digest('base64url');}
function session(cookie:string|undefined){
  if(!password&&!hosted)return {userId:'owner',name:'Local owner'};
  const raw=(cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('edgefusion_session='))?.slice(19);
  if(!raw)return null;
  const [value,sig]=raw.split('.');
  if(!value||!sig||!equal(signature(value),sig))return null;
  try{const data=JSON.parse(Buffer.from(value,'base64url').toString());if(data.user!==username||!Number.isFinite(data.exp)||data.exp<Date.now())return null;return {userId:'owner',name:username};}catch{return null;}
}
function send(res:http.ServerResponse,status:number,body:string|Buffer,type='application/json'){
  res.writeHead(status,{'Content-Type':type,'Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(body);
}
function json(res:http.ServerResponse,status:number,data:unknown){send(res,status,JSON.stringify(data));}
async function readBody(req:http.IncomingMessage){
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>4000000)throw Error('Request too large');chunks.push(chunk);}
  return Buffer.concat(chunks).toString();
}
const failures=new Map<string,{count:number;until:number}>();
const login=await readFile(resolve(root,'web/login.html'));
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,...(process.env.RENDER_EXTERNAL_HOSTNAME?[process.env.RENDER_EXTERNAL_HOSTNAME]:[]),...(process.env.ALLOWED_HOSTS||'').split(',').filter(Boolean)]);
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
  req.setTimeout(30000);
  try{
    if(!allowedHosts.has(req.headers.host||''))return json(res,403,{error:'Invalid host'});
    const url=new URL(req.url||'/',`http://${req.headers.host}`);
    if(url.pathname==='/health'){
      try{const r=await fetch(`http://127.0.0.1:${internalPort}/health`,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error();return json(res,200,{status:'ok',runtime:'self-hosted'});}catch{return json(res,503,{status:'starting'});}
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){
      const origin=req.headers.origin;
      if(origin&&origin!==`${secure?'https':'http'}://${req.headers.host}`)return json(res,403,{error:'Invalid origin'});
      if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Invalid origin'});
    }
    if(url.pathname==='/login'&&req.method==='GET')return send(res,200,login,'text/html; charset=utf-8');
    if(url.pathname==='/login'&&req.method==='POST'){
      // The socket address is trusted; arbitrary forwarded headers never reset the throttle.
      const key=req.socket.remoteAddress||'unknown',now=Date.now(),previous=failures.get(key);
      if(previous&&previous.until>now&&previous.count>=10)return json(res,429,{error:'Too many attempts; try in 15 minutes'});
      const body=new URLSearchParams(await readBody(req));
      if(!password||!equal(body.get('username')||'',username)||!equal(body.get('password')||'',password)){
        if(failures.size>10000)for(const [k,v] of failures)if(v.until<now)failures.delete(k);
        failures.set(key,{count:previous&&previous.until>now?previous.count+1:1,until:now+900000});
        return send(res,401,'Sign-in failed. Return to /login and try again.','text/plain');
      }
      failures.delete(key);
      const value=Buffer.from(JSON.stringify({user:username,exp:now+43200000})).toString('base64url');
      res.writeHead(303,{Location:'/', 'Set-Cookie':`edgefusion_session=${value}.${signature(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`});return res.end();
    }
    const user=session(req.headers.cookie);
    if(!user){if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/edgeboard-api/')||url.pathname==='/session')return json(res,401,{error:'Sign in required'});res.writeHead(303,{Location:'/login'});return res.end();}
    if(url.pathname==='/session')return json(res,200,{user});
    if(url.pathname==='/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',`edgefusion_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`);return json(res,200,{signedOut:true});}
    if(url.pathname==='/tools/odds'){
      const n=Number(url.searchParams.get('american'));
      if(!Number.isFinite(n)||Math.abs(n)<100)return json(res,400,{error:'American odds must be at least +100 or at most -100'});
      return json(res,200,{decimal:oddsConversion.americanToDecimal(n),implied:oddsConversion.americanToImpliedProb(n),source:'alexbet-sharp-bot'});
    }
    if(url.pathname.startsWith('/edgeboard-api/')){
      if(!['GET','POST'].includes(req.method||''))return json(res,405,{error:'Method not allowed'});
      let body:unknown;
      if(req.method==='POST'){
        if(req.headers['content-type']!=='application/json')return json(res,415,{error:'JSON required'});
        try{body=JSON.parse(await readBody(req));}catch{return json(res,400,{error:'Invalid JSON'});}
      }
      const result=await edgeboard({method:req.method!,path:'/api/'+url.pathname.slice('/edgeboard-api/'.length),query:Object.fromEntries(url.searchParams),body,user});
      return json(res,result.status,result.data);
    }
    if(url.pathname.startsWith('/api/')||url.pathname==='/example.json'){
      const body=req.method==='POST'?await readBody(req):undefined;
      const response=await fetch(`http://127.0.0.1:${internalPort}${url.pathname}${url.search}`,{method:req.method,headers:body===undefined?{}:{'Content-Type':req.headers['content-type']||''},body,signal:AbortSignal.timeout(30000)});
      return send(res,response.status,Buffer.from(await response.arrayBuffer()),response.headers.get('content-type')||'application/json');
    }
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
    let base:string,relative:string;
    if(url.pathname==='/edgeboard'){res.writeHead(303,{Location:'/edgeboard/'});return res.end();}
    if(url.pathname.startsWith('/edgeboard/')){base=resolve(root,'dist/edgeboard');relative=decodeURIComponent(url.pathname.slice('/edgeboard/'.length))||'index.html';}
    else {base=resolve(root,'web');relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));}
    const file=resolve(base,relative);
    if(!file.startsWith(base+'/'))return json(res,404,{error:'Not found'});
    try{if(!(await stat(file)).isFile())throw Error();return send(res,200,await readFile(file),mime[extname(file)]||'application/octet-stream');}catch{return json(res,404,{error:'Not found'});}
  }catch{json(res,500,{error:'Request failed; check server configuration and provider availability'});}
});
server.headersTimeout=15000;server.requestTimeout=30000;
server.listen(port,host,()=>console.log(`EdgeFusion listening on ${host}:${port}; EdgeBoard at /edgeboard/`));
function shutdown(){closing=true;server.close();child.kill('SIGTERM');}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
