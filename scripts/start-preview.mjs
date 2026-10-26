import {readFile,readdir,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {createPreviewMobileSetup} from '../lib/preview-mobile.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const build=JSON.parse(await readFile(path.join(root,'.framework-build/latest.json'),'utf8'));
const stateRoot=process.env.RCM_PREVIEW_ROOT||await mkdtemp(path.join(tmpdir(),'rcm-framework-preview-'));
if(!path.isAbsolute(stateRoot))throw Error('验收状态目录必须为绝对路径。');
await mkdir(stateRoot,{recursive:true,mode:0o700});
const marker=path.join(stateRoot,'preview-owner.json');
try{if(JSON.parse(await readFile(marker,'utf8')).purpose!=='rcm-framework-preview')throw Error('不是本次验收的状态目录。');}catch(error){if(error.code!=='ENOENT')throw error;if((await readdir(stateRoot)).length)throw Error('不能复用非空目录作为新验收状态目录。');await writeFile(marker,JSON.stringify({purpose:'rcm-framework-preview'}),{mode:0o600});}
const support=path.join(stateRoot,'support'),state=path.join(stateRoot,'state'),mobile=path.join(support,'mobile');
await mkdir(mobile,{recursive:true,mode:0o700});await mkdir(state,{recursive:true,mode:0o700});
await mkdir(path.join(stateRoot,'logs'),{recursive:true,mode:0o700});
const {createWriteStream}=await import('node:fs');
const log=createWriteStream(path.join(stateRoot,'logs','preview-'+Date.now()+'.log'),{flags:'a',mode:0o600});
for(const output of [process.stdout,process.stderr]){const write=output.write.bind(output);output.write=(chunk,...args)=>{log.write(chunk);return write(chunk,...args);};}
const {createFrameworkApp,PreviewMobileAccess,WebUpdate}=await import(pathToFileURL(path.join(build.output,'server/application.mjs')).href);
const staticRoot=path.join(build.output,'public'),extraAssets={};
async function assets(directory,prefix=''){for(const entry of await readdir(directory,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())await assets(path.join(directory,entry.name),relative+'/');else extraAssets['/'+relative]=relative;}}
await assets(staticRoot);
const access=new PreviewMobileAccess(path.join(mobile,'sessions.json'));
const updater=new WebUpdate({supportDir:support,root:build.output,version:build.version});
const liveConfig=loadConfig();
const configFile=path.join(stateRoot,'connections.json');await writeFile(configFile,JSON.stringify(liveConfig,null,2),{mode:0o600});
let mobileSetup;
const mobileEnabled=process.argv.includes('--mobile');
const app=await createFrameworkApp({config:liveConfig,connectionConfigFile:configFile,stateDir:state,staticRoot,extraAssets,buildVersion:build.version,access,updater,
 setupMobile:mobileEnabled?mode=>mobileSetup(mode):null});
const listen=(server,port,host)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
await listen(app.server,4327,'127.0.0.1');
let secure;
if(mobileEnabled){
 mobileSetup=createPreviewMobileSetup({directory:mobile,root,app,listen});
 await mobileSetup('lan');secure=true;
}
await writeFile(path.join(root,'.framework-build/preview.json'),JSON.stringify({pid:process.pid,stateRoot,build:build.output,version:build.version,ports:[4327,...(secure?[4338,4339]:[])]},null,2),{mode:0o600});
console.log('验收服务已启动：4327'+(secure?' / 4338 / 4339':''));
let closing=false;async function close(){if(closing)return;closing=true;await app.close();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
