// Synthetic account responses for isolated browser parity; no real identity reads.
(() => {
 const f=window.rcmFixture;
 if(!f)throw Error('Account fixture requires isolated API interception.');
 const state=new URL(location.href).searchParams.get('accountState')||'normal';
 const states={
  normal:{visible:true,account:{type:'chatgpt',email:'tester@example.test'},rateLimits:{primary:{usedPercent:25,windowDurationMins:300},secondary:{usedPercent:60,windowDurationMins:10080}}},
  apiKey:{visible:false,account:{type:'apiKey'}},
  boundary:{visible:true,account:{type:'chatgpt',email:'tester@example.test'},rateLimits:{primary:{usedPercent:-20,windowDurationMins:300,resetsAt:1700000000},secondary:{usedPercent:140,windowDurationMins:10080,resetsAt:1700604800}}},
  expired:{visible:false,recovery:'请在目标机器重新登录，再重新加载登录。'},
  signedOut:{visible:false,signedOut:true,recovery:'请在目标机器完成登录。'},
 };
 if(state==='failure'){
  const fetch=window.fetch;
  window.fetch=(input,options={})=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(url.pathname!=='/api/account/usage')return fetch(input,options);
   f.calls.push({path:url.pathname,query:url.search,method:options.method||'GET',body:{}});
   return Promise.resolve(new Response(JSON.stringify({error:{message:'模拟用量服务不可用。'}}),{status:503,headers:{'Content-Type':'application/json'}}));
  };
 }
 else if(Object.hasOwn(states,state))f.accountUsage=states[state];
 else throw Error('Unknown isolated account state');
 if(new URLSearchParams(location.search).get('accountDynamic')!=='1')return;
 const fetchFixture=window.fetch;let holdNext=false,release;
 window.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.pathname!=='/api/account/usage'||!holdNext)return fetchFixture(input,options);
  holdNext=false;const old=JSON.stringify(f.accountUsage);
  f.calls.push({path:url.pathname,query:url.search,method:options.method||'GET',body:{}});
  return new Promise(resolve=>{release=()=>{release=null;resolve(new Response(old,{headers:{'Content-Type':'application/json'}}));};});
 };
 addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('details');panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;border:1px solid black;max-height:65vh;overflow:auto;max-width:320px';
  const summary=document.createElement('summary');summary.textContent='账号切换验收';panel.append(summary);
  const out=document.createElement('pre');out.setAttribute('aria-label','账号检查记录');out.style.whiteSpace='pre-wrap';
  const change=key=>{f.accountUsage=states[key];f.emit('account/updated',{});};
  const actions=[
   ['挂起旧账号响应',()=>{holdNext=true;f.emit('account/updated',{});}],
   ['切换到 API Key',()=>change('apiKey')],['释放旧账号响应',()=>release?.()],
   ['切换到未登录',()=>change('signedOut')],['切换边界额度',()=>change('boundary')],
   ['读取账号检查记录',()=>{const identity=document.getElementById('account-identity'),usage=document.getElementById('account-usage');out.textContent=JSON.stringify({pending:Boolean(release),identity:{text:identity.textContent,title:identity.title,hidden:identity.hidden},usage:{text:usage.textContent,title:usage.title,hidden:usage.hidden},requests:f.calls.filter(c=>c.path==='/api/account/usage'),errors:f.errors},null,2);}],
  ];
  for(const [label,action] of actions){const button=document.createElement('button');button.textContent=label;button.style.minHeight='44px';button.onclick=action;panel.append(button);}
  panel.append(out);document.body.append(panel);
 });
})();
