// Keep source text in a few DOM nodes, including for very large line counts.
export function referencedLine(text:string,line?:number){
  if(!Number.isSafeInteger(line)||!line||line<1)return null;
  let start=0;
  for(let n=1;n<line;n++){
    const end=text.indexOf('\n',start);
    if(end<0)return null;
    start=end+1;
  }
  const next=text.indexOf('\n',start);
  return {start,end:next<0?text.length:next};
}
export function sourcePreview(text:string,line?:number){
  const pre=document.createElement('pre');pre.className='file-preview-text';pre.tabIndex=0;
  pre.setAttribute('aria-label','文件源码，可滚动');
  const range=referencedLine(text,line);
  let mark:HTMLElement|undefined;
  if(range){
    mark=document.createElement('mark');mark.className='file-preview-line';
    mark.textContent=text.slice(range.start,range.end);mark.setAttribute('aria-label','引用行 '+line);
    pre.append(document.createTextNode(text.slice(0,range.start)),mark,document.createTextNode(text.slice(range.end)));
  }else pre.textContent=text;
  return {pre,locate(){if(mark)pre.scrollTop=Math.max(0,pre.scrollTop+mark.getBoundingClientRect().top-pre.getBoundingClientRect().top-pre.clientHeight/3);},found:!!range};
}
