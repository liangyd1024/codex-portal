import {createStore,useStore} from 'zustand';
import {flushSync} from 'react-dom';
import {installAccountUsage as installReader,type AccountView,type AccountLabel} from '../services/account-usage';
const store=createStore<AccountView & {details:((text:string)=>void)|null}>(()=>({usage:{hidden:true,text:''},identity:{hidden:true,text:''},details:null}));
const sameLabel=(a:AccountLabel,b:AccountLabel)=>a.hidden===b.hidden&&a.text===b.text&&a.title===b.title&&a.ariaLabel===b.ariaLabel;
function publish(view:AccountView){
 const previous=store.getState();
 const usage=sameLabel(previous.usage,view.usage)?previous.usage:view.usage;
 const identity=sameLabel(previous.identity,view.identity)?previous.identity:view.identity;
 if(usage===previous.usage&&identity===previous.identity)return;
 flushSync(()=>store.setState({usage,identity}));
}
export function installAccountUsage({details,...deps}:Omit<Parameters<typeof installReader>[0],'publish'> & {details:(text:string)=>void}){
 flushSync(()=>store.setState({details}));
 return installReader({...deps,publish});
}
export function AccountUsage(){
 const view=useStore(store,state=>state.usage);
 return <button type="button" id="account-usage" className="account-usage" hidden={view.hidden} title={view.title} aria-label={view.ariaLabel} onClick={()=>store.getState().details?.(view.title||'')}>{view.text}</button>;
}
export function AccountIdentity(){
 const view=useStore(store,state=>state.identity);
 return <div id="account-identity" className="account-identity" role="status" hidden={view.hidden} title={view.title} aria-label={view.ariaLabel}>{view.text}</div>;
}
