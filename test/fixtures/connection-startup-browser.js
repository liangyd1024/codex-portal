// Isolated startup responses only; never installed in production assets.
(() => {
 const f=window.rcmFixture;if(!f)throw Error('Connection startup requires the isolated fixture');
 const mode=new URL(location.href).searchParams.get('connectionCase')||'linked';
 if(!['linked','saved','fallback','storage-blocked','http-failed','json-failed','network-failed'].includes(mode))throw Error('Unknown connection startup case');
 localStorage.setItem('rcm.connection',mode==='fallback'?'removed':'qa-alt');
 if(mode==='storage-blocked'){const original=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(this===localStorage&&key==='rcm.connection')throw new DOMException('blocked','SecurityError');return original.call(this,key);};}
 const recoveryKey='rcm.fixture.connectionRecovery.'+mode+'.'+new URL(location.href).searchParams.get('run');
 const previous=window.fetch;f.connectionStartup={reads:0,recovered:sessionStorage.getItem(recoveryKey)==='1',recover(){this.recovered=true;sessionStorage.setItem(recoveryKey,'1');}};
 window.fetch=async(url,options={})=>{
  const path=new URL(typeof url==='string'?url:url.url,location.href).pathname;
  if(path!=='/api/connections')return previous(url,options);
  const response=await previous(url,options);f.connectionStartup.reads++;
  if(!f.connectionStartup.recovered){
   if(mode==='network-failed')throw new TypeError('模拟网络不可用');
   if(mode==='http-failed')return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});
   if(mode==='json-failed')return new Response('invalid',{headers:{'Content-Type':'application/json'}});
  }
  const data=await response.json();data.data.push({...data.data[0],id:'qa-alt',host:{...data.data[0].host,alias:'另一验收目标'}});data.future={raw:'保持未知字段'};
  return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
 };
})();
