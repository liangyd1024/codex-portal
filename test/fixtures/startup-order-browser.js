// Deterministic early SSE opening for paired startup performance measurements.
// This gates only fake CSRF responses. No application or real transport changes.
(() => {
 const f=window.rcmFixture;if(!f)throw Error('Startup order requires isolated fixture');
 let opened;const ready=new Promise(resolve=>{opened=resolve;});
 const Stream=window.EventSource;window.EventSource=class extends Stream {
  set onopen(handler){this.openHandler=handler;}
  get onopen(){return event=>{try{return this.openHandler?.(event);}finally{f.startupOpened=true;opened();}};}
 };
 const previous=window.fetch;window.fetch=async(url,options)=>{
  const path=new URL(typeof url==='string'?url:url.url,location.href).pathname;
  if(path==='/api/csrf')await ready;
  return previous(url,options);
 };
})();
// Observe competing foreground events without cancelling or replacing handlers.
(() => {
 const f=window.rcmFixture;f.startupTimeline=[];
 for(const name of ['focus','pageshow','online','pagehide'])window.addEventListener(name,e=>f.startupTimeline.push({event:name,at:performance.now(),persisted:e.persisted??null}));
 document.addEventListener('visibilitychange',()=>f.startupTimeline.push({event:'visibilitychange',at:performance.now(),hidden:document.hidden}));
 window.addEventListener('rcm-ready',()=>f.startupTimeline.push({event:'ready',at:performance.now()}));
 const previous=window.fetch;window.fetch=(url,options)=>{
  const path=new URL(typeof url==='string'?url:url.url,location.href).pathname;
  f.startupTimeline.push({event:'fetch',path,at:performance.now(),stack:path==='/api/status'?new Error().stack:undefined});
  return previous(url,options);
 };
})();
