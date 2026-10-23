// Static-only comparison entrances. No Manager, transport or engine is instantiated.
import http from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createStaticResponse} from '../lib/http/static-response.mjs';
const root=path.resolve(import.meta.dirname,'..');
const baseline=execFileSync('git',['rev-parse',process.argv[2]||'master'],{cwd:root,encoding:'utf8'}).trim();
const build=JSON.parse(await readFile(path.join(root,'.framework-build/latest.json'),'utf8'));
const evidence=await mkdtemp(path.join(tmpdir(),'rcm-parity-'));
const baselineRoot=path.join(evidence,'baseline');
const files=execFileSync('git',['ls-tree','-r','--name-only',baseline,'--','public','shared'],{cwd:root,encoding:'utf8'}).trim().split('\n');
for(const file of files){const destination=path.join(baselineRoot,file);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,execFileSync('git',['show',baseline+':'+file],{cwd:root,maxBuffer:8*1024*1024}));}
const fixture=await readFile(path.join(root,'test/fixtures/mobile-browser.js'),'utf8')+'\n'+await readFile(path.join(root,'test/fixtures/parity-controls.js'),'utf8');
const extras=['maintenance-browser.js','diagnostics-browser.js','performance-browser.js','goal-status-browser.js','questions-browser.js','question-attention-browser.js','desktop-mentions-browser.js','web-mentions-browser.js','turn-files-browser.js','turn-navigation-browser.js'];
const servers=[];
async function serve(directory){
 const staticResponse=createStaticResponse();const index=(await readFile(path.join(directory,'public/index.html'),'utf8')).replace('</head>','<script src="/__parity_fixture.js"></script></head>');
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');const p=url.pathname;
  res.setHeader('Cache-Control','no-store');
  if(p.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Fixture interception missing. Real APIs are unavailable.'}}));return;}
  if(p==='/__parity_fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture+"\nwindow.addEventListener('rcm-ready',()=>window.rcmParityReady=true);\n");return;}
  if(p.startsWith('/__fixtures/')){const name=p.slice('/__fixtures/'.length);if(!extras.includes(name)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.join(root,'test/fixtures',name)));return;}
  if(p==='/'||p==='/index.html'){const scenario=url.searchParams.get('scenario');if(scenario&&!extras.includes(scenario)){res.writeHead(400);res.end('Unknown fixture scenario');return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(scenario?index.replace('</head>','<script src="/__fixtures/'+scenario+'"></script></head>'):index);return;}
  const relative=p.startsWith('/shared/')?p.slice(1):'public'+p;
  const file=path.resolve(directory,relative);if(!file.startsWith(directory+path.sep)){res.writeHead(404);res.end();return;}
  await staticResponse(req,res,file);
 }catch(error){if(res.headersSent)res.destroy();else{res.writeHead(404);res.end('Not found');}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);return 'http://127.0.0.1:'+server.address().port;
}
const record={pid:process.pid,baseline,preview:{version:build.version,dirty:build.dirty,assetsHash:build.assetsHash},evidence,baselineUrl:await serve(baselineRoot),previewUrl:await serve(build.output)};
await writeFile(path.join(root,'.framework-build/parity.json'),JSON.stringify(record,null,2),{mode:0o600});
console.log(JSON.stringify(record));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const server of servers){server.closeAllConnections();server.close();}});
