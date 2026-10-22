// Keep the native textarea (IME, dictation, paste, selection and undo) as the editor.
// The inert mirror only colors references; the exact same text is used in both layers.
export function mentionRanges(value, references) {
  const found=[];
  for(const ref of references){
    if(!ref.token)continue;
    let from=0;
    while(from<value.length){const start=value.indexOf(ref.token,from);if(start<0)break;const end=start+ref.token.length;
      if((start===0||/\s/u.test(value[start-1]))&&(end===value.length||/[\s，。！？、,.!?;；:：)）]/u.test(value[end])))found.push({...ref,start,end});
      from=end;
    }
  }
  return found.sort((a,b)=>a.start-b.start||b.end-a.end).filter((item,i,all)=>!all.slice(0,i).some(other=>other.end>item.start));
}
export function installInlineMentions(input,references){
  const wrap=document.createElement('div');wrap.className='mention-input-wrap';input.before(wrap);wrap.append(input);
  const mirror=document.createElement('div');mirror.className='mention-mirror';mirror.setAttribute('aria-hidden','true');wrap.prepend(mirror);
  let composing=false,lastText,lastStyle;
  function render(){
    const style=getComputedStyle(input);
    const keys=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textIndent','textAlign','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','tabSize','wordBreak','overflowWrap'];
    const styleStamp=JSON.stringify([keys.map(key=>style[key]),input.clientWidth,input.clientHeight]);
    if(styleStamp!==lastStyle){
      lastStyle=styleStamp;for(const key of keys)mirror.style[key]=style[key];
      mirror.style.width=input.clientWidth+'px';mirror.style.height=input.clientHeight+'px';
    }
    const refs=references(),textStamp=JSON.stringify([input.value,refs,composing]);
    if(textStamp!==lastText){
      lastText=textStamp;
      const ranges=mentionRanges(input.value,refs);mirror.replaceChildren();let offset=0;
      for(const range of ranges){mirror.append(document.createTextNode(input.value.slice(offset,range.start)));const mark=document.createElement('span');mark.className='inline-mention';mark.textContent=input.value.slice(range.start,range.end);mirror.append(mark);offset=range.end;}
      mirror.append(document.createTextNode(input.value.slice(offset)+'\n'));wrap.classList.toggle('has-mentions',ranges.length>0&&!composing);
    }
    mirror.scrollTop=input.scrollTop;mirror.scrollLeft=input.scrollLeft;
  }
  input.addEventListener('input',render);input.addEventListener('scroll',render);
  input.addEventListener('compositionstart',()=>{composing=true;render();});input.addEventListener('compositionend',()=>{composing=false;render();});
  new ResizeObserver(render).observe(input);
  return {render};
}
