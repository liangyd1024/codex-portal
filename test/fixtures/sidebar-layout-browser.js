// Isolated sidebar layout fixture. No request reaches a native engine.
(() => {
 const f=window.rcmFixture,base=f.threads[0],fetchFixture=window.fetch;
 f.threads[0].name='示例数据调整看板';f.threads[1].name='示例费用核对';
 f.threads[1].status={type:'active'};f.owned.add('qa-b');
 f.threads.push({...base,id:'qa-archive',name:'已归档示例会话',archived:true});
 const names=['示例仓-计费业务域','示例仓-订单业务域','示例仓-成本业务域','示例仓-基础业务域','示例仓-履约业务域','示例仓-数据业务域'];
 f.sections=names.map((name,i)=>({id:'section-'+i,name,projectIds:i===5?['qa-finance','qa-project']:[],threadIds:[],revision:'r1'}));
 localStorage.setItem('rcm.sidebar.expanded.qa-local.qa-account',JSON.stringify(['section:section-5','project:qa-project']));
 // Exercise migration from the removed outer workspace collapse control.
 localStorage.setItem('rcm.layout.projects','false');
 window.fetch=async(url,options)=>{
  const response=await fetchFixture(url,options),u=new URL(typeof url==='string'?url:url.url,location.href);
  if(u.pathname!=='/api/sidebar'||!response.ok)return response;
  const snapshot=await response.json();
  snapshot.rootProjectIds=[];
  for(const key of ['createSection','renameSection','deleteSection'])snapshot.capabilities[key].supported=false;
  snapshot.projects=[{id:'qa-finance',name:'示例资金看板',roots:['/test/finance'],threadIds:[]},{id:'qa-project',name:'示例数据分析',roots:['/test/project'],threadIds:snapshot.data.filter(t=>!t.archived).map(t=>t.id)}];
  return new Response(JSON.stringify(snapshot),{headers:{'Content-Type':'application/json'}});
 };
 f.question();
})();
