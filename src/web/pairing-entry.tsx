import {useLayoutEffect,useRef} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
import {createPairingController,initialPairingView} from './services/pairing';
const store=createStore(()=>({...initialPairingView}));
function PairingPage(){
 const view=useStore(store),input=useRef<HTMLInputElement>(null),controller=useRef<ReturnType<typeof createPairingController>|null>(null);
 useLayoutEffect(()=>{
  controller.current=createPairingController({input:input.current!,publish:patch=>{if(Object.entries(patch).some(([key,value])=>store.getState()[key as keyof typeof view]!==value))flushSync(()=>store.setState(patch));},fetch:window.fetch.bind(window),reload:()=>location.reload(),document,window});
  return controller.current.start();
 },[]);
 return <><h1>连接 Codex Portal</h1><p>首次访问时，在 Mac 工作台的“手机访问”中生成配对码。已配对设备将自动进入。</p><form id="pair-form" hidden={view.formHidden} aria-busy={view.busy===undefined?undefined:String(view.busy) as 'true'|'false'} onSubmit={event=>void controller.current?.submit(event)}><label htmlFor="pair-code">六位配对码</label><input ref={input} id="pair-code" aria-describedby="pair-status" enterKeyHint="go" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required onInput={()=>controller.current?.inputChanged()} onPaste={event=>controller.current?.paste(event)}/><button className="primary-button" disabled={view.pending}>{view.button}</button></form><p id="pair-status" role="status">{view.status}</p><button id="pair-retry" className="secondary-button" type="button" hidden={view.retryHidden} onClick={()=>void controller.current?.restoreLogin()}>重新检查连接</button><p>重启或升级工作台不会清除手机登录。请使用原来的访问地址和浏览器；登录有效期由本机配对时设置。</p><p><a href="">重新加载页面</a></p><noscript>请启用 JavaScript 后重新加载页面。</noscript></>;
}
const main=document.querySelector('main.pairing-page');
if(!main)throw Error('配对页面结构缺失。');
hydrateRoot(main,<PairingPage/>);
