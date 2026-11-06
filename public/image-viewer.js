const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function imageViewLimits(size) {
  const fit=Math.min(1,size.width/size.imageWidth,size.height/size.imageHeight);
  return {min:fit,max:4,width:Math.min(1,size.width/size.imageWidth)};
}
export function constrainImageView(view,size) {
  const limits=imageViewLimits(size),scale=clamp(view.scale,limits.min,limits.max);
  const axis=(position,viewport,image)=>image<=viewport?(viewport-image)/2:clamp(position,viewport-image,0);
  return {scale,x:axis(view.x,size.width,size.imageWidth*scale),y:axis(view.y,size.height,size.imageHeight*scale)};
}
export function zoomImageView(view,scale,anchor,size) {
  const limits=imageViewLimits(size),next=clamp(scale,limits.min,limits.max),ratio=next/view.scale;
  return constrainImageView({scale:next,x:anchor.x-(anchor.x-view.x)*ratio,y:anchor.y-(anchor.y-view.y)*ratio},size);
}

const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
export function openImageViewer(source,opener) {
  const dialog=node('dialog','image-viewer'),toolbar=node('div','image-viewer-toolbar');
  const stage=node('div','image-viewer-stage'),full=node('img','image-viewer-image');
  const status=node('span','image-viewer-status','正在加载图片…'),percent=node('output','image-viewer-percent');
  dialog.setAttribute('aria-label',source.alt||'图片');stage.tabIndex=0;
  stage.setAttribute('aria-label','图片查看区域，可拖动、滚轮或双指缩放，方向键移动');
  status.setAttribute('role','status');full.alt=source.alt;full.draggable=false;
  const controls=[];
  const button=(text,label,action)=>{const b=node('button','',text);b.type='button';b.setAttribute('aria-label',label);b.onclick=action;toolbar.append(b);controls.push(b);return b;};
  let view={scale:1,x:0,y:0},ready=false,closed=false,frame=null;
  const pointers=new Map();
  const size=()=>({width:stage.clientWidth,height:stage.clientHeight,imageWidth:full.naturalWidth,imageHeight:full.naturalHeight});
  const center=()=>({x:stage.clientWidth/2,y:stage.clientHeight/2});
  const paint=()=>{
    frame=null;if(!ready||closed)return;
    full.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    percent.value=Math.round(view.scale*100)+'%';
    const limits=imageViewLimits(size());out.disabled=view.scale<=limits.min+1e-8;inside.disabled=view.scale>=limits.max-1e-8;
  };
  const render=()=>{if(frame===null)frame=requestAnimationFrame(paint);};
  const zoom=(scale,anchor=center())=>{if(!ready)return;view=zoomImageView(view,scale,anchor,size());render();};
  const fit=()=>{if(!ready)return;view=constrainImageView({scale:imageViewLimits(size()).width,x:0,y:0},size());render();};
  const out=button('−','缩小图片',()=>zoom(view.scale/1.25));toolbar.append(percent);
  const inside=button('＋','放大图片',()=>zoom(view.scale*1.25));
  button('适宽','适应宽度',fit);button('100%','原始尺寸',()=>zoom(1));
  const original=node('a','image-download','打开原图');original.href=source.src;original.target='_blank';original.rel='noopener noreferrer';toolbar.append(original);
  const close=button('关闭','关闭图片',()=>dialog.close());close.className='image-viewer-close';
  const retry=node('button','image-viewer-retry','重试图片');retry.type='button';retry.hidden=true;
  const load=()=>{ready=false;full.hidden=true;status.hidden=false;status.textContent='正在加载图片…';retry.hidden=true;controls.forEach(b=>{if(b!==close)b.disabled=true;});percent.value='';full.src=source.src;};
  retry.onclick=load;
  full.onload=()=>{if(closed)return;ready=true;full.hidden=false;status.hidden=true;retry.hidden=true;controls.forEach(b=>b.disabled=false);fit();};
  full.onerror=()=>{if(closed)return;ready=false;full.hidden=true;status.hidden=false;status.textContent='图片暂时无法加载，请重试。';retry.hidden=false;};
  stage.append(full,status,retry);dialog.append(toolbar,stage);document.body.append(dialog);dialog.showModal();close.focus();
  const point=e=>{const r=stage.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  const gesture=()=>{const points=[...pointers.values()];return points.length<2?{center:points[0],distance:0}:{center:{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)};};
  stage.addEventListener('pointerdown',e=>{
    if(!ready||e.button!==0||pointers.size>=2)return;
    e.preventDefault();stage.focus({preventScroll:true});stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,point(e));stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    const before=gesture();pointers.set(e.pointerId,point(e));const after=gesture();
    if(before.distance>0&&after.distance>0)view=zoomImageView(view,view.scale*after.distance/before.distance,before.center,size());
    view=constrainImageView({...view,x:view.x+after.center.x-before.center.x,y:view.y+after.center.y-before.center.y},size());render();
  });
  const release=e=>{pointers.delete(e.pointerId);if(!pointers.size)stage.classList.remove('dragging');};
  for(const event of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(event,release);
  stage.addEventListener('wheel',e=>{if(!ready)return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?stage.clientHeight:1);zoom(view.scale*Math.exp(clamp(-delta*.002,-1,1)),point(e));},{passive:false});
  stage.addEventListener('dblclick',e=>{if(!ready)return;e.preventDefault();if(Math.abs(view.scale-1)<.001)fit();else zoom(1,point(e));});
  stage.addEventListener('keydown',e=>{
    if(!ready||e.isComposing||e.ctrlKey||e.metaKey||e.altKey)return;
    if(['+','=','-','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();else return;
    if(e.key==='+'||e.key==='=')zoom(view.scale*1.25);
    else if(e.key==='-')zoom(view.scale/1.25);
    else if(e.key==='0')fit();
    else{const dx=e.key==='ArrowLeft'?80:e.key==='ArrowRight'?-80:0,dy=e.key==='ArrowUp'?80:e.key==='ArrowDown'?-80:0;view=constrainImageView({...view,x:view.x+dx,y:view.y+dy},size());render();}
  });
  const observer=new ResizeObserver(()=>{if(ready){view=constrainImageView(view,size());render();}});observer.observe(stage);
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{closed=true;observer.disconnect();if(frame!==null)cancelAnimationFrame(frame);pointers.clear();dialog.remove();if(opener.isConnected)opener.focus();},{once:true});
  load();
  return dialog;
}
