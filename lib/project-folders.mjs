import path from 'node:path';
import {AppError} from './manager.mjs';
const absolute=value=>{
  if(typeof value!=='string'||!value.startsWith('/')||/[\0\r\n]/.test(value)||value.length>4096)throw new AppError('请选择目标机器上的绝对路径。');
  return path.posix.normalize(value).replace(/\/$/,'')||'/';
};
export function folderName(value){
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value==='.'||value==='..'||/[\\/\0\r\n]/.test(value)||Buffer.byteLength(value)>255)throw new AppError('文件夹名称不能为空，不能包含路径分隔符、首尾空格或超过 255 字节。');
  return value;
}
function session(manager){
  manager.requireConnected();
  if(manager.service.protocolValidation?.features?.projectFolders?.supported!==true)throw new AppError('当前连接尚未验证目录与项目接口，请重新连接后重试。',409,'FEATURE_UNAVAILABLE');
  const rpc=manager.rpc,generation=manager.generation;
  const current=()=>{manager.requireConnected();if(manager.rpc!==rpc||manager.generation!==generation)throw new AppError('连接已变化，请重新浏览目标目录。',409,'CONNECTION_CHANGED');};
  return async(method,params,mutation=false)=>{
    current();let result;
    try{result=await rpc.request(method,params,{timeoutMs:15000});}
    catch(error){if(mutation&&(error.code==='RPC_TIMEOUT'||!rpc.connected))throw new AppError('操作结果尚未确认。请刷新目录或用原请求重试项目登记，不要另建同名项目。',502,'OUTCOME_UNKNOWN');throw error;}
    current();return result;
  };
}
export async function browseFolders(manager,input){
  const request=session(manager),cwd=absolute(input||manager.host.home);
  const meta=await request('fs/getMetadata',{path:cwd});
  if(!meta.isDirectory)throw new AppError('所选路径不是文件夹。');
  const result=await request('fs/readDirectory',{path:cwd});
  if(!Array.isArray(result.entries))throw new AppError('目标机器返回的目录格式无效。',502);
  return {path:cwd,parent:cwd==='/'?null:path.posix.dirname(cwd),hostName:manager.host.alias,entries:result.entries.filter(e=>e.isDirectory&&typeof e.fileName==='string'&&e.fileName!=='.'&&e.fileName!=='..'&&!/[\/\0]/.test(e.fileName)).map(e=>({name:e.fileName,path:path.posix.join(cwd,e.fileName)})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))};
}
async function mutate(manager,work){
  manager.requireWritable();
  if(manager.projectFolderMutation)throw new AppError('正在处理目录或项目，请稍候。',409,'PROJECT_BUSY');
  manager.projectFolderMutation=true;
  try{return await manager.withMutation(()=>work(session(manager)));}finally{manager.projectFolderMutation=false;}
}
export async function createFolder(manager,{parent,name}={}){
  const cwd=absolute(parent),child=path.posix.join(cwd,folderName(name));
  return mutate(manager,async request=>{
    const meta=await request('fs/getMetadata',{path:cwd});
    if(!meta.isDirectory)throw new AppError('父路径不是文件夹。');
    await request('fs/createDirectory',{path:child,recursive:false},true);
    return {path:child};
  });
}
export async function openFolderProject(manager,{path:input,idempotencyKey}={}){
  const cwd=absolute(input);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey||''))throw new AppError('项目请求标识无效。');
  return mutate(manager,async request=>{
    if(!(await request('fs/getMetadata',{path:cwd})).isDirectory)throw new AppError('所选路径不是文件夹。');
    let cursor=null,project;const cursors=new Set();
    do{
      const page=await request('project/list',{cursor,limit:100});
      if(!Array.isArray(page.data))throw new AppError('目标机器返回的项目格式无效。',502);
      project=page.data.find(p=>p.roots?.some(r=>r.path===cwd));
      cursor=page.nextCursor;
      if(cursor&&cursors.has(cursor))throw new AppError('项目列表分页异常，请重连后重试。',502);
      cursors.add(cursor);
    }while(!project&&cursor);
    const existing=Boolean(project);
    if(!project)({project}=await request('project/create',{idempotencyKey,name:path.posix.basename(cwd)||'根目录',roots:[{path:cwd}]},true));
    if(!project?.id||!project.roots?.some(r=>r.path===cwd))throw new AppError('项目回执与所选目录不符，请刷新列表核对。',502,'OUTCOME_UNKNOWN');
    const item={id:project.id,name:project.name,roots:project.roots.map(r=>r.path)};
    manager.projects=[...(manager.projects||[]).filter(p=>p.id!==item.id),item];
    manager.publish('manager/sidebarChanged',{action:'projectCreated',projectId:item.id});
    return {project:item,existing};
  });
}
