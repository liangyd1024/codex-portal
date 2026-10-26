interface NotificationTarget {host?:string;threadId:string;[field:string]:unknown}
type InspectorView='settings'|'mobile';
type RefreshUsage=(force?:boolean)=>Promise<unknown>;
interface Elements {'messages':HTMLElement;'inspector':HTMLElement;'app-shell':HTMLElement}
interface Dependencies {
 state:{csrf:string;selectedId:string|null;selectionVersion:number;loadingThreads:boolean;status?:{instanceId?:string;connection?:{connectedAt?:string|number|null}}|null};
 sidebar:{menu?:unknown;dialog?:unknown;drag?:unknown;pending?:unknown};
 document:Pick<Document,'hidden'>;location:Pick<Location,'href'>;sessionStorage:Pick<Storage,'setItem'>;
 element:<K extends keyof Elements>(id:K)=>Elements[K];setInterval:(run:()=>void,ms:number)=>unknown;
 targetHost:string;requestedHost:string|null;
 installSettings:()=>{open:()=>unknown};installAccess:()=>Promise<unknown>;showMobileError:(error:unknown)=>void;
 installUsage:(options:{details:(text:string)=>void;context:()=>string})=>RefreshUsage;showUsageDetails:(text:string)=>void;
 installBackup:(imported:()=>void)=>void;suspendDraftWrites:()=>void;
 installNavigation:(select:(view:InspectorView)=>void)=>(view:InspectorView)=>void;
 renderControls:()=>void;renderThreads:()=>void;renderStatus:()=>void;renderThread:()=>void;
 connected:()=>boolean;connectionPending:()=>boolean;loadThreads:()=>unknown;
 wireEvents:()=>void;setupEvents:()=>void;dispatchReady:()=>void;setNavigationReady:()=>void;
 pendingNotification:()=>NotificationTarget|null;clearPendingNotification:()=>void;
 openNotificationThread:(notification:NotificationTarget)=>unknown;restoreDetail:(id:string,selection:number)=>unknown;
 readCsrf:()=>Promise<{token:string}>;loadStatus:()=>Promise<unknown>;refreshWorkspace:(force:boolean,ready:boolean)=>Promise<unknown>;connectRemote:()=>Promise<unknown>;
 recordError:(error:unknown,stage:string)=>void;messageOf:(error:unknown)=>string;
 publishConnectionBanner:(view:{hidden:boolean;className:string;text:string})=>void;finishStarting:()=>void;
}
export function createWorkspaceStartup(d:Dependencies){
 const {state,sidebar,document,location,sessionStorage,element:$,setInterval,targetHost,requestedHost,installSettings,installAccess,showMobileError,installUsage,showUsageDetails,installBackup,suspendDraftWrites,installNavigation,renderControls,renderThreads,renderStatus,renderThread,connected,connectionPending,loadThreads,wireEvents,setupEvents,dispatchReady,setNavigationReady,pendingNotification,clearPendingNotification,openNotificationThread,restoreDetail,readCsrf,loadStatus,refreshWorkspace,connectRemote,recordError,messageOf,publishConnectionBanner,finishStarting}=d;
 return async function init(){
  let systemUpdate:{open:()=>unknown}|null=null,mobileInstalled=false;
  const loadSettings=()=>{systemUpdate??=installSettings();void systemUpdate.open();};
  const loadMobile=()=>{if(mobileInstalled)return;mobileInstalled=true;installAccess().catch(showMobileError);};
  const refreshAccountUsage=installUsage({details:showUsageDetails,context:()=>targetHost+':'+state.status?.instanceId+':'+state.status?.connection?.connectedAt});
  void refreshAccountUsage();
  setInterval(()=>{if(!document.hidden)void refreshAccountUsage();},15000);
  setInterval(()=>{if(document.hidden)return;renderControls();if(!sidebar.menu&&!sidebar.dialog&&!sidebar.drag)renderThreads();},5000);
  setInterval(()=>{if(connected()&&!state.loadingThreads&&!sidebar.pending&&!sidebar.drag&&!sidebar.menu&&!sidebar.dialog&&!document.hidden)loadThreads();},15000);
  $('messages').addEventListener('click',e=>{
    const summary=(e.target as Element).closest('summary');if(!summary)return;
    const detail=summary.closest<HTMLDetailsElement>('details[data-item-id]');if(!detail)return;
    const ids=new Set([...$('messages').querySelectorAll<HTMLDetailsElement>('details[open][data-item-id]')].map(n=>n.dataset.itemId));
    if(detail.open)ids.delete(detail.dataset.itemId);else ids.add(detail.dataset.itemId);
    try{sessionStorage.setItem('rcm.openDetails.'+targetHost+'.'+state.selectedId,JSON.stringify([...ids]));}catch{}
  });
  installBackup(suspendDraftWrites);
  const inspector=$('inspector');
  const selectInspectorView=installNavigation(showInspectorView);
  const groups=[...inspector.querySelectorAll<HTMLDetailsElement>(':scope > details')];
  const category=(group:HTMLDetailsElement)=>group.id==='mobile-access'?'mobile':'settings';
  groups.forEach(group=>{group.open=group.id!=='diagnostics'&&group.id!=='browser-backup';});
  function showInspectorView(view:InspectorView){
    if(view==='settings'&&!$('app-shell').classList.contains('inspector-hidden'))loadSettings();
    if(view==='mobile')loadMobile();
    groups.forEach(group=>{group.dataset.viewHidden=String(category(group)!==view);group.hidden=group.dataset.viewHidden==='true'||group.dataset.empty==='true';});
    selectInspectorView(view);
    inspector.scrollTop=0;
  }
  showInspectorView('settings');
  wireEvents();renderStatus();renderThread();renderThreads();setupEvents();
  dispatchReady();
  setNavigationReady();
  const linkedThread=new URL(location.href).searchParams.get('thread');
  const notification=pendingNotification()||(linkedThread&&requestedHost===targetHost?{host:targetHost,threadId:linkedThread}:null);
  clearPendingNotification();
  if(notification)openNotificationThread(notification);
  else if(state.selectedId)restoreDetail(state.selectedId,state.selectionVersion);
  try{const c=await readCsrf();state.csrf=c.token;await loadStatus();if(connected())await refreshWorkspace(false,true);else if(!connectionPending())await connectRemote();}
  catch(e){recordError(e,'init');publishConnectionBanner({hidden:false,className:'connection-banner error',text:messageOf(e)});}
  finally{finishStarting();}
 };
}
