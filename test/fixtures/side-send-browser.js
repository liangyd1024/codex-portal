// Component acceptance fixture. API calls stay in memory; no native mutations.
export async function setupSideSend({installSideChat}) {
 document.body.innerHTML='<main class="main-panel" style="height:100dvh"><div class="composer-region"><textarea id="message-input"></textarea></div></main>';
 const f=window.sideSendFixture={calls:[],pending:[],parent:'parent-a',ready:true};
 f.chat=installSideChat({
  context:()=>({id:f.parent,cwd:'/test',ready:f.ready,model:'test-model',effort:'medium',models:[{id:'test-model',label:'测试模型',efforts:['medium']}]}),
  api:async(path,options)=>{f.calls.push({path,options});if(path.endsWith('/side-chat'))return {thread:{id:'side-'+f.parent}};if(path==='/api/composer')return {modes:{data:[]},skills:{data:[]},plugins:{marketplaces:[]}};if(/\/(message|steer)$/.test(path))return new Promise((resolve,reject)=>f.pending.push({resolve,reject,body:options.body}));return {};},
  renderItem:item=>{const node=document.createElement('div');node.className='message user';const bubble=document.createElement('div');bubble.className='user-bubble';const text=document.createElement('div');text.className='user-message-text';text.textContent=(item.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');bubble.append(text);node.append(bubble);return node;},
  notify:()=>{},
 });
 await f.chat.open({text:'测试选文'});
 f.input=()=>document.querySelector('[aria-label="侧边聊天消息"]');
 f.send=text=>{f.input().value=text;f.input().dispatchEvent(new Event('input',{bubbles:true}));const start=performance.now();f.input().form.requestSubmit();return {ms:performance.now()-start,receipt:document.querySelector('[data-send-receipt]')?.textContent};};
 f.native=(id='native',turnId='turn-a')=>{const body=f.pending.at(-1).body;f.chat.event('item/completed',{threadId:f.chat.id,turnId,item:{id,type:'userMessage',content:[{type:'text',text:body.text}]}});};
 f.paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 return true;
}
