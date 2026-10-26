// Browser-only connection editor responses. Never accesses real configuration.
(()=>{
 const original=window.fetch.bind(window),f=window.rcmFixture;
 const config={revision:'fixture-revision',defaultConnection:'qa-local',connections:[{id:'qa-local',kind:'local',alias:'验收机器',address:'127.0.0.1',port:22,user:'tester',home:'/test',binary:'/test/codex'},{id:'qa-remote',kind:'ssh',alias:'验收远程机器',address:'example.invalid',port:22,user:'tester',home:'/test',binary:'/test/codex',hasIdentityFile:true}]};
 f.connectionConfig=config;f.connectionCalls=[];f.connectionFailure=null;
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  const p=new URL(typeof url==='string'?url:url.url,location.href).pathname;
  if(p==='/api/connections'){const result=await original(url,options),data=await result.json();return json({...data,configRevision:config.revision});}
  if(p==='/api/connection-config'||p==='/api/connection-probe'){
   if(options.method!=='POST')return json(config);
   const body=JSON.parse(options.body);f.connectionCalls.push({path:p,body});
   if(f.connectionFailure)return json({error:{message:f.connectionFailure,code:'CONFIG_CONFLICT'}},409);
   if(p==='/api/connection-probe')return json({ok:true,message:'身份与可执行路径检查通过。'});
   return json(config);
  }
  return original(url,options);
 };
})();
