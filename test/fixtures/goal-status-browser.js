// Load after mobile-browser.js. All requests stay in the simulated API.
(() => {
 const f=window.rcmFixture,fetchFixture=window.fetch;
 f.goal={objective:'核实测试结果',status:'blocked',timeUsedSeconds:4531};
 f.threads[0].name='目标状态验收';
 f.turns.set('qa-a',[]);
 window.fetch=async(url,options={})=>{
  const path=new URL(typeof url==='string'?url:url.url,location.href).pathname;
  const previous=f.goal;
  const response=await fetchFixture(path==='/api/desktop/threads/qa-a'?'/api/threads/qa-a':url,options);
  if(path==='/api/threads/qa-a/goal'&&options.method==='POST'&&response.ok){const body=JSON.parse(options.body);f.goal=body.clear?null:{...previous,...body};}
  if(['/api/threads/qa-a','/api/desktop/threads/qa-a'].includes(path)&&response.ok){
   const detail=await response.json();if(new URL(location.href).searchParams.get('desktopGoal')==='1'){detail.controlled=false;detail.controlState='desktop';detail.desktop={available:true,canSend:true,liveEvents:true};}
   detail.goal=f.goal;detail.goalError=f.goalError||null;
   return new Response(JSON.stringify(detail),{headers:{'Content-Type':'application/json'}});
  }
  return response;
 };
})();
