// Synthetic account responses for isolated browser parity; no real identity reads.
(() => {
 const f=window.rcmFixture;
 if(!f)throw Error('Account fixture requires isolated API interception.');
 const state=new URL(location.href).searchParams.get('accountState')||'normal';
 const states={
  normal:{visible:true,account:{type:'chatgpt',email:'tester@example.test'},rateLimits:{primary:{usedPercent:25,windowDurationMins:300},secondary:{usedPercent:60,windowDurationMins:10080}}},
  apiKey:{visible:false,account:{type:'apiKey'}},
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
})();
