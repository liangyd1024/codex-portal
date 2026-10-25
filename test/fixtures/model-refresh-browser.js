// Isolated catalog variants. No model configuration or native messages are changed.
(()=>{
 const f=window.rcmFixture,previous=window.fetch;let mode='normal';
 const catalogs={
 normal:[{id:'qa-model',model:'qa-model',displayName:'验收模型',isDefault:true,supportedReasoningEfforts:['low','medium','high'],defaultReasoningEffort:'medium'},{id:'qa-other',model:'qa-other',displayName:'另一模型',supportedReasoningEfforts:['low','high'],defaultReasoningEffort:'low'}],
 removed:[{id:'qa-replacement',model:'qa-replacement',displayName:'替代模型',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'high',description:'完整说明 <tag>'}],defaultReasoningEffort:'high'}],
 noeffort:[{id:'qa-model',model:'qa-model',displayName:'无档位模型',isDefault:true,supportedReasoningEfforts:[]}],empty:[]};
 catalogs.renamed=catalogs.normal.map(model=>({...model,displayName:'更新后的 '+model.displayName,description:'模型说明 <tag>',supportedReasoningEfforts:model.supportedReasoningEfforts.map(effort=>({reasoningEffort:effort,description:'档位说明 '+effort}))}));
 catalogs.reordered=[...catalogs.renamed].reverse().map(model=>({...model,supportedReasoningEfforts:[...model.supportedReasoningEfforts].reverse()}));
 window.fetch=async(url,options)=>{
  const response=await previous(url,options),u=new URL(typeof url==='string'?url:url.url,location.href);
  if(u.pathname!=='/api/models'||!response.ok)return response;
  return new Response(JSON.stringify({data:catalogs[mode]}),{headers:{'Content-Type':'application/json'}});
 };
 addEventListener('rcm-ready',()=>{
  const panel=document.createElement('details');panel.style.cssText='position:fixed;right:4px;top:56px;z-index:100000;background:white;border:1px solid black';const title=document.createElement('summary');title.textContent='模型目录验收';panel.append(title);
  for(const [key,label] of [['normal','恢复模型'],['renamed','更新名称说明'],['reordered','调整选项顺序'],['removed','替换模型'],['noeffort','清空档位'],['empty','清空模型']]){const b=document.createElement('button');b.textContent=label;b.style.minHeight='44px';b.onclick=()=>{mode=key;panel.open=false;};panel.append(b);}
  document.body.append(panel);
 });
})();
