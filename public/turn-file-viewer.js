let activeViewer=null;

export function closeTurnFileViewer() {
  activeViewer?.close();
}

// The viewer owns a read-only snapshot. It never requests or mutates a worktree.
export function openTurnFileViewer(files,{trigger,renderEdits}={}) {
  closeTurnFileViewer();
  if(!files.length)return;
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  const dialog=node('dialog','file-viewer turn-file-viewer');activeViewer=dialog;
  dialog.setAttribute('aria-label','查看本轮变更');
  const header=node('div','file-viewer-header');
  const close=node('button','secondary-button','关闭');close.type='button';close.onclick=()=>dialog.close();
  header.append(node('strong','','查看变更 · '+files.length+' 个文件'),close);
  const note=node('p','file-viewer-status','本轮原始变更记录（打开时快照），不代表当前工作区的最终差异。');
  const label=node('label','turn-file-picker');label.append(node('span','','选择文件'));
  const select=node('select');select.setAttribute('aria-label','选择文件');
  for(const file of files){const slash=file.label.lastIndexOf('/');const option=node('option','',slash<0?file.label:file.label.slice(slash+1)+' — '+file.label.slice(0,slash));option.value=String(select.options.length);select.append(option);}
  label.append(select);
  const navigation=node('div','turn-file-navigation');
  const previous=node('button','secondary-button','上一个'),next=node('button','secondary-button','下一个'),position=node('span');
  previous.type=next.type='button';position.setAttribute('role','status');
  navigation.append(previous,position,next);
  const content=node('div','turn-file-diffs');
  function show(index){
    select.selectedIndex=index;content.replaceChildren();
    renderEdits(content,files[index]);content.scrollTop=0;
    previous.disabled=index===0;next.disabled=index===files.length-1;position.textContent=(index+1)+' / '+files.length;
  }
  select.onchange=()=>show(select.selectedIndex);
  previous.onclick=()=>show(select.selectedIndex-1);next.onclick=()=>show(select.selectedIndex+1);
  dialog.append(header,note,label,navigation,content);
  dialog.addEventListener('close',()=>{const current=activeViewer===dialog;if(current)activeViewer=null;dialog.remove();if(current&&trigger?.isConnected)trigger.focus({preventScroll:true});},{once:true});
  document.body.append(dialog);show(0);dialog.showModal();select.focus();
  return dialog;
}
