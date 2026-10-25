import {mkdir,mkdtemp,readFile,writeFile,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {typecheck} from './typecheck.mjs';
export async function buildFramework(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 if(typecheck({root})!==0)throw Error('类型检查未通过。');
 const parent=path.join(root,'.framework-build');await mkdir(parent,{recursive:true});
 const output=await mkdtemp(path.join(parent,'release-'));
 await build({configFile:false,root,publicDir:false,plugins:[{name:'rcm-shared',resolveId(id,importer){if(id.startsWith('./shared/')&&importer?.startsWith(path.join(root,'public')))return path.join(root,id.slice(2));}},react()],build:{target:['es2022','safari16'],outDir:path.join(output,'public'),emptyOutDir:false,minify:true,
  rollupOptions:{input:path.join(root,'src/web/entry.tsx'),output:{entryFileNames:'framework.js',chunkFileNames:'chunks/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});
 // Build the typed server without bundling Node libraries or native adapters.
 await build({configFile:false,root,publicDir:false,build:{ssr:path.join(root,'src/server/application.ts'),target:'node22',outDir:path.join(output,'server'),emptyOutDir:false,minify:false,
  rollupOptions:{external:id=>id.includes('/lib/')&&id.endsWith('.mjs'),output:{entryFileNames:'application.mjs',paths:id=>id.includes('/lib/')?'../runtime/lib/'+id.split('/lib/').at(-1):id}}}});
 await mkdir(path.join(output,'runtime'),{recursive:true});
 for(const name of ['lib','scripts','shared','public','server.mjs','package.json'])await cp(path.join(root,name),path.join(output,'runtime',name),{recursive:true});
 for(const name of await readdir(path.join(root,'public'))){if(name.endsWith('.css')||name.endsWith('.js')||['mermaid-frame.html','index.html','bootstrap.js','login.html','login.js','notification-worker.js','manifest.webmanifest'].includes(name))await cp(path.join(root,'public',name),path.join(output,'public',name));}
 // Pairing is reachable before authentication. Keep it a self-contained classic
 // script: unauthenticated clients cannot fetch workspace chunks.
 await build({configFile:false,root,publicDir:false,plugins:[react()],build:{target:['es2022','safari16'],outDir:path.join(output,'public'),emptyOutDir:false,minify:true,
  lib:{entry:path.join(root,'src/web/pairing-entry.tsx'),formats:['iife'],name:'RCMPairing',fileName:()=> 'login.js'},rollupOptions:{output:{inlineDynamicImports:true}}}});
 await mkdir(path.join(output,'public/vendor'),{recursive:true});
 await cp(path.join(root,'public/vendor/mermaid-12.2.0.js'),path.join(output,'public/vendor/mermaid-12.2.0.js'));
 await cp(path.join(root,'shared'),path.join(output,'shared'),{recursive:true});
 await writeFile(path.join(output,'public/app.js'),"import './framework.js';\n");
 let html=await readFile(path.join(output,'public/index.html'),'utf8');
 html=html.replace('href="/app.js"','href="/framework.js"').replace('<script type="module" src="/project-picker.js"></script>','');
 await writeFile(path.join(output,'public/index.html'),html);
 const bootstrap=(await readFile(path.join(root,'public/bootstrap.js'),'utf8')).replace("import('./app.js')","import('./framework.js')");
 await writeFile(path.join(output,'public/bootstrap.js'),bootstrap);
 const version=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
 const dirty=Boolean(spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).stdout.trim());
 const assetsHash=createHash('sha256');async function fingerprint(directory){for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(directory,item.name);if(item.isDirectory())await fingerprint(file);else{assetsHash.update(path.relative(output,file));assetsHash.update(await readFile(file));}}}await fingerprint(path.join(output,'public'));await fingerprint(path.join(output,'server'));
 const manifest={version,dirty,assetsHash:assetsHash.digest('hex'),baseline:'1a149a73744c802c6e2bee937d55a983c636dc65',createdAt:new Date().toISOString(),output};
 await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await writeFile(path.join(parent,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log('构建完成：'+output);return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildFramework();
