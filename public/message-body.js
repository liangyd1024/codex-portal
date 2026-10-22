import {copyText} from './feedback.js';
function el(tag, cls, text) { const n=document.createElement(tag); if(cls)n.className=cls; if(text != null)n.textContent=text; return n; }
// Only explicit commentary with a final answer is collapsed. Legacy messages,
// interrupted turns without an answer and live progress remain readable.
export function groupTurnItems(turn) {
  const items = turn.items || [];
  const finished = !['inProgress','in_progress','running'].includes(turn.status?.type || turn.status);
  const hasAnswer = items.some(i => i.type === 'agentMessage' && i.phase === 'final_answer' && i.text?.trim());
  const groups = [];
  for (const [index,item] of items.entries()) {
    const process = !(item.type === 'imageGeneration' && (item.result || item.imageRef)) && !['userMessage','goalMessage','agentMessage','plan','error'].includes(item.type) ||
      (finished && hasAnswer && item.type === 'agentMessage' && item.phase === 'commentary');
    if (!process) { groups.push({type:'message',item}); continue; }
    let group = groups.at(-1);
    if (group?.type !== 'process') { group = {type:'process',key:item.id || index,items:[]}; groups.push(group); }
    group.items.push(item);
  }
  return groups;
}
function appendInline(n, text, depth = 0, options = {}) {
  text = String(text);
  if (depth > 20) { n.append(document.createTextNode(text)); return; }
  // Raw HTML is always text; only explicitly allowed link schemes become links.
  const pattern = /\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|(`+)([^]*?)\1(?!`)|\*\*([^]*?)\*\*|__([^]*?)__|\[([^\]\n]+)\]\((<[^>\n]+>|(?:\\.|[^\s()\\]|\([^()\n]*\))+?)\)|\*([^*\n]+)\*|~~([^~\n]+)~~|&(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const image = m[5] !== undefined && m.index > last && text[m.index-1] === '!';
    if (m.index > last) n.append(document.createTextNode(text.slice(last,m.index-(image?1:0))));
    const token = m[0];
    if (token[0] === '\\') n.append(document.createTextNode(token.slice(1)));
    else if (m[1]) n.append(el('code','',m[2].replace(/\n/g,' ').replace(/^ (.*) $/,'$1')));
    else if (m[3] !== undefined || m[4] !== undefined) { const strong=el('strong'); appendInline(strong,m[3] ?? m[4],depth+1,options); n.append(strong); }
    else if (m[5] !== undefined) {
      const href = m[6].replace(/^<|>$/g,'').replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g,'$1');
      const media=image && options.image?.(href,m[5]);
      if(media){n.append(media);last=m.index+token.length;continue;}
      const file=options.file?.(href,m[5]);
      if(file){appendInline(file,m[5],depth+1,{});n.append(file);last=m.index+token.length;continue;}
      let safe = false;
      try { safe = ['https:','http:'].includes(new URL(href).protocol); } catch {}
      if (safe) { const link=el('a'); appendInline(link,m[5],depth+1,options); link.href=href; link.target='_blank'; link.rel='noopener noreferrer'; n.append(link); }
      else { appendInline(n,m[5],depth+1,options); n.append(document.createTextNode(' (' + href + ')')); }
    } else if (m[7] !== undefined || m[8] !== undefined) { const span=el(m[7] !== undefined?'em':'del'); appendInline(span,m[7] ?? m[8],depth+1,options); n.append(span); }
    else {
      const entity=token.slice(1,-1).toLowerCase(), named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
      const point=entity.startsWith('#x')?parseInt(entity.slice(2),16):entity.startsWith('#')?Number(entity.slice(1)):null;
      n.append(document.createTextNode(point === null ? named[entity] : point>0 && point<=0x10ffff && !(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'\ufffd'));
    }
    last = m.index + token.length;
  }
  if (last < text.length) n.append(document.createTextNode(text.slice(last)));
}
const listMarker = line => /^( *)([-+*]|\d+[.)]) +(.*)$/.exec(line);
const tableCells = value => value.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim());
export function markdown(text, depth = 0, options = {}) {
  const n = el('div','message-body'), lines = String(text || '').replace(/\r\n?/g,'\n').split('\n');
  if (depth > 20) { n.textContent=text; return n; }
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const p=el('p');
    paragraph.forEach((line,index)=>{
      const hard = /(?: {2,}|\\)$/.test(line);
      appendInline(p,line.replace(/(?: {2,}|\\)$/,''),0,options);
      if(index<paragraph.length-1)p.append(hard?el('br'):document.createTextNode('\n'));
    });
    n.append(p); paragraph=[];
  };
  const appendBlocks = (parent, content) => { const body=markdown(content,depth+1,options); parent.append(...Array.from(body.childNodes)); };
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    const fence=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      flush(); const code=[]; const closing=new RegExp('^ {0,3}'+fence[1][0]+'{'+fence[1].length+',}\\s*$');
      while (++i<lines.length && !closing.test(lines[i])) code.push(lines[i]);
      const value=code.join('\n'), language=fence[2].trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9_+-]/g,'').slice(0,30);
      const block=el('div','code-block'),header=el('div','code-block-header'),copy=el('button','code-copy','复制代码');
      copy.type='button';copy.setAttribute('aria-label','复制'+(language?' '+language:'')+'代码');
      const feedback=el('span','code-copy-status');feedback.setAttribute('role','status');
      copy.onclick=()=>copyText(value,{button:copy,status:feedback,failure:'复制失败，请选择代码复制'});
      header.append(el('span','code-language',language||'代码'),feedback,copy);
      const pre=el('pre'), content=el('code','',value);pre.tabIndex=0;pre.setAttribute('aria-label',(language||'')+'代码，可横向滚动');
      pre.append(content);block.append(header,pre);n.append(block);continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) { flush(); n.append(el('hr')); continue; }
    const heading=/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if(heading){flush();const h=el('h'+heading[1].length);appendInline(h,heading[2],0,options);n.append(h);continue;}
    const markers=lines[i+1] && tableCells(lines[i+1]);
    const headings=tableCells(line);
    if(line.includes('|') && markers?.length===headings.length && markers.every(c=>/^:?-{3,}:?$/.test(c))){
      flush();const wrap=el('div','table-scroll'),table=el('table'),head=el('thead'),row=el('tr');
      wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','表格，可横向滚动');
      const cell=(tag,value,index)=>{const c=el(tag);if(tag==='th')c.scope='col';const marker=markers[index];if(marker.endsWith(':'))c.style.textAlign=marker.startsWith(':')?'center':'right';else if(marker.startsWith(':'))c.style.textAlign='left';appendInline(c,value,0,options);return c;};
      headings.forEach((value,index)=>row.append(cell('th',value,index)));head.append(row);table.append(head);const body=el('tbody');i++;
      while(i+1<lines.length && lines[i+1].trim() && lines[i+1].includes('|')) {const values=tableCells(lines[++i]),tr=el('tr');headings.forEach((_,index)=>tr.append(cell('td',values[index]||'',index)));body.append(tr);}
      table.append(body);wrap.append(table);n.append(wrap);continue;
    }
    const bullet=listMarker(line);
    if(bullet){
      flush();const ordered=/\d/.test(bullet[2]),base=bullet[1].length,list=el(ordered?'ol':'ul');
      if(ordered)list.start=parseInt(bullet[2],10);
      while(i<lines.length){
        const marker=listMarker(lines[i]);
        if(!marker || marker[1].length!==base || /\d/.test(marker[2])!==ordered)break;
        const indent=marker[0].length-marker[3].length,content=[marker[3]];i++;
        while(i<lines.length){
          if(!lines[i].trim()){
            let next=i+1;while(next<lines.length&&!lines[next].trim())next++;
            const nextMarker=next<lines.length?listMarker(lines[next]):null;
            if(nextMarker && nextMarker[1].length===base) {i=next;break;}
            if(next>=lines.length || lines[next].search(/\S/)<indent)break;
            content.push('');i++;continue;
          }
          if(lines[i].search(/\S/)<indent)break;
          content.push(lines[i].slice(indent));i++;
        }
        const li=el('li');appendBlocks(li,content.join('\n'));list.append(li);
      }
      i--;n.append(list);continue;
    }
    if(/^ {0,3}>/.test(line)){
      flush();const quoted=[];while(i<lines.length && /^ {0,3}>/.test(lines[i]))quoted.push(lines[i++].replace(/^ {0,3}> ?/,''));i--;
      const quote=el('blockquote');appendBlocks(quote,quoted.join('\n'));n.append(quote);continue;
    }
    paragraph.push(line);
  }
  flush();return n;
}
