import {Fragment} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface Range {start:number;end:number}
interface View {text:string;ranges:Range[]}
interface Instance {id:number;mirror:HTMLElement;store:StoreApi<{view:View|null}>}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function Mirror({mirror,store}:Instance){
 const v=useStore(store).view;if(!v)return null;
 let offset=0;
 const parts=v.ranges.map((range,index)=>{const before=v.text.slice(offset,range.start),token=v.text.slice(range.start,range.end);offset=range.end;return <Fragment key={index}>{before}<span className="inline-mention">{token}</span></Fragment>;});
 return createPortal(<>{parts}{v.text.slice(offset)+'\n'}</>,mirror);
}
export function InlineMentions(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Mirror key={instance.id} {...instance}/>)}</>;}
export function installReactInlineMentionView(mirror:HTMLElement){
 const store=createStore<{view:View|null}>(()=>({view:null}));
 const instance={id:++sequence,mirror,store};let registered=false;
 // Before the first render this portal has no content or DOM-dependent setup.
 // Register with its initial value in one commit; later renders stay synchronous.
 return {render:(text:string,ranges:Range[])=>flushSync(()=>{
  store.setState({view:{text,ranges}});
  if(!registered){registered=true;registry.setState({instances:[...registry.getState().instances,instance]});}
 })};
}
