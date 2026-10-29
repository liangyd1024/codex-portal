import {readFileSync} from 'node:fs';
import path from 'node:path';
import {readLiveStatus} from './status-read.mjs';
import {shareRead} from './core/pending-read.mjs';

// Parse a direct invocation only. Shell programs, substitutions and pipelines
// are deliberately unsupported; never infer execution from a mentioned ID.
function words(command){
 const out=[];let word='',quote='',started=false;
 for(let i=0;i<command.length;i++){
  const c=command[i];
  if(c==='\\'&&quote!=="'"){if(++i===command.length)return null;word+=command[i];started=true;continue;}
  if(quote){if(c===quote)quote='';else {if(quote==='"'&&'$`'.includes(c))return null;word+=c;}started=true;continue;}
  if(c==='"'||c==="'"){quote=c;started=true;continue;}
  if('$`;|&\n\r'.includes(c))return null;
  if(/\s/.test(c)){if(started){out.push(word);word='';started=false;}}else {word+=c;started=true;}
 }
 if(quote)return null;if(started)out.push(word);return out;
}
export function cliTarget(command,binary){
 if(typeof command!=='string'||!binary)return null;
 let args=words(command);if(!args)return null;
 if(['sh','bash','zsh'].includes(path.basename(args[0]||''))&&['-lc','-c'].includes(args[1])&&args.length===3)args=words(args[2]);
 if(!args||path.basename(args[0]||'')!==path.basename(binary)||args[1]!=='exec')return null;
 const valued=new Set(['--cd','-C','--sandbox','-s','--config','-c','--model','-m','--profile','-p','--output-last-message','-o','--color','--enable','--disable','--thread-source']);
 const flags=new Set(['--json','--skip-git-repo-check','--ignore-user-config','--ignore-rules','--dangerously-bypass-approvals-and-sandbox']);
 for(let i=2;i<args.length;i++){
  const a=args[i];
  if(a==='resume')return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(args[i+1]||'')?args[i+1]:null;
  if(valued.has(a)){if(!args[++i])return null;continue;}
  if(flags.has(a)||[...valued].some(v=>a.startsWith(v+'=')))continue;
  return null;
 }
 return null;
}

const commands=new WeakMap();
function commandRecords(manager){
 let entries=commands.get(manager);if(entries)return entries;
 entries=new Map();
 if(manager.titleStore){try{const saved=JSON.parse(readFileSync(manager.titleStore+'.cli-observations.json','utf8'));for(const [key,value] of saved.slice(-1000))if(typeof key==='string'&&Number.isFinite(value?.startedAt))entries.set(key,value);}catch{}}
 commands.set(manager,entries);return entries;
}
function saveCommands(manager,entries){
 // Observation persistence must never interrupt native notification handling.
 try{if(manager.titleStore&&manager.saveState)manager.saveState(manager.titleStore+'.cli-observations.json',[...entries]);}catch{}
}

export function observeCliCommand(manager,method,params){
 if(method==='account/updated'){const entries=commandRecords(manager);entries.clear();saveCommands(manager,entries);return;}
 if(!['item/started','item/completed'].includes(method)||params?.item?.type!=='commandExecution')return;
 const entries=commandRecords(manager);
 const key=params.threadId+':'+params.item.id;
 if(method==='item/completed'){if(entries.delete(key))saveCommands(manager,entries);return;}
 if(cliTarget(params.item.command,manager.host?.binary)){
  if(entries.size>=1000)entries.delete(entries.keys().next().value);
  entries.set(key,{startedAt:Date.now()});saveCommands(manager,entries);
 }
}

export async function readCliActivity(manager,ids){
 const rpc=manager.rpc,generation=manager.generation,revision=manager.accountRevision||0;
 if(!rpc?.connected||!manager.host?.binary||!manager.controlled?.size)return new Map();
 const current=()=>manager.rpc===rpc&&manager.generation===generation&&(manager.accountRevision||0)===revision&&rpc.connected;
 // Share source discovery across concurrent detail and sidebar reads, without
 // retaining a settled liveness result or introducing a background poller.
 const candidates=await shareRead(manager,JSON.stringify(['cliProcesses',generation,revision]),async()=>{
  const found=[];const sources=[...manager.controlled.keys()];
  for(let offset=0;offset<sources.length&&current();offset+=4){
   await Promise.all(sources.slice(offset,offset+4).map(async source=>{
    try{
     const live=await readLiveStatus(manager,'thread/backgroundTerminals/list',{threadId:source,limit:100});
     const terminals=(live.data||[]).flatMap(t=>{const target=cliTarget(t.command,manager.host.binary);return target&&t.itemId&&t.processId?[{...t,target}]:[];});
     if(!terminals.length)return;
     const wanted=new Set(terminals.map(t=>t.itemId));const starts=new Map();let cursor;
     for(const terminal of terminals){const known=commandRecords(manager).get(source+':'+terminal.itemId);if(known){starts.set(terminal.itemId,known.startedAt);wanted.delete(terminal.itemId);}}
     for(let page=0;page<3&&wanted.size&&current();page++){
      const history=await rpc.request('thread/items/list',{threadId:source,limit:100,sortDirection:'desc',...(cursor?{cursor}:{})},{timeoutMs:5000});
      for(const row of history.data||[]){const item=row.item;if(wanted.has(item?.id)&&item.type==='commandExecution'&&item.status==='inProgress'&&Number.isFinite(row.startedAtMs)){starts.set(item.id,row.startedAtMs);wanted.delete(item.id);}}
      cursor=history.nextCursor;if(!cursor)break;
     }
     for(const terminal of terminals)if(starts.has(terminal.itemId))found.push({target:terminal.target,startedAt:starts.get(terminal.itemId)});
    }catch{/* Unavailable live evidence never becomes running. */}
   }));
  }
  return found;
 });
 const result=new Map();if(!current())return result;
 const targets=[...new Set(ids)].filter(id=>candidates.some(c=>c.target===id));
 if(!targets.length)return result;
 try{
  // Another engine normalizes foreign in-progress turns to interrupted.
  // Read the persisted turn only after native live process evidence exists.
  const page=await manager.passive('cliTurns',{threadIds:targets.slice(0,200)});
  for(const turn of page.data||[]){
   if(current()&&turn.status==='inProgress'&&Number.isFinite(turn.startedAt)&&candidates.some(c=>c.target===turn.threadId&&turn.startedAt>=Math.floor(c.startedAt/1000)))result.set(turn.threadId,{source:'cli',state:'running',observedAt:Date.now()});
  }
 }catch{/* A historical inProgress alone is not sufficient. */}
 return current()?result:new Map();
}
