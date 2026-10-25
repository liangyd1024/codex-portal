// Isolated browser fixture: each document serves only its URL-selected target.
// Reuse thread IDs deliberately to exercise host-scoped browser persistence.
(() => {
 const f=window.rcmFixture;if(!f)throw Error('Connection scope requires the isolated fixture');
 const active=new URL(location.href).searchParams.get('host')||'qa-local';
 if(!['qa-local','qa-remote'].includes(active))throw Error('Unknown fixture target');
 const trace=new URL(location.href).searchParams.get('trace')==='1';
 const remote=active==='qa-remote';
 const hosts=[{id:'qa-local',alias:'验收本机',machineId:'qa-machine',kind:'local',user:'tester',home:'/test/local'},
  {id:'qa-remote',alias:'验收远程目标',machineId:'qa-remote-machine',kind:'ssh',user:'tester',home:'/test/remote',address:'fixture.invalid',port:22}];
 const host=hosts.find(x=>x.id===active),prefix=remote?'远程':'本机',cwd=host.home+'/project';
 f.connectionScope={active,violations:[],pageshows:[]};f.local=!remote;
 if(trace){f.connectionScope.trace=[];for(const type of ['pageshow','focus','online','rcm-ready'])addEventListener(type,event=>f.connectionScope.trace.push({event:type,persisted:event.persisted??null,at:performance.now()}));}
 addEventListener('pageshow',event=>f.connectionScope.pageshows.push({persisted:event.persisted}));
 f.threads.forEach((thread,index)=>{thread.name=prefix+'会话 '+(index?'B':'A');thread.cwd=cwd;});
 f.turns.get('qa-a')[0].items.find(item=>item.type==='agentMessage').text=prefix+'目标原文：中文 <原样> & 保留。';
 const emit=f.emit;f.emit=(method,params)=>emit(method,method==='manager/status'?{...params,host}:params);
 const previous=window.fetch;
 window.fetch=async(url,options={})=>{
  const u=new URL(typeof url==='string'?url:url.url,location.href),p=u.pathname;
  if(trace&&p.startsWith('/api/'))f.connectionScope.trace.push({path:p,host:u.searchParams.get('host'),at:performance.now(),stack:new Error().stack});
  if(/^\/api\/(?:status|models|projects|sidebar|threads)(?:\/|$)/.test(p)&&u.searchParams.get('host')!==active){
   f.connectionScope.violations.push({path:p,host:u.searchParams.get('host')});
   return new Response(JSON.stringify({error:{message:'模拟目标范围不符',code:'FIXTURE_SCOPE'}}),{status:409,headers:{'Content-Type':'application/json'}});
  }
  const response=await previous(url,options);
  if(!response.ok||!['/api/connections','/api/status','/api/projects','/api/sidebar','/api/models'].includes(p))return response;
  const data=await response.json();
  if(p==='/api/connections'){data.machineId='qa-machine';data.defaultConnection='qa-local';data.data=hosts.map(host=>({id:host.id,host}));}
  if(p==='/api/status')data.host=host;
  if(p==='/api/projects'||p==='/api/sidebar')for(const project of p==='/api/projects'?data.data:data.projects){project.name=prefix+'验收项目';project.roots=[cwd];}
  if(p==='/api/models')data.data.forEach(model=>{model.displayName=prefix+model.displayName;});
  return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
 };
})();
