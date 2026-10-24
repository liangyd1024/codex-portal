// Keep large tool results out of collapsed DOM and render signatures.
export function installDeferredTool({details,body,load,render,isCurrent=()=>true}) {
  let loaded=false,pending=false;
  async function reveal(){
    if(!details.open||loaded||pending||!isCurrent())return;
    pending=true;details.setAttribute('aria-busy','true');
    try{
      const item=await load();
      if(!isCurrent()||!details.isConnected)return;
      body.replaceChildren();render(item,body);loaded=true;
    }catch{
      if(!isCurrent()||!details.isConnected)return;
      const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent='读取失败，点击重试';button.onclick=reveal;body.replaceChildren(button);
    }finally{pending=false;details.removeAttribute('aria-busy');}
  }
  details.ontoggle=reveal;
  return reveal;
}
