// Browser-native EventSource against the isolated comparison server only.
(() => {
 const f=window.rcmFixture,client=crypto.randomUUID(),events=[];
 const base='/__parity_events',query='?client='+client;
 f.nativeEvents={client,events,pulses:[]};
 for(const type of ['offline','online'])addEventListener(type,()=>events.push({type,readyState:f.stream?.readyState}));
 window.EventSource=class extends f.NativeEventSource {
  constructor(){super(base+query);f.stream=this;
   this.addEventListener('qa/pulse',event=>f.nativeEvents.pulses.push(JSON.parse(event.data).sequence));
   for(const type of ['open','error'])this.addEventListener(type,()=>events.push({type,readyState:this.readyState}));
  }
 };
 addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('details');panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;border:1px solid black;max-height:60vh;overflow:auto;max-width:320px';
  const summary=document.createElement('summary');summary.textContent='真实 SSE 验收';panel.append(summary);
  const out=document.createElement('pre');out.setAttribute('aria-label','SSE 验收记录');out.style.whiteSpace='pre-wrap';
  for(const [label,action] of [['断开验收流','disconnect'],['恢复验收流','recover'],['读取 SSE 记录','status']]){
   const button=document.createElement('button');button.textContent=label;button.style.minHeight='44px';
   button.onclick=async()=>{button.disabled=true;try{
    const response=await fetch(base+'/'+action+query,{method:action==='status'?'GET':'POST'});
    if(!response.ok)throw Error('Fixture control failed: '+response.status);
    out.textContent=JSON.stringify({server:await response.json(),readyState:f.stream?.readyState,events,errors:f.errors},null,2);
   }catch(error){out.textContent=JSON.stringify({error:error.message});}finally{button.disabled=false;}};
   panel.append(button);
  }
  panel.append(out);document.body.append(panel);
 });
})();
