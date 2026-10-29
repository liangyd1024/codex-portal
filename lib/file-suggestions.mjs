import path from 'node:path';
import {AppError} from './core/errors.mjs';

// Search on the connected target, including SSH targets; never scan the portal host.
export async function fileSuggestions(manager,cwd,query='') {
  manager.requireConnected();
  if(typeof cwd!=='string'||!path.posix.isAbsolute(cwd)||cwd.includes('\0'))throw new AppError('请选择项目。');
  if(typeof query!=='string'||query.length>256||query.includes('\0'))throw new AppError('文件搜索内容无效。');
  if(!query.trim())return {data:[]};
  const rpc=manager.rpc,generation=manager.generation;
  const result=await rpc.request('fuzzyFileSearch',{query,roots:[cwd],cancellationToken:null},{timeoutMs:10000});
  if(manager.rpc!==rpc||manager.generation!==generation)throw new AppError('连接已变化，请重新搜索。');
  const root=path.posix.resolve(cwd),seen=new Set();
  return {data:(result.files||[]).flatMap(file=>{
    if(!['file','directory'].includes(file.match_type)||typeof file.path!=='string'||file.root!==cwd)return [];
    const absolute=path.posix.resolve(root,file.path),relative=path.posix.relative(root,absolute);
    if(!relative||relative.startsWith('../')||path.posix.isAbsolute(relative)||relative.split('/').includes('.git')||seen.has(absolute))return [];
    seen.add(absolute);
    return [{path:absolute+(file.match_type==='directory'?'/':''),name:file.file_name||path.posix.basename(absolute),description:relative,mentionKind:'files',matchType:file.match_type}];
  }).slice(0,50)};
}
