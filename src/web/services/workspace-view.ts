type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
interface View {selectedId?:string|null;projectId?:string|null;desktopMode?:boolean}
export function readWorkspaceView(session:Storage,persistent:Storage,host:string,standalone:boolean):View {
 try{const current=session.getItem('rcm.view.'+host);if(current)return JSON.parse(current);}catch{}
 if(standalone)try{return JSON.parse(persistent.getItem('rcm.app-view.'+host)||'{}');}catch{}
 return {};
}
export function saveWorkspaceView(session:Storage,persistent:Storage,host:string,standalone:boolean,view:View){
 const value=JSON.stringify(view);
 try{session.setItem('rcm.view.'+host,value);}catch{}
 if(standalone)try{persistent.setItem('rcm.app-view.'+host,value);}catch{}
}
