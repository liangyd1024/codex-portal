// Optional benchmark UI for the isolated static comparison server only.
(() => {
 const f=window.rcmFixture;
 let phaseSample=null;
 const phaseEnabled=new URLSearchParams(location.search).get('perfPhases')==='1';
 if(phaseEnabled){
  const observe=(object,key,label)=>{const original=object[key];object[key]=function(...args){if(!phaseSample)return Reflect.apply(original,this,args);const bucket=phaseSample[label]??={calls:0,ms:0,maxMs:0,slow:[]},start=performance.now();bucket.calls++;let result;try{result=Reflect.apply(original,this,args);return result;}finally{const elapsed=performance.now()-start;bucket.ms+=elapsed;bucket.maxMs=Math.max(bucket.maxMs,elapsed);if(elapsed>=20&&bucket.slow.length<5)bucket.slow.push({ms:elapsed,resultLength:typeof result==='string'?result.length:null,stack:new Error('fixture timing callsite').stack});}};};
  observe(JSON,'parse','jsonParse');observe(JSON,'stringify','jsonStringify');
  observe(Element.prototype,'getBoundingClientRect','rect');observe(Element.prototype,'querySelectorAll','queryAll');
  observe(Node.prototype,'cloneNode','clone');
 }
 const rows=Array.from({length:200},(_,i)=>({id:'perf-'+i,status:'completed',items:[
  {id:'perf-user-'+i,type:'userMessage',content:[{type:'text',text:'性能样本 '+i}]},
  {id:'perf-answer-'+i,type:'agentMessage',text:'## 样本 '+i+'\n\n'+'固定中文段落与标点。'.repeat(100)+'\n\n```text\nfixed code\n```'}
 ]}));
 f.turns.set('qa-a',rows);
 addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('details');panel.style.cssText='position:fixed;top:56px;right:4px;z-index:100000;background:white;border:1px solid black;max-height:65vh;overflow:auto;max-width:330px';
  const summary=document.createElement('summary');summary.textContent='性能验收控制';panel.append(summary);
  const button=document.createElement('button');button.textContent='测量五次尾部更新';button.style.minHeight='44px';panel.append(button);
  const out=document.createElement('pre');out.setAttribute('aria-label','性能测量记录');out.style.whiteSpace='pre-wrap';panel.append(out);document.body.append(panel);
  const inputSamples=[];
  const readInput=document.createElement('button');readInput.textContent='读取输入响应记录';readInput.style.minHeight='44px';panel.append(readInput);
  const inputOut=document.createElement('pre');inputOut.setAttribute('aria-label','输入响应记录');inputOut.style.whiteSpace='pre-wrap';panel.append(inputOut);
  readInput.onclick=()=>{inputOut.textContent=JSON.stringify({samples:inputSamples,errors:f.errors},null,2);};
  document.addEventListener('input',event=>{
   if(event.target.id!=='message-input')return;
   const started=performance.now(),calls=f.calls.length,nodes=[...document.querySelectorAll('.message-turn')];
   const value=event.target.value,focused=document.hasFocus(),visible=document.visibilityState==='visible';
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
    inputSamples.push({framesMs:performance.now()-started,length:value.length,unchanged:event.target.value===value,
     focused,visible,endFocused:document.hasFocus(),endVisible:document.visibilityState==='visible',
     nodeCount:nodes.length,nodesPreserved:nodes.every(n=>n.isConnected),apiCalls:f.calls.length-calls});
   }));
  },{capture:true});
  const longFrames=[];
  const longFrameSupported=PerformanceObserver.supportedEntryTypes.includes('long-animation-frame');
  if(longFrameSupported)new PerformanceObserver(list=>{for(const e of list.getEntries())longFrames.push({start:e.startTime,duration:e.duration,blocking:e.blockingDuration,renderStart:e.renderStart,styleLayoutStart:e.styleAndLayoutStart,scripts:(e.scripts||[]).map(s=>({duration:s.duration,executionStart:s.executionStart,forcedLayout:s.forcedStyleAndLayoutDuration,source:s.sourceURL,position:s.sourceCharPosition,fn:s.sourceFunctionName,invoker:s.invoker,invokerType:s.invokerType}))});}).observe({type:'long-animation-frame',buffered:false});
  let serial=0;
  button.onclick=async()=>{
   if(button.disabled)return;button.disabled=true;
   const results=[],nodes=[...document.querySelectorAll('.message-turn')],measurementStart=performance.now();
   try{
    if(nodes.length!==200)throw Error('历史尚未完整显示：'+nodes.length);
    for(let i=0;i<5;i++){
     if(!document.hasFocus()||document.visibilityState!=='visible')throw Error('页面必须保持前台焦点');
     const result=await new Promise((resolve,reject)=>{
      const token=' 流式计量'+(++serial)+'。',calls=f.calls.length;phaseSample=phaseEnabled?{}:null;
      const tail=document.querySelector('[data-turn-id="perf-199"]');
      let started,observed=false;
      const timeout=setTimeout(()=>{observer.disconnect();reject(Error('测量超时'));},10000);
      const observer=new MutationObserver(()=>{
       if(observed||!tail?.textContent.includes(token))return;observed=true;observer.disconnect();
       const domMs=performance.now()-started;
       requestAnimationFrame(()=>requestAnimationFrame(()=>{
        clearTimeout(timeout);const phases=phaseSample;phaseSample=null;resolve({phases,started,domAt:started+domMs,domMs,framesMs:performance.now()-started,apiCalls:f.calls.length-calls,focused:document.hasFocus(),visible:document.visibilityState==='visible'});
       }));
      });
      observer.observe(document.getElementById('messages'),{subtree:true,childList:true,characterData:true});
      requestAnimationFrame(()=>{
       started=performance.now();rows.at(-1).items.at(-1).text+=token;
       f.emit('item/agentMessage/delta',{threadId:'qa-a',turnId:'perf-199',itemId:'perf-answer-199',delta:token});
      });
     });results.push(result);
    }
    out.textContent=JSON.stringify({longFrameSupported,longFrames:longFrames.filter(e=>e.start>=measurementStart),samples:results,nodeCount:nodes.length,nodesPreserved:nodes.every(n=>n.isConnected),errors:f.errors},null,2);
   }catch(error){out.textContent=JSON.stringify({error:error.message,samples:results});}
   finally{phaseSample=null;button.disabled=false;}
  };
 });
})();
