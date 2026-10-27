export interface NavigationObservation {
 host:string|null;stage:string;threadId?:string;clickId?:string;testId?:string;
 selectedId:string|null;visibility:string;version:string;observedAt:number;
 instanceId?:string;id?:string;script?:string;scope?:string;endpointHash?:string;windows?:number;mode?:string;error?:string;
}
// Capture the event's context at enqueue time, not the context of a later flush.
// No timer/polling: startup, new observations and lifecycle recovery trigger flush.
export function createNotificationTraceQueue({ready,send}:{ready:()=>boolean;send:(entry:NavigationObservation)=>Promise<unknown>}){
 const pending:Readonly<NavigationObservation>[]=[];
 let running:Promise<void>|undefined;
 function flush():Promise<void>{
  if(running)return running;
  if(!ready()||!pending.length)return Promise.resolve();
  let failed=false;
  running=Promise.resolve().then(async()=>{
   while(ready()&&pending.length){
    const entry=pending[0];
    // An unknown early host must not be attributed to a later selected host.
    if(!entry.host){pending.shift();continue;}
    try{await send(entry);}catch(error){
     const status=(error as {status?:number}|null)?.status;
     // Only explicit bad input/missing connection is terminal. Offline, auth and
     // server failures remain retryable on the next real lifecycle event.
     if(status!==400&&status!==404){failed=true;return;}
    }
    const index=pending.indexOf(entry);if(index!==-1)pending.splice(index,1);
   }
  }).finally(()=>{running=undefined;if(!failed&&ready()&&pending.length)void flush();});
  return running;
 }
 function report(entry:NavigationObservation){pending.push(Object.freeze({...entry}));if(pending.length>32)pending.splice(0,pending.length-32);void flush();}
 return {report,flush};
}

// Native iOS subscription lookups can hang independently of the HTTP timeout.
// Share one outstanding sample; expiry does not spawn more hanging native calls.
export function createNotificationTraceSender({lookupEndpoint,api,lookupTimeout=350}:{
 lookupEndpoint:()=>Promise<string|undefined>;
 api:(path:string,options:{method:string;timeout:number;body:unknown})=>Promise<unknown>;
 lookupTimeout?:number;
}){
 let lookup:Promise<string|undefined>|undefined;
 async function sample(){
  lookup??=Promise.resolve().then(lookupEndpoint).catch(()=>undefined).finally(()=>{lookup=undefined;});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([lookup,new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),lookupTimeout);})]);}
  finally{clearTimeout(timer);}
 }
 return async(entry:NavigationObservation)=>{
  const endpoint=entry.instanceId||entry.endpointHash?undefined:await sample();
  return api('/api/push/trace?host='+encodeURIComponent(entry.host!),{method:'POST',timeout:5000,body:{...entry,...(endpoint?{endpoint}:{})}});
 };
}
