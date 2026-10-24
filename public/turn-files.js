const typeOf=value=>value?.type||value||'';
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;};
const icon=name=>{const node=document.createElementNS('http://www.w3.org/2000/svg','svg');node.classList.add('icon');node.setAttribute('aria-hidden','true');const use=document.createElementNS(node.namespaceURI,'use');use.setAttribute('href','#i-'+name);node.append(use);return node;};
const statusNames={completed:'已完成',inProgress:'修改中',in_progress:'修改中',running:'修改中',failed:'失败',declined:'已拒绝',interrupted:'已中断',cancelled:'已取消',canceled:'已取消'};
const kindNames={add:'新增',create:'新增',delete:'删除',update:'修改',modify:'修改'};

// These are native edit records, not a reconstructed working-tree diff.
export function turnFiles(items,cwd='') {
  const files=new Map(),root=cwd.replace(/\/+$/,'');
  for(const item of items||[]) {
    if(item.type!=='fileChange')continue;
    for(const change of item.changes||[]) {
      if(typeof change?.path!=='string'||!change.path)continue;
      let file=files.get(change.path);
      if(!file){file={path:change.path,label:root&&change.path.startsWith(root+'/')?change.path.slice(root.length+1):change.path,edits:[]};files.set(change.path,file);}
      file.edits.push({kind:typeOf(change.kind),status:typeOf(item.status),diff:change.diff});
    }
  }
  return [...files.values()];
}

export function renderTurnFiles(items,{turnId,cwd='',uncertain=false}={}) {
  const files=turnFiles(items,cwd);
  if(!files.length)return null;
  const card=el('details','turn-file-changes');card.setAttribute('aria-label','本轮文件变更');
  card.dataset.itemId='turn-files-'+turnId;
  const completed=files.every(f=>f.edits.every(e=>e.status==='completed'));
  const heading=el('summary','turn-files-heading');
  heading.append(icon('file'),el('strong','',completed?'已编辑 '+files.length+' 个文件':'文件变更 · '+files.length+' 个文件'));
  heading.append(icon('chevron'));
  card.append(heading);
  const list=el('div','turn-files-list');card.append(list);
  for(const file of files){
    const row=el('details','turn-file');row.dataset.itemId=card.dataset.itemId+':'+file.path;
    const summary=el('summary'),last=file.edits.at(-1),status=uncertain&&['inProgress','in_progress','running'].includes(last.status)?'状态未确认':statusNames[last.status]||last.status||'状态未确认';
    const path=el('span','turn-file-path');path.title=file.path;
    const slash=file.label.lastIndexOf('/');
    if(slash>=0)path.append(el('span','turn-file-directory',file.label.slice(0,slash+1)));
    path.append(el('span','turn-file-name',file.label.slice(slash+1)));
    summary.append(path,el('span','turn-file-kind',file.edits.length>1?file.edits.length+' 次变更':kindNames[last.kind]||last.kind||'修改'));
    if(last.status!=='completed')summary.append(el('span','turn-file-status',status));
    summary.append(icon('chevron'));
    summary.setAttribute('aria-label',file.label+'，'+status+'，展开或收起变更');
    const body=el('div','turn-file-diffs');row.append(summary,body);
    // Allocate potentially large patch text only when the user opens a file.
    row.ontoggle=()=>{
      if(!row.open||body.childNodes.length)return;
      body.append(el('p','turn-file-full-path',file.path));
      file.edits.forEach((edit,index)=>{
        if(file.edits.length>1)body.append(el('p','subtle','第 '+(index+1)+' 次变更 · '+(statusNames[edit.status]||edit.status||'状态未确认')));
        if(typeof edit.diff==='string'&&edit.diff){const pre=el('pre','turn-file-diff',edit.diff);pre.tabIndex=0;pre.setAttribute('aria-label',file.label+' 的原始变更，可横向滚动');body.append(pre);}
        else body.append(el('p','subtle','原生记录未提供变更内容。'));
      });
    };
    list.append(row);
  }
  return card;
}
