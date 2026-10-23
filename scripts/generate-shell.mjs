// One-time migration utility: preserve the baseline DOM without hand transcription.
import {parse} from 'parse5';
import {readFile,writeFile} from 'node:fs/promises';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const doc=parse(html);const walk=node=>[node,...(node.childNodes||[]).flatMap(walk)];
const shell=walk(doc).find(n=>n.attrs?.some(a=>a.name==='id'&&a.value==='app-shell'));
const renamed={'inputmode':'inputMode','enterkeyhint':'enterKeyHint','class':'className','for':'htmlFor','tabindex':'tabIndex','readonly':'readOnly','autocomplete':'autoComplete','autocapitalize':'autoCapitalize','spellcheck':'spellCheck','maxlength':'maxLength','rows':'rows','colspan':'colSpan','viewbox':'viewBox','stroke-width':'strokeWidth','stroke-linecap':'strokeLinecap','stroke-linejoin':'strokeLinejoin','aria-hidden':'aria-hidden'};
const booleans=new Set(['hidden','disabled','multiple','required','autofocus','checked','open']);
function jsx(n){
 if(n.nodeName==='#text')return n.value?'{'+JSON.stringify(n.value)+'}':'';
 if(n.nodeName.startsWith('#'))return '';
 const props=(n.attrs||[]).filter(a=>a.name!=='selected').map(a=>{
  let name=renamed[a.name]||a.name;if(name==='autofocus')name='autoFocus';if(name==='checked')name='defaultChecked';
  if(a.name==='style'){const css=Object.fromEntries(a.value.split(';').filter(x=>x.trim()).map(x=>{const i=x.indexOf(':');return [x.slice(0,i).trim().replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),x.slice(i+1).trim()];}));return 'style={'+JSON.stringify(css)+'}';}
  if(['tabIndex','rows','cols','maxLength','minLength','colSpan','rowSpan','size'].includes(name))return name+'={'+Number(a.value)+'}';
  return booleans.has(a.name)?name+'={true}':name+'={'+JSON.stringify(a.value)+'}';
 }).join(' ');
 const start='<'+n.tagName+(props?' '+props:'');
 if(['input','br','hr','img','meta','link','source','wbr','area','embed','col','param','track'].includes(n.tagName))return start+' />';
 return start+'>'+(n.childNodes||[]).map(jsx).join('')+'</'+n.tagName+'>';
}
const regions=[];let index=0;
const content=shell.childNodes.map(n=>{
 if(!n.tagName)return jsx(n);
 const id=n.attrs?.find(a=>a.name==='id')?.value;
 const name=id==='sidebar'?'SidebarShell':id==='inspector'?'InspectorShell':n.tagName==='main'?'ConversationShell':'ShellRegion'+(++index);
 regions.push('function '+name+'() { return ('+jsx(n)+'); }');return '<'+name+' />';
}).join('');
await writeFile(new URL('../src/web/components/Shell.tsx',import.meta.url),'// Baseline DOM migrated verbatim. Runtime hosts keep their existing IDs and classes.\n'+regions.join('\n')+'\nexport function WorkspaceShell() { return <>'+content+'</>; }\n');
