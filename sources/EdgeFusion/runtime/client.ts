/** Same-origin client for the self-hosted EdgeBoard workspace. */
async function request(method:string,path:string,body?:unknown){
  if(!path.startsWith('/api/'))throw Error('Unsupported API path');
  const response=await fetch('/edgeboard-api/'+path.slice(5),{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});
  if(response.status===401){location.assign('/login');throw Error('Please sign in');}
  const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return {data};
}
export const api={get:(path:string)=>request('GET',path),post:(path:string,body?:unknown)=>request('POST',path,body)};
export const auth={
  isSignedIn:()=>true,
  async getUser(){const response=await fetch('/session');if(!response.ok)return null;return (await response.json()).user;},
  async signIn(){const user=await this.getUser();if(!user)location.assign('/login');return {user};},
  async signOut(){await fetch('/logout',{method:'POST'});location.assign('/login');}
};
