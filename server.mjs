import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
let compiled;
async function application(){
 if(!compiled)compiled=(async()=>{
  let manifest,output,installed=false;
  try{manifest=JSON.parse(await readFile(path.join(root,'../release.json'),'utf8'));output=path.resolve(root,'..');installed=true;}catch(error){if(error.code!=='ENOENT')throw error;manifest=JSON.parse(await readFile(path.join(root,'.framework-build/latest.json'),'utf8'));output=manifest.output;}
  const version=installed?manifest.version:undefined;
  const module=await import(pathToFileURL(path.join(output,'server/application.mjs')).href);
  const staticRoot=path.join(output,'public'),extraAssets={};
  async function assets(directory,prefix=''){for(const entry of await readdir(directory,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())await assets(path.join(directory,entry.name),relative+'/');else extraAssets['/'+relative]=relative;}}
  await assets(staticRoot);return {module,staticRoot,extraAssets,version,installed};
 })();
 return compiled;
}
// Existing JavaScript tooling loads the built application, never the old HTTP implementation.
export async function createApp(options={}){
 const {module,staticRoot,extraAssets,version,installed}=await application();
 const runtime=installed?{buildVersion:version,updater:new module.WebUpdate({supportDir:(await import('./lib/config.mjs')).supportDir,root,version})}:{};
 return module.createFrameworkApp({staticRoot,extraAssets,...runtime,...options});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {installed}=await application();
 if(installed){
  if(process.env.RCM_PORT&&process.env.RCM_PORT!=='4317')throw Error('正式网页端口固定为 4317。');
  await (await import('./lib/start-web.mjs')).startWeb({createApp,root});
 }else{
  if(process.env.RCM_PORT&&process.env.RCM_PORT!=='4327')throw Error('源码入口仅启动 4327 预览；正式服务请使用显式部署命令。');
  await import('./scripts/start-preview.mjs');
 }
}
