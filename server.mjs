import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
let compiled;
async function application(){
 if(!compiled)compiled=(async()=>{
  const manifest=JSON.parse(await readFile(path.join(root,'.framework-build/latest.json'),'utf8'));
  const module=await import(pathToFileURL(path.join(manifest.output,'server/application.mjs')).href);
  const staticRoot=path.join(manifest.output,'public'),extraAssets={};
  async function assets(directory,prefix=''){for(const entry of await readdir(directory,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())await assets(path.join(directory,entry.name),relative+'/');else extraAssets['/'+relative]=relative;}}
  await assets(staticRoot);return {module,staticRoot,extraAssets};
 })();
 return compiled;
}
// Existing JavaScript tooling loads the built application, never the old HTTP implementation.
export async function createApp(options={}){
 const {module,staticRoot,extraAssets}=await application();
 return module.createFrameworkApp({staticRoot,extraAssets,...options});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.RCM_PORT&&process.env.RCM_PORT!=='4327')throw Error('框架迁移分支仅供 4327 验收，不可部署正式服务。');
 await import('./scripts/start-preview.mjs');
}
