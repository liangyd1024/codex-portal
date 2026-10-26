// Inject after mobile-browser.js. No file read or mutation reaches a real engine.
(()=>{
 const f=window.rcmFixture,prior=window.fetch;
 f.fileCalls=[];f.fileAborts=0;f.fileOffline=false;f.fileDelay=false;
 const links=[['文件夹','/test/project'],['代码引用','/test/project/source.ts:90:3'],['Markdown','/test/project/notes.md'],['长文件','/test/project/large.txt:999999'],['受限文件','/test/project/secrets/example.txt'],['不支持格式','/test/project/archive.zip']];
 f.turns.set('qa-a',[{id:'files-turn',status:'completed',items:[{id:'files-answer',type:'agentMessage',phase:'final_answer',text:links.map(([label,path])=>'['+label+']('+path+')').join('\n\n')}]}]);
 window.fetch=async(input,options={})=>{
  const u=new URL(typeof input==='string'?input:input.url,location.href);
  if(!u.pathname.endsWith('/file'))return prior(input,options);
  const mode=u.searchParams.get('mode'),reference=u.searchParams.get('reference');f.fileCalls.push({mode,reference});
  if(f.fileDelay)await new Promise((resolve,reject)=>{f.releaseFile=resolve;options.signal?.addEventListener('abort',()=>{f.fileAborts++;reject(new DOMException('Aborted','AbortError'));},{once:true});});
  if(f.fileOffline)throw Error('连接中断，请重试。');
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(reference==='/test/project')return json({error:{message:'这是文件夹，暂不支持在网页中浏览。可复制路径，在目标机器上打开。',retryable:false}},422);
  if(reference.includes('/secrets/'))return json({error:{message:'此文件属于受保护路径，不能通过网页读取。',retryable:false}},403);
  const large=reference.includes('large'),md=reference.endsWith('.md'),zip=reference.endsWith('.zip');
  const name=md?'notes.md':large?'large.txt':zip?'archive.zip':'source.ts';
  const line=large?999999:md||zip?undefined:90;
  const text=md?'# 阅读说明\n\n**加粗正文**与[外部链接](https://example.com)。\n\n<script>window.previewInjected=true</script>\n\n[危险链接](javascript:alert(1))\n\n| 名称 | 内容 |\n| --- | --- |\n| 示例 | 数据 |\n\n```ts\nconst sample = 1;\n```':large?'中\n'.repeat(250000):Array.from({length:120},(_,i)=>'const sample'+i+' = '+JSON.stringify('中文样例'+(i===89?'长行'.repeat(100):''))+';').join('\n');
  if(mode==='meta')return json({name,path:'/test/project/'+name,size:large?1100000:text.length*3,kind:zip?'download':'text',line,column:3});
  if(mode==='text')return json({text,truncated:large,line});
  return new Response(text,{headers:{'Content-Disposition':'attachment; filename="sample.txt"'}});
 };
})();
