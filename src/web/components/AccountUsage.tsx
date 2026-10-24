import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
import {installAccountUsage as installReader,type AccountView} from '../services/account-usage';
const store=createStore<AccountView & {details:((text:string)=>void)|null}>(()=>({usage:{hidden:true,text:''},identity:{hidden:true,text:''},details:null}));
export function installAccountUsage({details,...deps}:Omit<Parameters<typeof installReader>[0],'publish'> & {details:(text:string)=>void}){
 flushSync(()=>store.setState({details}));
 return installReader({...deps,publish:view=>flushSync(()=>store.setState(view))});
}
export function AccountUsage(){
 const view=useStore(store,state=>state.usage);
 return <button type="button" id="account-usage" className="account-usage" hidden={view.hidden} title={view.title} aria-label={view.ariaLabel} onClick={()=>store.getState().details?.(view.title||'')}>{view.text}</button>;
}
export function AccountIdentity(){
 const view=useStore(store,state=>state.identity);
 return <div id="account-identity" className="account-identity" role="status" hidden={view.hidden} title={view.title} aria-label={view.ariaLabel}>{view.text}</div>;
}
