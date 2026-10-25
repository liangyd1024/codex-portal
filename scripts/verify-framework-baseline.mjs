import {mkdtemp,readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function replaceOnce(source,from,to){
 if(source.split(from).length!==2)throw Error('接口测试入口已变化，请更新基准核验适配。');
 return source.replace(from,to);
}
export async function verifyFrameworkBaseline({revision,buildDir}){
 if(!revision||!buildDir||!path.isAbsolute(buildDir))throw Error('请指定基准提交及构建目录的绝对路径。');
 const commit=execFileSync('git',['rev-parse','--verify',revision+'^{commit}'],{cwd:root,encoding:'utf8'}).trim();
 const manifest=JSON.parse(await readFile(path.join(buildDir,'manifest.json'),'utf8'));
 if(path.resolve(manifest.output)!==path.resolve(buildDir))throw Error('构建清单与指定目录不一致。');
 const fingerprint=createHash('sha256');
 async function walk(directory){for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(directory,item.name);if(item.isDirectory())await walk(file);else{fingerprint.update(path.relative(buildDir,file));fingerprint.update(await readFile(file));}}}
 await walk(path.join(buildDir,'public'));await walk(path.join(buildDir,'server'));
 if(fingerprint.digest('hex')!==manifest.assetsHash)throw Error('构建资源与清单摘要不一致。');
 const evidence=await mkdtemp(path.join(tmpdir(),'rcm-http-baseline-'));
 const baseline=path.join(evidence,'baseline');await mkdir(baseline);
 const archive=execFileSync('git',['archive','--format=tar',commit],{cwd:root,maxBuffer:128*1024*1024});
 execFileSync('tar',['-xf','-','-C',baseline],{input:archive,maxBuffer:1024*1024});
 // Only the version fixture is normalized. Baseline application sources stay intact.
 await writeFile(path.join(baseline,'VERSION'),'fixture\n');
 const tests=[];
 for(const name of ['framework-http.test.mjs','framework-thread-view.test.mjs']){
  let source=await readFile(path.join(root,'test',name),'utf8');
  source=replaceOnce(source,"import {createApp} from './fixtures/legacy-server.mjs';",`import {createApp} from ${JSON.stringify(pathToFileURL(path.join(baseline,'server.mjs')).href)};`);
  source=replaceOnce(source,"import {MobileAccess} from '../lib/mobile-access.mjs';",`import {MobileAccess} from ${JSON.stringify(pathToFileURL(path.join(baseline,'lib/mobile-access.mjs')).href)};`);
  if(name==='framework-http.test.mjs'){
   source=replaceOnce(source,"const root=path.resolve(import.meta.dirname,'..');",`const root=${JSON.stringify(baseline)};`);
   source=replaceOnce(source,"path.join(root,'.framework-build/latest.json')",JSON.stringify(path.join(buildDir,'manifest.json')));
  }else source=replaceOnce(source,"new URL('../.framework-build/latest.json',import.meta.url)",JSON.stringify(path.join(buildDir,'manifest.json')));
  const file=path.join(evidence,name);await writeFile(file,source);tests.push(file);
 }
 const env={...process.env,RCM_STATE_DIR:path.join(evidence,'state')};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024,timeout:120000});
 await writeFile(path.join(evidence,'tests.log'),(result.stdout||'')+(result.stderr||''));
 const record={at:new Date().toISOString(),baseline:commit,candidate:manifest.version,assetsHash:manifest.assetsHash,
  baselineServerSha256:createHash('sha256').update(await readFile(path.join(baseline,'server.mjs'))).digest('hex'),
  testFiles:tests.map(file=>path.basename(file)),exitCode:result.status,error:result.error?.message||null};
 await writeFile(path.join(evidence,'result.json'),JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify({...record,evidence},null,2));
 if(result.error)throw result.error;
 return result.status??1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await verifyFrameworkBaseline({revision:process.argv[2],buildDir:process.argv[3]});}
 catch(error){console.error(error.message);process.exitCode=1;}
}
