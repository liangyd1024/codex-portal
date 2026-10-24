// Only loaded by the isolated parity server; no real pairing, setup or clipboard writes.
(()=>{
 const f=window.rcmFixture,mode=new URL(location.href).searchParams.get('mobileCase')||'empty';
 if(mode==='configured')f.origins=['https://192.0.2.1:4319'];
 if(mode==='phone')f.local=false;
 let copyFails=false,previousCode=null;const copies=[];
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(text){copies.push(text);if(copyFails)throw Error('fixture clipboard failure');}}});
 const previous=window.fetch;
 window.fetch=async(url,options={})=>{
  const response=await previous(url,options),p=new URL(typeof url==='string'?url:url.url,location.href).pathname;
  if(!response.ok||!['/api/access/status','/api/access/code'].includes(p))return response;
  const data=await response.json();
  if(p==='/api/access/status'){data.canSetup=mode!=='unavailable'&&f.local;if(mode==='phone')data.sessionExpires=null;}
  else if(data.expires!==null)data.expires=1893456000000;
  return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 };
 addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('details');panel.setAttribute('aria-label','手机设置验收控制');panel.style.cssText='position:fixed;top:110px;right:4px;z-index:100001;max-height:40vh;overflow:auto;background:white;color:black;border:1px solid black;padding:4px;font:14px sans-serif';
  const summary=document.createElement('summary');summary.textContent='手机设置验收控制';panel.append(summary);
  const output=document.createElement('pre');output.setAttribute('aria-label','手机设置验收记录');output.style.cssText='white-space:pre-wrap;max-width:280px';
  const button=(text,run)=>{const b=document.createElement('button');b.textContent=text;b.style.cssText='display:block;min-height:44px';b.onclick=()=>{run();panel.open=false;};panel.append(b);};
  for(const [name,path] of [['读取','status'],['配置','setup'],['生成','code'],['撤销','revoke'],['退出','logout']])button('下次'+name+'失败',()=>{f.fail={path:'/api/access/'+path,status:503,message:'模拟'+name+'失败'};});
  button('下次复制失败',()=>{copyFails=true;});button('恢复复制',()=>{copyFails=false;});
  button('延迟配对码响应',()=>{f.delay={path:'/api/access/code',ignoreAbort:true};});
  button('释放配对码响应',()=>{if(f.pending?.path!=='/api/access/code')throw Error('No delayed code');f.pending.resolve();f.pending=null;});
  button('记住当前配对码节点',()=>{previousCode=document.querySelector('.pair-code');});
  button('读取手机验收记录',()=>{output.textContent=JSON.stringify({codeNodeReplaced:previousCode?previousCode!==document.querySelector('.pair-code'):null,calls:f.calls.filter(c=>c.path.startsWith('/api/access/')),copies,errors:f.errors},null,2);});
  panel.append(output);document.body.append(panel);
 });
})();
