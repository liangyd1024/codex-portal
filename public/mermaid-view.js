const cache=new Map();
let cacheSize=0,frame,ready,serial=Promise.resolve(),sequence=0,observer;
const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
function resetFrame(){frame?.remove();frame=null;ready=null;}
function getFrame(){
  if(ready)return ready;
  ready=new Promise((resolve,reject)=>{
    const child=make('iframe','mermaid-render-frame');frame=child;
    child.setAttribute('sandbox','allow-scripts');child.setAttribute('aria-hidden','true');child.tabIndex=-1;
    const done=error=>{clearTimeout(timer);window.removeEventListener('message',listen);if(error){resetFrame();reject(error);}else resolve(child);};
    const listen=event=>{if(event.source===child.contentWindow&&event.data?.type==='rcm-mermaid-ready')done();};
    const timer=setTimeout(()=>done(Error('图表组件加载失败')),20000);
    window.addEventListener('message',listen);child.src='/mermaid-frame.html';document.body.append(child);
  });
  return ready;
}
function render(source){
  if(cache.has(source))return Promise.resolve(cache.get(source));
  const work=serial.then(async()=>{
    if(cache.has(source))return cache.get(source);
    const child=await getFrame(),id=++sequence;
    const svg=await new Promise((resolve,reject)=>{
      const done=(error,value)=>{clearTimeout(timer);window.removeEventListener('message',listen);error?reject(error):resolve(value);};
      const listen=event=>{
        if(event.source!==child.contentWindow||event.data?.type!=='rcm-mermaid-result'||event.data.id!==id)return;
        const data=event.data;
        done(data.error||typeof data.svg!=='string'||data.svg.length>4000000?Error('无法生成图表'):null,data.svg);
      };
      const timer=setTimeout(()=>{resetFrame();done(Error('图表生成超时'));},15000);
      window.addEventListener('message',listen);child.contentWindow.postMessage({type:'rcm-mermaid-render',id,source},'*');
    });
    const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    // Bounded cache, including source keys; repeated message updates reuse the image.
    if(url.length+source.length<=4000000){
      while(cache.size>=24||cacheSize+url.length+source.length>4000000){const [key,value]=cache.entries().next().value;cache.delete(key);cacheSize-=key.length+value.length;}
      cache.set(source,url);cacheSize+=source.length+url.length;
    }
    return url;
  });
  serial=work.catch(()=>{});return work;
}
function enlarge(url,opener){
  const dialog=make('dialog','mermaid-dialog'),bar=make('div','mermaid-dialog-bar'),close=make('button','mermaid-action','关闭'),area=make('div','mermaid-viewport'),img=make('img','mermaid-image');
  dialog.setAttribute('aria-label','放大图表');close.type='button';area.tabIndex=0;area.setAttribute('aria-label','图表，可横向和纵向滚动');img.alt='Mermaid 图表';img.src=url;
  bar.append(make('span','','图表'),close);area.append(img);dialog.append(bar,area);
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();if(opener.isConnected)opener.focus();},{once:true});
  document.body.append(dialog);dialog.showModal();close.focus();
}
export function enhanceMermaid(block,header,pre,source){
  block.className+=' mermaid-block';block.dataset.mermaidSource=source;
  const toggle=make('button','mermaid-action','源码'),zoom=make('button','mermaid-action','放大'),retry=make('button','mermaid-action','重试');
  const view=make('div','mermaid-viewport'),status=make('p','mermaid-status','等待生成图表…');
  view.tabIndex=0;view.setAttribute('role','region');view.setAttribute('aria-label','Mermaid 图表，可滚动');status.setAttribute('role','status');
  for(const button of [toggle,zoom,retry])button.type='button';
  zoom.disabled=true;retry.hidden=true;pre.hidden=true;view.append(status);header.append(toggle,zoom,retry);block.append(view);
  let url,busy=false,sourceMode=false;
  const mode=value=>{sourceMode=value;pre.hidden=!value;view.hidden=value;toggle.textContent=value?'图表':'源码';toggle.setAttribute('aria-label',value?'显示图表':'显示源码');};
  mode(false);
  toggle.onclick=()=>mode(!sourceMode);zoom.onclick=()=>enlarge(url,zoom);
  const run=async()=>{
    if(busy)return;
    busy=true;retry.hidden=true;status.textContent='正在生成图表…';view.setAttribute('aria-busy','true');
    try{
      if(source.length>30000)throw Error('图表过大');
      url=await render(source);
      const img=make('img','mermaid-image');img.alt='Mermaid 图表，原始内容可切换到源码查看';img.src=url;
      await img.decode();view.replaceChildren(img);zoom.disabled=false;
    }catch{status.textContent='图表生成失败，请检查源码或重试。';view.replaceChildren(status);retry.hidden=false;pre.hidden=false;}
    finally{busy=false;view.setAttribute('aria-busy','false');}
  };
  retry.onclick=()=>{mode(false);void run();};
  // Reconciliation discards fresh copies of unchanged widgets before this microtask.
  queueMicrotask(()=>{
    if(!block.isConnected)return;
    if(!globalThis.IntersectionObserver){void run();return;}
    observer??=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.target.isConnected){observer.unobserve(entry.target);continue;}if(entry.isIntersecting){observer.unobserve(entry.target);entry.target._renderMermaid?.();}}});
    block._renderMermaid=run;observer.observe(block);
  });
}
