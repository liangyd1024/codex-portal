// Isolated queue refresh benchmark. No native requests or commands are issued.
(()=>{
 const f=window.rcmFixture;
 const count=20;
 let serial=0,returnedAt=0;
 const entries=token=>Array.from({length:count},(_,i)=>({id:'queue-perf-'+i,input:[{type:'text',text:'排队样本 '+i+'：'+token+'，'+'保持中文原文。'.repeat(10)}],future:{preserved:true}}));
 f.queues.set('qa-a',entries('初始'));
 const fetchFixture=window.fetch;
 window.fetch=(url,options)=>fetchFixture(url,options).then(response=>{
  if(new URL(typeof url==='string'?url:url.url,location.href).pathname==='/api/threads/qa-a')returnedAt=performance.now();
  return response;
 });
 addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('details');panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;border:1px solid black;max-height:60vh;overflow:auto;max-width:320px';
  const summary=document.createElement('summary');summary.textContent='排队性能验收';panel.append(summary);
  const button=document.createElement('button');button.textContent='测量二十次排队刷新';button.style.minHeight='44px';panel.append(button);
  const output=document.createElement('pre');output.setAttribute('aria-label','排队性能记录');output.style.whiteSpace='pre-wrap';panel.append(output);document.body.append(panel);
  button.onclick=async()=>{
   if(button.disabled)return;button.disabled=true;output.textContent='测量中';
   const samples=[];
   try{
    const host=document.querySelector('.composer-queue');
    if(!host||host.querySelectorAll('.composer-queue-row').length!==count)throw Error('排队样本尚未加载');
    for(let i=0;i<23;i++){
     if(!document.hasFocus()||document.visibilityState!=='visible')throw Error('页面必须保持前台焦点');
     const result=await new Promise((resolve,reject)=>{
      const token='计量'+(++serial),calls=f.calls.length,start=performance.now();let observed=false;
      const timeout=setTimeout(()=>{observer.disconnect();reject(Error('排队更新超时'));},10000);
      const observer=new MutationObserver(()=>{
       if(observed||!host.querySelector('.composer-queue-row:last-child .composer-queue-text')?.textContent.includes(token))return;
       observed=true;observer.disconnect();const domMs=performance.now()-returnedAt;
       requestAnimationFrame(()=>requestAnimationFrame(()=>{
        clearTimeout(timeout);const reads=f.calls.slice(calls);
        resolve({domMs,framesMs:performance.now()-start,detailReads:reads.filter(c=>c.path==='/api/threads/qa-a').length,totalRequests:reads.length,
         rowCount:host.querySelectorAll('.composer-queue-row').length,nodeCount:host.querySelectorAll('*').length,
         complete:[...host.querySelectorAll('.composer-queue-text')].every(n=>n.textContent.includes(token)),focused:document.hasFocus(),visible:document.visibilityState==='visible'});
       }));
      });
      observer.observe(host,{subtree:true,childList:true,characterData:true});
      f.queues.set('qa-a',entries(token));f.emit('thread/queue/changed',{threadId:'qa-a'});
     });
     if(i>=3)samples.push(result);
    }
    output.textContent=JSON.stringify({warmup:3,samples,errors:f.errors},null,2);
   }catch(error){output.textContent=JSON.stringify({error:error.message,samples});}
   finally{button.disabled=false;}
  };
 });
})();
