import {createCompletionNotices} from './services/completion-notices';
import {createNotificationTraceQueue,createNotificationTraceSender} from './services/notification-trace';
import {readWorkspaceView,saveWorkspaceView} from './services/workspace-view';
import {pendingNotificationTarget,saveNotificationTarget,consumeNotificationTarget,notificationTargetUrl} from './services/notification-target';
import {installConnectionManager,connectionSavePending} from './components/ConnectionManager';
import {composerSendView} from './services/composer-send-view';
import {publishConversationActivity} from './components/RunningIndicator';
import {publishWorkspaceRegion} from './components/WorkspaceRegions';
import {publishMessageInput,publishComposerBusy} from './components/MainComposer';
import {publishWorkspaceControl,setWorkspaceControlAction,prepareWorkspaceControlReasons} from './components/WorkspaceControls';
import {setWorkspaceText,publishWorkspaceLabel} from './components/WorkspaceLabels';
import type {NativeConnectionStatus,NativeRequest,NativeThread,NativeItem,NativeTurn} from '../contracts/native';
import {createRequestRenderer} from './services/request-renderer';
import {readInitialConnections as readConnections,selectInitialTarget as selectTarget} from './startup-connections';
import {createSessionContext} from './services/session-context';
import {createWorkspaceStartup} from './services/workspace-startup';
import {createNewChatPage} from './services/new-chat-page';
import {createActionRunner} from './services/action-runner';
import {createRequestResponder,requestKey,requestPath} from './services/request-response';
import {createThreadSelection} from './services/thread-selection';
import {createSidebarReader} from './services/sidebar-reader';
import {createDesktopSettings} from './services/desktop-settings';
import {createModelSelection} from './services/model-selection';
import {createLiveTurns} from './services/live-turns';
import {createEventHandler} from './services/events';
import {createEventConnection} from './services/event-connection';
import {installWorkspaceLifecycle,installOfflineDraftGuard} from './services/workspace-lifecycle';
import {applyControllerStatus} from './services/connection-status';
import {createThreadViewReporter} from './services/thread-view';
import {controllerElement as $,el,icon,clear} from './controller-dom';
import {createControllerState} from './controller-state';
import {createThreadAccess} from './services/thread-access';
import {createConnectionActions} from './services/connection-actions';
import {publishWelcome,setWelcomeDisabled,installWelcomeAction,installClearRecovery} from './components/WorkspaceActions';
import {installDesktopControls,publishDesktopControls} from './components/DesktopControls';
import {installInspectorNavigation,installAutomationNavigation} from './components/InspectorNavigation';
import {publishConnectionSelect,installConnectionSelectAction} from './components/ConnectionSelect';
import {publishProjectPicker,installProjectPickerActions} from './components/ProjectPicker';
import {publishNewChatControls,installNewChatActions} from './components/NewChatControls';
import {createThreadFromDraft as createThreadSubmit} from './services/thread-create';
import {createMessageSend} from './services/message-send';
import {createPlanSubmit} from './services/plan-submit';
import {createStopRequest} from './services/stop-request';
import {createDesktopSend} from './services/desktop-send';
import {publishSendActions,installSendActions} from './components/SendActions';
import {publishModelSelectAvailability,installModelSelectActions} from './components/ModelSelect';
import {createMessageInput} from './services/message-input';
import {createUpdateScheduler} from './services/update-scheduler';
import {createHistoryPagination} from './services/history-pagination';
import {createPushSubscription} from './services/push-subscription';
import {createNotificationDelivery} from './services/notification-delivery';
import {createNotificationPreference} from './services/notification-preference';
import {createTaskNotifications} from './services/task-notifications';
import {createAutoRefresh} from './services/auto-refresh';
import {createDetailRecovery} from './services/detail-recovery';
import {createLayoutController} from './services/layout';
import {connectionBanner,protocolDiagnostics} from './services/connection-banner';
import {publishConnectionSummary} from './components/ConnectionSummary';
import {publishConnectionBanner} from './components/ConnectionIndicators';
import {publishConnectionSettings,installConnectionActions} from './components/ConnectionSettings';
import {publishNotificationView,installNotificationActions} from './components/NotificationControls';
import {createWorkspaceRefresh} from './services/workspace-refresh.ts';
import {createDetailReader} from './services/detail-reader.ts';
import {createApiClient} from './services/api.ts';
import {createSidebarLoader} from './services/sidebar-loader.ts';
import {createCatalogReaders} from './services/catalogs.ts';
import {createSelectedRefresh} from './services/selected-refresh.ts';
import {installDeferredTool} from '../../public/deferred-tool.js';
import {renderSelectOptions,renderDiagnosticsView,renderRefreshStatusView,publishWorkspace} from './views.tsx';
import {completedGoalPlacement,renderCompletedGoal} from '../../public/goal-toolbar.js';
import {installQueuedInputs} from './components/QueuedInputs.tsx';
let queuedInputs: ReturnType<typeof installQueuedInputs> | undefined;
import {createSendReceipts,sendReceiptLabels} from '../../public/connection-state.js';
const sendReceipts=createSendReceipts();
import {installResponseAnnotations,annotatedText} from '../../public/response-annotations.js';
import {installSideChat} from '../../public/side-chat.js';
let annotations: ReturnType<typeof installResponseAnnotations> | undefined;
let sideChat: ReturnType<typeof installSideChat> | undefined;
import {authRecoveryMessage} from '../../shared/account-state.js';
import {RenderCache,renderSignature,ProgressiveTurns} from '../../public/render-cache.js';
import {createToasts,confirmAction,createStopFeedback} from '../../public/feedback.js';
const stopFeedback=createStopFeedback();
const stopContext=()=>JSON.stringify([targetHost,state.desktopMode,state.selectedId]);
import {configureProjectBrowser} from '../../public/project-picker.js';
let projectFolders: ReturnType<typeof configureProjectBrowser> | undefined;
import {installCapacityRetry} from '../../public/capacity-retry.js';
let capacityRetry: ReturnType<typeof installCapacityRetry> | undefined;
import {createVersionSync} from '../../public/system-update.js';
import {installSystemUpdate} from './components/SystemUpdate';
import {installAccountUsage} from './components/AccountUsage';
let refreshAccountUsage: ReturnType<typeof installAccountUsage> | undefined;
import {sendAfterGoal} from '../../public/goal-submit.js';
import {notificationSupport,prepareNotificationWorker,submitWorkerNotification} from '../../public/notification-platform.js';
import {deliverNotice,submitNotification} from '../../public/notification-delivery.js';
import {asyncQuestions,QuestionDrafts} from '../../public/questions.js';
import {publishRequestCards,syncRequestCards} from './components/RequestCards';
import {fileLink,itemFileUrl,closeFileViewer} from '../../public/message-files.js';
import {notifyManagerError, recoveryMessage, selectedRecoveryMessage} from '../../public/recovery-state.js';
import {renderProcessGroup} from '../../public/process-summary.js';
import {activitySource,conversationActivity} from '../../public/activity.js';
import {installTurnNavigation} from '../../public/turn-navigation.js';
let scrollFollow: ReturnType<typeof installScrollFollow> | undefined;
let scrollContext: string | undefined;
let turnNavigation: ReturnType<typeof installTurnNavigation> | undefined;
import {userMessageContent,itemImageUrl,isRasterImage,imageCard} from '../../public/message-media.js';
import {questionHistory,markdown,userMessageBody} from '../../public/message-body.js';
import {userMessageTime, timedTurnGroups} from '../../public/message-time.js';
import {renderTurnFiles} from '../../public/turn-files.js';
import {reconcileMessages} from '../../public/message-dom.js';
import {NewChatDraft} from '../../public/new-chat.js';
import {installAttachments} from '../../public/attachments.js';
let attachments: ReturnType<typeof installAttachments> | undefined;
import {Sidebar,projectFolderOptions} from '../../public/sidebar.js';
import {DraftStore, shouldSendOnEnter, coalesceRefresh, followUpAction} from '../../public/input-state.js';
import {installAutomations} from '../../public/automations.js';
let automations: ReturnType<typeof installAutomations> | undefined;
import {installThreadSync} from '../../public/thread-sync.js';
import {installMobileUI, compactLayout, touchInput, installScrollFollow} from '../../public/mobile-ui.js';
let mobileUI: ReturnType<typeof installMobileUI> | undefined;
let draftWritesSuspended = false;
import {createHandoffControls} from '../../public/thread-handoff.js';
let handoffControls: ReturnType<typeof createHandoffControls> | undefined;
import {installBrowserBackup} from './components/BrowserBackup';
import {installComposer, WEB_ACCESS,implementationText,completedPlan} from '../../public/composer.js';
import {installMobile,showMobileError} from './components/MobileAccess.tsx';
let composer: ReturnType<typeof installComposer> | undefined;
import {readDetailCache, writeDetailCache, clearDetailCache, outputBases, hydrateOutputs, decodeOutputs} from '../../public/detail-cache.js';
import {outputWindow, OUTPUT_WINDOW_SIZE} from '../../public/output-window.js';
import {updateExtensionNotice, renderExtensionNotice, mergeLiveTurns, taskNotice, backgroundActivity} from '../../public/connection-state.js';
const requestedHost = new URL(location.href).searchParams.get('host');
let pendingNotification=pendingNotificationTarget(localStorage,location.href), notificationNavigationReady=false;
let openingNotification:string|null=null,notificationWaitingForCreate=false;
let navigationStateReady=false,navigationHost=requestedHost;
const navigationTraces=createNotificationTraceQueue({ready:()=>notificationNavigationReady&&!!state.csrf,
  send:createNotificationTraceSender({
    lookupEndpoint:async()=>{const registration=await navigator.serviceWorker?.getRegistration();return (await registration?.pushManager?.getSubscription())?.endpoint;},
    api:(path,options)=>navigationTraceApi(path,options),
  })});
navigator.serviceWorker?.addEventListener('message',event=>{
  const data=event.data;
  if(data?.type==='rcm-navigation-trace'){
    if(['worker-push','worker-shown','worker-show-failed','worker-click','worker-window'].includes(data.stage))void reportPageNavigation(data.stage,data,data.version);
    return;
  }
  if(data?.type!=='rcm-notification-click'||!data.threadId)return;
  saveNotificationTarget(localStorage,data);
  event.ports?.[0]?.postMessage({clickId:data.clickId});
  if(notificationNavigationReady)openNotificationThread(data);else pendingNotification=data;
});
function requestNotificationTarget(){
  void navigationTraces.flush();
  if(!notificationNavigationReady||document.visibilityState==='hidden')return;
  const linked=pendingNotificationTarget(localStorage,location.href);
  if(linked){void openNotificationThread(linked);return;}
  void navigator.serviceWorker?.getRegistration().then(registration=>registration?.active?.postMessage({type:'rcm-notification-ready'})).catch(recordError);
}
window.addEventListener('pageshow',requestNotificationTarget);
window.addEventListener('online',requestNotificationTarget);
window.addEventListener('hashchange',requestNotificationTarget);
window.addEventListener('popstate',requestNotificationTarget);
document.addEventListener('visibilitychange',requestNotificationTarget);
navigator.serviceWorker?.addEventListener('controllerchange',requestNotificationTarget);
const connectionConfig=await readConnections();
const connectionIds=connectionConfig.data.map(c=>c.id);
const targetHost=selectTarget(connectionIds,requestedHost,connectionConfig.defaultConnection)!;
navigationHost=targetHost;
renderSelectOptions(document.querySelector<HTMLSelectElement>('#connection-select')!,connectionConfig.data.map(c=>({value:c.id,label:c.host.alias})),connectionConfig.data[0]?.id||'');
const standaloneApp=matchMedia('(display-mode: standalone)').matches||(navigator as Navigator & {standalone?:boolean}).standalone===true;
function savedView(){return readWorkspaceView(sessionStorage,localStorage,targetHost,standaloneApp);}
function pendingDesktopSends(){try{return JSON.parse(sessionStorage.getItem('rcm.desktopSends.'+targetHost)||'{}');}catch{return {};}}
const desktopSends=pendingDesktopSends();
function saveDesktopSends(){try{sessionStorage.setItem('rcm.desktopSends.'+targetHost,JSON.stringify(desktopSends));}catch{toast('浏览器无法保存发送回执，请先核对原始会话再重试。',true);}}
function saveView(){saveWorkspaceView(sessionStorage,localStorage,targetHost,standaloneApp,{selectedId:state.selectedId,projectId:state.projectId,desktopMode:state.desktopMode});}
function rememberHost(host:string) { try { localStorage.setItem('rcm.connection',host); } catch {} }
rememberHost(targetHost);
const targetUrl=(path:string)=>path+(path.includes('?')?'&':'?')+'host='+targetHost;
const threadViewId=crypto.randomUUID();
const threadViewReporter=createThreadViewReporter({viewId:threadViewId,host:targetHost!,context:()=>({state,newChatOpen,automations,sideChat}),request:(...args)=>api(...args),refresh:()=>scheduleDetailRefresh()});
const reportThreadView=threadViewReporter.report;
const retiredStatusInstances=new Set<string>();
function applyStatus(status:NativeConnectionStatus){applyControllerStatus(state,status,retiredStatusInstances);}

const statusNames:Record<string,string> = {unknown:'状态未确认',notLoaded:'尚未加载', idle:'就绪', active:'执行中', inProgress:'执行中', in_progress:'执行中', running:'执行中', completed:'已完成', interrupted:'已停止', failed:'失败', systemError:'服务错误', pending:'等待中', declined:'已拒绝', stopped:'已停止', success:'成功'};
const state = createControllerState({
  desktopMode:Boolean(savedView().desktopMode),selectedId:savedView().selectedId||null,projectId:savedView().projectId||null,
  drafts:new DraftStore({storage:()=>sessionStorage,host:targetHost,onError:()=>toast('浏览器无法保存草稿，请先复制重要内容。',true)}),
});
navigationStateReady=true;
const {typeOf,currentThread,turns,connected,connectionPending,featureReady,sessionLabel,usable,controlled,currentHandoff,snapshotHistory,uncertainHistory,running}=createSessionContext({state,statusNames});
const {upsertTurn,ensureTurn,upsertItem}=createLiveTurns({state,turns});
const questionDrafts=new QuestionDrafts(sessionStorage,targetHost,()=>toast('问题草稿暂未保存，请先复制回答。',true));
const newDraftId='local:new-chat-draft';
const newDraft=new NewChatDraft(sessionStorage,'rcm.new-chat.'+targetHost);
let newChatOpen=false;
const inputId=()=>newChatOpen?newDraftId:state.selectedId;
const inputReady=()=>state.desktopMode&&!newChatOpen?Boolean(state.transport&&state.detail?.desktop?.available):newChatOpen?usable()&&Boolean(newDraft.cwd):usable()&&controlled()&&!state.selectedArchived;
const {rememberNewDraft,closeNewChat,updateNewProjects,openNewDialog}=createNewChatPage({state,newDraft,newDraftId,
  opened:{get:()=>newChatOpen,set:value=>{newChatOpen=value;}},setNewChatVisible:visible=>publishWorkspaceRegion('new-chat-page',{hidden:!visible}),element:$,document,toast,renderThread,resizeInput,queueMicrotask,reportThreadView,recordError,
  currentThread,projectFolderOptions,publishProjectPicker,automations:()=>automations,flushDrafts,installProjectPickerActions,renderControls,publishNewChatControls,
  toggleInspector:open=>toggleInspector(open),compactLayout,toggleSidebar:(...args)=>toggleSidebar(...args),renderModels:()=>renderModels(),mobileUI:()=>mobileUI});

function flushDrafts() {
  if (draftWritesSuspended) return;
  if (inputId()) state.drafts.set(inputId()!,$('message-input').value);
  else state.drafts.persist();
  saveView(); saveOutputPositions();
}
let workspaceStarting=true;
const resumeWorkspace = coalesceRefresh(async () => {
  if(workspaceStarting)return;
  if (document.hidden || navigator.onLine === false) return;
  await loadStatus();
  if (connected()&&!state.status?.service?.releasing) {
    // The selected conversation must not wait for slow model/project catalogs.
    await refreshSelected();
    if(!state.loadingThreads&&!sidebar.pending&&!sidebar.menu&&!sidebar.dialog)loadThreads();
  }
});
const effortNames:Record<string,string> = {none:'无', minimal:'最低', low:'低', medium:'中', high:'高', xhigh:'超高', max:'最高', ultra:'极高'};
const stages:Record<string,string> = {ssh:'SSH 连接', identity:'身份核验', service:'目标机器服务', protocol:'协议连接', initialize:'协议初始化', models:'模型目录', threads:'会话列表', connected:'已连接', connecting:'正在连接', disconnected:'未连接', reconnecting:'正在重连', error:'连接失败', ready:'已连接'};

function pretty(value:unknown) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function messageOf(value:unknown) {
  const info=value as {message?:string;code?:string;readOnly?:boolean}|null|undefined;
  const message=typeof value === 'string' ? value : info?.message || pretty(value)!;
  if(info?.code==='RPC_TIMEOUT'||/timed out after \d+ ms/.test(message)) return info?.readOnly?'读取目标机器超时，已有内容和草稿保留，请重试刷新。':'目标机器响应超时，操作结果尚未确认。请先核对会话记录，避免重复创建或发送。';
  if(/ssh: connect to host .*Operation timed out/i.test(message)) return '无法连接目标机器。请确认目标机器在线且网络可达，然后重新连接。';
  return message;
}
function requestThread(r:NativeRequest) { return r.threadId || r.params?.threadId; }
function requests() {
  const activeIds=new Set(turns().filter(t=>t.status==='inProgress').map(t=>t.id));
  const all = [...(state.status?.pendingRequests || []), ...(state.detail?.pendingRequests || []), ...state.localRequests,...(sideChat?.requests()||[]), ...(state.detail?.recovering?[]:asyncQuestions(turns(),state.selectedId,{includeFinished:true}).filter((r:NativeRequest)=>typeof r.params?.turnId==='string'&&activeIds.has(r.params.turnId)||questionDrafts.get(r).reopened))];
  const map = new Map(); all.forEach(r => { if (r?.id != null) map.set(requestKey(r), r); });
  return [...map.values()];
}
function needsAnswer(id:string|null) {
  return usable()&&requests().some(r=>requestThread(r)===id&&r.params?.questions?.length&&!questionDrafts.get(r).sent);
}
function threadName(t:{name?:unknown;title?:unknown;preview?:unknown;[field:string]:unknown} | null | undefined) {
  const name = String(t?.name || t?.title || t?.preview || '未命名会话').replace(/\s+/g, ' ').trim();
  return name.length > 80 ? name.slice(0, 80) + '…' : name;
}
function baseName(path:string|null|undefined) { return String(path || '').replace(/\/$/, '').split('/').pop() || path || '项目'; }
function timestamp(value:string|number|Date|null|undefined) {
  if (value == null) return null;
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number < 1e12 ? number * 1000 : number) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function dateTime(value:string|number|Date|null|undefined, short = false) {
  const d = timestamp(value); if (!d) return '—';
  return new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', ...(short ? {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'} : {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}),hour12:false}).format(d);
}
function relativeTime(value:string|number|Date|null|undefined) {
  const d = timestamp(value); if (!d) return '';
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return '刚刚'; if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前';
  if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前'; if (sec < 604800) return Math.floor(sec / 86400) + ' 天前';
  return new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(d);
}
let refreshNoticeTimer: ReturnType<typeof setTimeout> | null = null;
function renderRefresh() {
  renderRefreshStatusView({refreshing:state.refreshing,message:state.refreshMessage,
    time:state.lastSync ? state.refreshScope + '最后更新：' + dateTime(state.lastSync) + '（北京时间）' : '尚未成功刷新'});
  for (const id of ['refresh-all'] as const) {
    $(id).classList.toggle('refreshing', state.refreshing);
    $(id).setAttribute('aria-busy', String(state.refreshing));
  }
  renderControls();
}
async function showRefresh(scope:string, work:()=>Promise<unknown>) {
  if (state.refreshing) return;
  clearTimeout(refreshNoticeTimer!); refreshNoticeTimer = null;
  state.refreshing = true;
  state.refreshMessage = '正在刷新' + scope + '，请稍候…'; renderRefresh();
  try {
    await work();
    state.lastSync = new Date(); state.refreshScope = scope;
    state.refreshMessage = '';
  } catch (error) {
    state.refreshMessage = scope + '刷新失败：' + ((error as Error).message || String(error));
    recordError(error,'refresh');
    refreshNoticeTimer=setTimeout(()=>{refreshNoticeTimer=null;state.refreshMessage='';renderRefresh();},8000);
  } finally { state.refreshing = false; renderRefresh(); }
}
function recordError(error:unknown, stage = 'client') {
  const message = messageOf(error);
  const last = state.errors[state.errors.length - 1];
  if (!last || last.message !== message || Date.now() - last.time > 5000) state.errors.push({message,stage,time:Date.now()});
  state.errors = state.errors.slice(-20); renderDiagnostics();
}
let toastPresenter: ReturnType<typeof createToasts> | undefined;
function toast(...args:Parameters<ReturnType<typeof createToasts>>) { return (toastPresenter??=createToasts({region:$('toasts'),make:el,icon}))(...args); }

const api=createApiClient({lifecycle:document,targetUrl,configRevision:()=>connectionConfig.configRevision as string|undefined,csrf:{get:()=>state.csrf,set:token=>{state.csrf=token;}},flushDrafts,reload:()=>location.reload()});
// Trace URLs already contain their captured host; do not append the current host.
const navigationTraceApi=createApiClient({targetUrl:path=>path,configRevision:()=>connectionConfig.configRevision as string|undefined,csrf:{get:()=>state.csrf,set:token=>{state.csrf=token;}},flushDrafts,reload:()=>location.reload()});

const action=createActionRunner({state,renderControls,renderStatus,usable,syncRequestCards:view=>syncRequestCards({...view,desktopThreadId:state.desktopMode&&state.detail?.desktop?.canAnswer===true?state.selectedId:null}),recordError,messageOf,toast});

function renderStatus() {
  void refreshAccountUsage?.();
  const s = state.status || {}, c = s.connection || {}, h = s.host || {}, service = s.service || {};
  const conn = c.state || 'disconnected';
  if (state.detail && Array.isArray(s.controlledThreads)) state.detail.controlled = s.controlledThreads.includes(state.selectedId!);
  if (Array.isArray(s.pendingRequests)) {
    const keys = new Set(s.pendingRequests.map(requestKey));
    state.localRequests = state.localRequests.filter(r => keys.has(requestKey(r)));
    if (state.detail) state.detail.pendingRequests = (state.detail.pendingRequests || []).filter(r => state.desktopMode&&r.kind==='desktopQuestion'||keys.has(requestKey(r)));
  }
  const variant = connected() && state.transport ? 'connected' : ['connecting','reconnecting'].includes(conn) ? 'connecting' : conn === 'error' || conn === 'failed' ? 'error' : '';
  const label = connected() && !state.transport ? '实时连接中断' : stages[conn] || conn;
  document.title = (currentThread() ? threadName(currentThread()) + ' · ' : '') + 'Codex Portal';
  publishConnectionSummary({ready:true,variant,label,name:h.alias || '目标机器',address:h.hostname || '目标机器'}, {ready:true,variant,label,host:h.hostname || h.alias || '目标机器',user:h.user,
    version:service.version || h.version,connectedAt:dateTime(c.connectedAt),transport:state.transport ? '实时通道已连接' : '实时通道未连接',
    icon:connected()||connectionPending() ? 'close' : 'link',connectLabel:state.busy.has('disconnect') ? '正在断开…' : connectionPending()?'取消连接':connected() ? '断开本机连接' : '连接目标机器'});
  publishWelcome({ready:true,icon:connected()?'plus':'link',label:connectionPending()?'正在连接…':connected()?'新建目标机器会话':'连接 '+(h.alias||'目标机器')});
  setWorkspaceText('welcome-footnote',connected() ? '已连接。选择左侧会话，或新建目标机器会话。' : '等待连接。此页面不包含演示会话。');
  renderControlOverview();
  renderControls(); renderDiagnostics(); if(!sidebar.menu&&!sidebar.dialog&&!sidebar.drag)renderThreads();
}
function renderControlOverview() {
  const sessions=state.status?.controlledSessions||[],counts=new Map();
  sessions.forEach(session=>{const label=sessionLabel(session);counts.set(label,(counts.get(label)||0)+1);});
  setWorkspaceText('control-overview',sessions.length?'本工作台 · '+[...counts].map(([label,count])=>label+' '+count).join(' · '):'暂无网页执行的会话');

}
function renderConnectionBanner() {
  const s=state.status||{}, c=s.connection||{}, service=s.service||{}, conn=c.state||'disconnected';
  publishConnectionBanner(connectionBanner({resumeWarning:!newChatOpen&&!state.desktopMode?state.detail?.resumeWarning:null,recovering:state.transportRecovering,transport:state.transport,error:c.error?messageOf(c.error):'',connection:conn,
    stage:c.stage,stageLabel:stages[c.stage!],connected:connected(),desktopMode:state.desktopMode,loginRecovery:s.loginRecovery,
    limited:service.protocolValidation?.status==='limited',features:service.protocolValidation?.features,
    recoveryMessage:()=>selectedRecoveryMessage(s.recoveryFailures,newChatOpen?null:state.selectedId)}));
}
function renderControls() {
  if(notificationWaitingForCreate&&!state.busy.has('create')){notificationWaitingForCreate=false;queueMicrotask(requestNotificationTarget);}
  publishWorkspace(state);
  annotations?.render();sideChat?.sync();queuedInputs?.render();
  queueMicrotask(()=>turnNavigation?.update());
  capacityRetry?.tick();
  renderConnectionBanner();
  const ready = usable(), own = newChatOpen||controlled()&&!state.selectedArchived, active = !newChatOpen&&running();
  const background = backgroundActivity(state.detail,{controlled:own,connected:ready});
  const stopping=!newChatOpen&&stopFeedback.observe(stopContext(),{confirmed:!state.detail?.recovering&&(state.desktopMode?state.transport&&state.detail?.desktop?.available:ready&&own&&!uncertainHistory()),turns:state.desktopMode?[]:turns(),status:currentThread()?.status,background:Array.isArray(state.detail?.backgroundTerminals?.data)?background.state:'unknown'});
  const stopLabel=stopping?(state.transport&&(state.desktopMode?state.detail?.desktop?.available:ready)?'停止中…':'停止状态待确认'):'停止';
  const handoff=currentHandoff(),handing=state.busy.has('handoff:'+state.selectedId)||handoff?.state==='checking';
  handoffControls??=createHandoffControls({endUse:endThreadUse});
  handoffControls!.render({id:newChatOpen||state.desktopMode?null:state.selectedId,context:targetHost+':'+state.selectedId+':'+state.selectionVersion,running:active,owned:Boolean(state.detail?.controlled||state.status?.controlledThreads?.includes(state.selectedId!)),handoff,connected:ready,
    supported:state.status?.service?.protocolValidation?.features?.handoff?.supported===true,busy:handing,archived:state.selectedArchived,conflict:state.detail?.controlState==='conflict'});
  const answering=[...state.busy].some(key=>key.startsWith('request:'));
  const posting = state.busy.has('message')||state.busy.has('create')||state.busy.has('desktop-settings'), switching = state.busy.has('takeover'), creating = state.busy.has('create');
  publishConnectionSelect({disabled:creating});
  publishWorkspaceControl('new-thread',{ disabled:!!state.status?.loginRecovery || !ready || !featureReady('create') || creating || !state.models.length || state.loadingModels });
  setWelcomeDisabled(connectionPending() || state.busy.has('connect') || state.busy.has('disconnect') || (connected() && (!ready || !state.models.length||!featureReady('create'))));
  publishConnectionSettings({connectDisabled:state.busy.has('connect') || state.busy.has('disconnect') || state.busy.has('release'),
    reloadDisabled:!ready||!featureReady('release')||state.busy.has('release'),
    releaseDisabled:!ready || !featureReady('release') || !state.status?.service?.running || state.busy.has('release'),
    releaseLabel:state.busy.has('release') ? '正在检查并释放…' : '停止目标服务（影响所有入口）',
    releaseReason:!ready ? '连接恢复后可检查目标服务。' : !featureReady('release') ? '当前引擎不支持从此入口停止服务。' : state.busy.has('release') ? '正在检查维护条件…' : '目标服务未运行。'});
  publishWorkspaceControl('refresh-all',{ disabled:state.refreshing || state.busy.has('refresh') });
  publishWorkspaceControl('thread-search',{ disabled:!connected() });
  const desktopSettingsUnavailable=state.desktopMode&&!newChatOpen&&(!inputReady()||!state.detail?.desktop?.settings?.model||!!state.detail?.desktop?.unconfirmed||state.busy.size>0);
  publishModelSelectAvailability(desktopSettingsUnavailable || !ready || !state.models.length || state.loadingModels,
    desktopSettingsUnavailable || !ready || !state.model || !effortsFor(state.model).length || state.loadingModels);
  const input = $('message-input');
  const followUp=followUpAction({active,touch:touchInput()});
  const blockedGoal=state.detail?.goal?.status==='blocked'&&!state.detail?.goalError&&composer?.mode()!=='plan';
  // Publish the final mode once; avoid transient disabled states while editing.
  publishMessageInput(newChatOpen?{disabled:!ready||posting,placeholder:'描述你想完成的任务…'}:
    state.desktopMode?{disabled:posting,placeholder:active?'补充要求…':'发送消息，输入 / 选择技能，@ 引用会话或插件…'}:
    {disabled:!ready||!own||posting||handing,placeholder:!ready?'连接后继续…':state.selectedArchived?'恢复会话后可继续…':!own?'正在确认会话…':blockedGoal?'发送补充信息后将自动继续目标…':active?(followUp==='queue'?'排队发送，或 ⌘/Ctrl+Enter 引导…':'补充要求…'):'发送消息…'});
  const {buttonView,unavailable}=composerSendView({active,ready,own,posting,handing,stopping,
    loginRecovery:!!state.status?.loginRecovery,desktopMode:state.desktopMode,interrupting:state.busy.has('interrupt'),archived:state.selectedArchived,
    touch:touchInput(),backgroundState:background.state,followUp,attachmentPending:attachments?.pending(),hasAttachments:attachments?.has(),hasAnnotations:annotations?.has(),
    text:input.value,loadingModels:state.loadingModels,hasModel:Boolean(modelFor(state.model)),hasEffort:effortsFor(state.model).some(e=>e.value===state.effort),featureReady});
  publishComposerBusy(posting);
  publishWorkspaceControl('takeover',{ hidden:own || !state.selectedId || state.selectedArchived || (!handoff&&!state.detail?.accessError) }); publishWorkspaceControl('takeover',{ disabled:!ready || Boolean(handoff&&!featureReady('takeover')) || switching || handing || !state.selectedId });
  publishWorkspaceControl('takeover',{text:switching ? '正在连接…' : handoff ? '在网页继续' : '重试'});
  publishWorkspaceControl('composer-availability',{text:!own&&state.detail?.accessError?String(state.detail.accessError):unavailable,hidden:!unavailable&&!state.detail?.accessError});
  publishWorkspaceControl('new-thread',{description:!ready ? '连接恢复后可新建会话。' : !state.models.length ? '正在等待目标机器模型目录。' : creating ? '正在创建，请稍候。' : ''});
  controlReason('new-thread',$('new-thread').getAttribute('aria-description') || (!featureReady('create') ? '当前引擎不支持创建会话。' : '正在读取模型目录…'));
  controlReason('takeover',!ready ? '连接恢复后可重试。' : switching ? '正在连接，请稍候。' : handing ? '交还状态正在确认，请稍候。' : '当前引擎暂不支持在网页继续。');
  buttonView.stop.text=stopLabel;
  buttonView.stop.title=stopping?'停止请求已发出，等待目标确认。':active?'停止当前轮次':'停止后台命令';
  buttonView.stop.label=stopping?stopLabel:buttonView.stop.title;
  buttonView.stop.busy=String(stopping);
  publishConversationActivity(newChatOpen?null:conversationActivity(currentThread(),{
    connected:ready,controlled:controlled(),active,background,needsAnswer:needsAnswer(state.selectedId),
  }));
  if(newChatOpen){
    const reason=!ready?'连接恢复后可发送，草稿已保留。':newDraft.phase==='uncertain'?'创建结果未确认，请刷新侧栏核对，避免重复创建。':!newDraft.cwd?'选择一个项目后开始。':creating?'正在创建会话…':'';
    buttonView.send.disabled ||= !featureReady('create')||!newDraft.cwd||newDraft.phase!=='editing';
    buttonView.send.label=creating?'正在创建会话':'发送并开始会话';
    publishWorkspaceControl('composer-availability',{text:reason,hidden:!reason});
    publishNewChatControls({retryHidden:newDraft.phase!=='uncertain',closeDisabled:creating});
    publishProjectPicker({disabled:!ready||creating||newDraft.phase==='uncertain'});
    buttonView.stop.hidden=true;publishWorkspaceControl('takeover',{ hidden:true });
    publishWorkspaceLabel('thread-title',{hidden:false});setWorkspaceText('thread-title','新会话');
  }
  projectFolders?.sync();
  setWorkspaceText('composer-model-label',(modelFor(state.model)?.displayName || state.model || '模型')+' · '+(effortNames[state.effort] || state.effort || (state.desktopMode?'桌面默认':'档位')));
  composer?.render(); attachments?.render();
  const draft = own ? active ? '发送补充要求不会更改当前模型。模型与档位在下一轮生效。' : '模型与档位来自目标机器。更改在下一轮生效。' : '正在确认会话的可用入口。';
  setWorkspaceText('composer-hint',state.desktopMode&&!newChatOpen?(state.busy.has('desktop-settings')?'正在更新桌面模型设置…':'由桌面执行。模型与思考档位用于下一轮，目标请在桌面设置。'):state.loadingModels && !state.models.length ? '正在读取目标机器模型目录…' : draft);
  setWorkspaceText('model-selection-note',state.desktopMode&&!newChatOpen?(state.busy.has('desktop-settings')?'正在更新桌面设置…':'由桌面执行 · 下一轮生效'):currentThread()?.model ? '下一轮模型与思考档位' : '下一轮模型与思考档位 · 目标机器未提供当前模型');
  syncRequestCards({ready,pending:id=>state.busy.has('request:'+id),controlledThreads:state.status?.controlledThreads,desktopThreadId:state.desktopMode&&state.detail?.desktop?.canAnswer===true?state.selectedId:null});
  const desktopView:Parameters<typeof publishDesktopControls>[0]={entryHidden:newChatOpen||own||state.selectedArchived||!state.selectedId||!(state.detail?.accessError||state.detail?.desktop?.error),entryDisabled:!state.transport||state.busy.size>0||Boolean(handoff&&handoff.state!=='released'),reviewHidden:true};
  if(state.desktopMode&&!newChatOpen){
    const desktop=state.detail?.desktop,online=state.transport&&desktop?.available,unconfirmed=desktop?.unconfirmed||desktopSends[state.selectedId!]?.messageId;
    publishWorkspaceControl('takeover',{ hidden:true });
    buttonView.send.disabled=!online||!desktop?.canSend||!!unconfirmed||posting||answering||attachments?.pending()||(!input.value.trim()&&!annotations?.has()&&!attachments?.has());
    buttonView.send.title=active?'引导当前轮次':'发送消息';buttonView.send.label=buttonView.send.title;
    buttonView.stop.hidden=!active&&!stopping;buttonView.stop.disabled=!online||desktop?.canStop!==true||state.busy.has('interrupt')||stopping;
    if(active&&desktop?.canStop!==true)buttonView.stop.title='当前轮次尚未确认，请刷新后重试。';
    const reason=!state.transport?'网页连接中断，草稿已保留。':desktop?.error||(answering?'正在提交回答…':posting?'正在提交到桌面…':!desktop?'正在确认桌面会话…':unconfirmed?'上次发送结果未确认，请先核对原始会话记录，避免重复发送。':requests().some(r=>r.threadId===state.selectedId&&r.kind==='desktopQuestion')?'请先回答上方问题。补充消息将引导当前轮次。':active?'发送将引导当前轮次，由桌面处理。':!desktop.canSend?'桌面状态未确认，请稍后刷新。':'');
    publishWorkspaceControl('composer-availability',{text:reason,hidden:!reason});
    desktopView.reviewHidden=!unconfirmed||answering;desktopView.reviewDisabled=!online||!desktop?.canSend||posting||state.busy.has('desktop-review');
  }
  publishDesktopControls(desktopView);
  publishSendActions(buttonView);
}
function controlReason(id:'new-thread'|'takeover',text:string){
  const button=$(id),hidden=Boolean(!button.disabled||button.hidden);
  publishWorkspaceControl(id,{reason:{text,hidden},...(id==='new-thread'?{title:hidden?'新建会话（⌘/Ctrl+N）':text}:{})});
}
const completionNotices=createCompletionNotices(localStorage,targetHost);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')renderThreads();});
window.addEventListener('focus',()=>renderThreads());
const sidebar: Sidebar = new Sidebar({node:$('thread-list'),host:targetHost,icon,threadName,relativeTime,api,toast,
  needsAnswer,
  activitySource:(t:NativeThread)=>activitySource(t,{connected:usable(),webActive:(((state.status?.controlledSessions||[]).find(s=>s.id===t.id)?.status||t.status) as {type?:string}|undefined)?.type==='active'}),
  connected:usable,selectedId:()=>state.selectedId,newThread:openNewDialog,
  select:(t:NativeThread)=>{state.projectId=t.projectId!;state.selectedArchived=!!t.archived;saveView();selectThread(t.id);},
  onArchiveView:(archived:boolean)=>{state.sidebarArchived=archived;state.threadCursor=null;state.threads=[];loadThreads();},
  refresh:()=>showRefresh('侧边栏',()=>loadThreads(false,true)),
  retry:async()=>{if(!connected())await connectRemote();else await refreshWorkspace();},
  changed:async(action:string,t:import('./services/sidebar').SidebarThread|import('./services/sidebar').SidebarSection|null)=>{if(t?.id===state.selectedId&&['archive','restore'].includes(action))state.selectedArchived=action==='archive';await Promise.all([loadThreads(false,true,true),loadStatus()]);if(t?.id===state.selectedId)await refreshSelected();renderControls();},
});
function renderProjects() { renderThreads(); if(newChatOpen&&!state.busy.has('create')){updateNewProjects();renderControls();} }
function renderThreads() {
  if(state.sidebar)completionNotices.scope(state.sidebar.accountScope);
  const latest=state.detail?.turns?.at(-1);
  const viewed=!newChatOpen&&!state.loadingDetail&&!state.historyError&&document.visibilityState==='visible'&&document.hasFocus()&&state.detail?.thread?.id===state.selectedId&&latest?.status==='completed'?{id:state.selectedId!,turnId:latest.id!}:undefined;
  if(state.sidebar)completionNotices.update(state.threads,viewed);
  sidebar.render(state.sidebar?{...state.sidebar,data:state.threads.map(t=>({...t,completionUnseen:completionNotices.has(t.id)}))}:null,{search:state.search,loading:state.loadingThreads,failed:state.threadPageError});
  setWorkspaceText('breadcrumb-project',state.projects.find(p=>p.id===state.projectId)?.name||'工作区');
  publishWorkspaceControl('more-threads',{ hidden:!state.threadPageError&&!state.threadCursor&&(!state.loadingThreads||state.threads.length>0) });
  publishWorkspaceControl('more-threads',{ text:state.threadPageError?'加载失败，点击重试':state.loadingThreads?'正在加载会话…':'加载更多会话' });
  publishWorkspaceControl('more-threads',{ disabled:state.loadingThreads });
  setWorkspaceControlAction('more-threads',()=>loadThreads(Boolean(state.threadCursor)));
}
const {modelId,modelFor,effortsFor,defaultEffort,fillModels,fillEfforts,renderModels}=createModelSelection({state,effortNames,newChatOpen:()=>newChatOpen,currentThread,nativeSettings:()=>state.desktopMode&&!newChatOpen?(state.detail?.desktop?.settings||{}):null,element:$,renderSelectOptions,renderControls});
const updateDesktopSettings=createDesktopSettings({busy:state.busy,
  context:()=>({key:JSON.stringify([targetHost,state.status?.instanceId,state.status?.connection?.connectedAt,state.selectedId,state.selectionVersion,state.desktopMode]),id:state.selectedId,available:state.desktopMode&&inputReady(),settings:state.detail?.desktop?.settings}),
  post:(path,body)=>api(path,{method:'POST',body}),apply:settings=>{if(state.detail?.desktop)state.detail.desktop.settings=settings;},
  refresh:()=>refreshSelected(),render:sync=>sync?renderModels(true):renderControls(),notify:toast});


function toolDetails(item:NativeItem, title:string, iconName = 'terminal') {
  const d = el('details','tool-block'); d.dataset.itemId = item.id || title; d.dataset.running = String(['inProgress','in_progress','running'].includes(typeOf(item.status)));
  const summary = el('summary'); summary.append(icon(iconName),el('span','tool-title',title),el('span','tool-status',uncertainHistory() && ['inProgress','in_progress','running'].includes(typeOf(item.status)) ? '状态未确认' : (item.type==='commandExecution'&&item.exitCode===-1?'已终止':statusNames[typeOf(item.status)] || typeOf(item.status))),icon('chevron','chevron'));
  const body = el('div','tool-content'); d.append(summary,body); return {d,body};
}
let outputPositions: Map<string,number|'tail'>;
try{outputPositions=new Map(JSON.parse(sessionStorage.getItem('rcm.outputPositions.'+targetHost)||'[]'));}catch{outputPositions=new Map();}
function saveOutputPositions(){try{sessionStorage.setItem('rcm.outputPositions.'+targetHost,JSON.stringify([...outputPositions].slice(-200)));}catch{}}
function savedOpenDetails(){try{return JSON.parse(sessionStorage.getItem('rcm.openDetails.'+targetHost+'.'+state.selectedId)||'[]');}catch{return [];}}
function renderCommandOutput(item:NativeItem,{threadId=state.selectedId,refresh=renderMessages}={}) {
  const output = item.aggregatedOutput || (uncertainHistory() ? '快照未包含命令输出。' : typeOf(item.status) === 'inProgress' ? '等待命令输出…' : '无命令输出');
  const wrap=el('div','command-output-view');
  wrap.dataset.outputStamp=String(item.outputToken||output.length)+':'+String(outputPositions.get(threadId+':'+item.id)??'tail');
  if(item.outputPartial){wrap.append(el('span','subtle','已显示输出开头，正在补齐完整日志…'),el('pre','tool-output',output));return wrap;}
  if(output.length<=OUTPUT_WINDOW_SIZE) { wrap.append(el('pre','tool-output',output)); return wrap; }
  const key=threadId+':'+item.id, page=outputWindow(output,outputPositions.get(key) ?? 'tail');
  const controls=el('div','output-controls');
  controls.append(el('span','','完整输出已保留 · '+(page.start+1)+'–'+page.end+' / '+page.total+' 字符'));
  for(const [label,position,disabled] of [['开头',0,page.start===0],['上一段',Math.max(0,page.start-OUTPUT_WINDOW_SIZE),page.start===0],['下一段',page.end,page.end===page.total],['跟随最新','tail',page.following]] as const) {
    const b=el('button','secondary-button',label);b.type='button';b.disabled=disabled;
    b.onclick=()=>{outputPositions.set(key,position);saveOutputPositions();refresh();};controls.append(b);
  }
  const jump=el('input');jump.type='number';jump.min='1';jump.max=String(Math.ceil(page.total/OUTPUT_WINDOW_SIZE));jump.value=String(page.following?Number(jump.max):Math.floor(page.start/OUTPUT_WINDOW_SIZE)+1);jump.setAttribute('aria-label','输出段号');jump.style.width='5em';
  jump.oninput=()=>{const n=Number(jump.value);if(Number.isInteger(n)&&n>=1&&n<=Number(jump.max))outputPositions.set(key,(n-1)*OUTPUT_WINDOW_SIZE);};
  jump.onblur=()=>setTimeout(refresh,0);
  const go=el('button','secondary-button','跳转');go.type='button';go.onclick=()=>{(jump.oninput as ()=>void)();saveOutputPositions();refresh();};
  controls.append(el('span','','跳转到段'),jump,el('span','','/ '+jump.max),go);
  const download=el('button','secondary-button','下载完整输出');download.type='button';
  download.onclick=()=>{const url=URL.createObjectURL(new Blob([output],{type:'text/plain;charset=utf-8'}));const a=el('a');a.href=url;a.download='command-'+item.id+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};controls.append(download);
  const pre=el('pre','tool-output',page.text);pre.dataset.followTail=String(page.following);
  wrap.append(controls,pre);return wrap;
}
function renderItem(item:NativeItem,{threadId=state.selectedId,side=false,refresh=renderMessages}={}) {
  const imageUrl=(options:Record<string,unknown>)=>itemImageUrl(threadId,item.id,{...options,host:targetHost});
  const fileContext={threadId,itemId:item.id,host:targetHost};
  const bodyOptions={file:(path:string,label:string)=>fileLink(path,label,fileContext),image:(path:string,label:string,explicit:boolean)=>{
    const raster=isRasterImage(path);
    if(!raster&&!/\.svg$/i.test(path))return null;
    if(path.startsWith('/')&&!path.startsWith('//'))return imageCard(explicit&&raster?imageUrl({reference:path}):itemFileUrl(threadId,item.id,path,targetHost),label||'回复图片');
    if(/^data:image\/(png|jpeg|webp|gif);base64,/.test(path))return imageCard(path,label||'回复图片');
    return null;
  }};
  const bodyMarkdown=(text:string)=>markdown(text,0,bodyOptions);
  if (item.type === 'userMessage' || item.type === 'goalMessage' || item.type === 'steeringUserMessage') {
    const m=el('div','message user'),bubble=el('div','user-bubble'),content=item.type==='goalMessage'?{text:item.objective,images:[]}:userMessageContent(item.type==='steeringUserMessage'?item.input:item.content);
    if(item.type==='goalMessage'){m.setAttribute('aria-label','目标');bubble.append(el('div','goal-message-label','目标'));}
    if(content.text)bubble.append(userMessageBody(content.text,bodyOptions));
    for(const part of content.images){
      const src=part.type==='image'&&/^data:image\/(png|jpeg|webp|gif);base64,/.test(part.url||'')?part.url:imageUrl({part:part.index});
      bubble.append(imageCard(src,'图片附件 '+(part.index+1)));
    }
    m.append(bubble);
    if(item.type==='steeringUserMessage')m.append(el('div','user-message-time',item.status==='accepted'?'已提交引导，桌面将在当前轮次处理。':'补充消息状态：'+String(item.status||'未确认')));
    const sent = userMessageTime(item);
    if (sent) {
      const time = el('time','user-message-time',sent.label);
      time.dateTime = sent.iso; time.title = '消息时间（北京时间）';
      m.append(time);
    }
    return m;
  }
  if (['agentMessage','plan'].includes(item.type)) {
    const m = el('article','message agent'); m.setAttribute('aria-label',item.type === 'plan' ? '计划' : 'Codex 回复'); const label = el('div','agent-label' + (item.type === 'agentMessage' ? ' message-author' : '')); label.append(icon('mark'),el('span','',item.type === 'plan' ? '计划' : 'Codex')); m.append(label);
    const text=String(item.text||''), heartbeat=text.match(/<heartbeat>\s*<automation_id>([^<]+)<\/automation_id>\s*<decision>([^<]+)<\/decision>\s*<message>([\s\S]*?)<\/message>\s*<\/heartbeat>/);
    if(heartbeat&&!side){
      m.append(bodyMarkdown(text.slice(0,heartbeat.index)));
      const card=el('section','decision-notice');card.append(el('strong','','自动任务通知 · '+heartbeat[1]),el('p','',heartbeat[3].trim()));
      const reply=el('button','secondary-button',controlled()?'回复决策':'接管并回复决策');
      reply.onclick=async()=>{if(!controlled())await takeoverThread();if(!controlled())return;$('message-input').focus();$('message-input').placeholder='输入你的决定，确认后发送…';};
      card.append(reply,el('small','','此通知是历史记录。填写并发送后，才会提交你的决定。'));m.append(card,bodyMarkdown(text.slice(heartbeat.index!+heartbeat[0].length)));
    }else m.append(bodyMarkdown(text));
    if(!side&&Array.isArray(item.questions)){
      const card=questionHistory(item,()=>{
        if(threadId!==state.selectedId)return;
        const request=asyncQuestions(turns(),threadId,{includeFinished:true}).find((r:NativeRequest)=>r.params?.itemId===item.id);
        if(!request||questionDrafts.get(request).sent){toast('此问题已回答。');return;}
        questionDrafts.set(request,{reopened:true,skipped:false,collapsed:false});state.requestSignature='';renderRequests();
        const form=[...document.querySelectorAll<HTMLElement>('.request-card')].find(node=>node.dataset.requestId===requestPath(request));
        form?.scrollIntoView({block:'nearest'});form?.querySelector<HTMLElement>('input,textarea,button')?.focus();
      });
      if(card)m.append(card);
    }
    return m;
  }
  if (item.type === 'reasoning') {
    const r = el('details','reasoning-block'); r.dataset.itemId = item.id!; r.append(el('summary','','思考摘要'));
    const text = [...(item.summary || []),...(item.content as Array<string|{text?:string}> || [])].map(x => typeof x === 'string' ? x : x.text || '').join('\n'); r.append(el('p','',text || '目标机器未提供摘要。')); return r;
  }
  if (item.type === 'commandExecution') {
    const {d,body} = toolDetails(item,'执行命令');
    body.append(el('div','tool-command','$ ' + (item.command || '')),el('div','tool-meta','目标机器目录：' + (item.cwd || '—')));
    body.append(renderCommandOutput(item,{threadId,refresh}));
    if (item.exitCode != null) body.append(el('div','tool-meta','退出码：' + item.exitCode + (item.durationMs != null ? ' · 用时 ' + (item.durationMs / 1000).toFixed(1) + ' 秒' : '')));
    if (item.exitCode && item.exitCode !== 0) d.classList.add('failed'); return d;
  }
  if (item.type === 'fileChange') {
    const {d,body} = toolDetails(item,'文件变化 · ' + (item.changes?.length || 0) + ' 个文件','file');
    (item.changes || []).forEach(change => { const row = el('div','file-row'); row.append(icon('file'),el('span','file-path',change.path),el('span','file-kind',kindName(change.kind))); body.append(row); if (change.diff) body.append(el('pre','file-diff',change.diff)); }); return d;
  }
  if (item.type === 'imageGeneration') {
    if(item.result || item.imageRef){
      const card=el('article','message generated-image-message');
      const src=item.imageRef?imageUrl({}):'data:image/png;base64,'+item.result;
      card.append(imageCard(src,'生成的图片'));return card;
    }
    const {d,body}=toolDetails(item,'生成图片','file');
    body.append(el('p','tool-meta',item.failure?messageOf(item.failure):'图片尚未生成。'));return d;
  }
  if (item.type === 'error') return el('div','turn-error',messageOf(item.error || item.message || item.text || item));
  const name = item.tool || item.name || item.type || '目标机器事件';
  const {d,body} = toolDetails(item, name, 'terminal');
  if (item.type === 'mcpToolCall') {
    const host=targetHost,selection=state.selectionVersion;
    installDeferredTool({details:d,body,isCurrent:()=>targetHost===host&&(side||state.selectedId===threadId&&state.selectionVersion===selection),
      load:async()=>item.detailsDeferred?(await api<{item:NativeItem}>('/api/threads/'+encodeURIComponent(threadId!)+'/items/'+encodeURIComponent(item.id!)+'/detail')).item:item,
      render:(value:NativeItem,body:HTMLElement)=>{body.append(el('div','tool-meta','服务：'+(value.server||'—')));
        if(value.arguments)body.append(el('pre','tool-output',pretty(value.arguments)));
        if(value.result)body.append(el('pre','tool-output',pretty(value.result)));
        if(value.error)body.append(el('div','tool-error',messageOf(value.error)));}
    });
  } else if (item.type === 'functionCallOutput') body.append(el('pre','tool-output',typeof item.output === 'string' ? item.output : pretty(item.output)));
  else if (item.type === 'dynamicToolCall') { body.append(el('pre','tool-output',pretty(item.arguments || {}))); if (item.contentItems) body.append(el('pre','tool-output',pretty(item.contentItems))); }
  else if (item.type === 'webSearch') body.append(el('pre','tool-output',item.query || pretty(item.action || item)));
  else body.append(el('pre','tool-output',pretty(item)));
  return d;
}
function kindName(kind:string|{type?:string}|undefined) { const k = typeOf(kind); return {add:'新增',delete:'删除',update:'修改',create:'新增',modify:'修改'}[k] || k || '修改'; }
let lastMessageShape: string | undefined;
const messageCache=new RenderCache();
const progressiveTurns=new ProgressiveTurns({render:()=>{if(!newChatOpen&&state.selectedId)renderMessages();}});
function renderMessages() {
  queueMicrotask(()=>turnNavigation?.update());
  // Keep the jump input stable while the user types; render after blur.
  if(document.activeElement?.matches('.output-controls input')) return;
  const scroller = $('messages-scroller');
  const context=targetHost+':'+state.selectedId;
  if(scrollContext!==context){turnNavigation?.switchContext(context);closeFileViewer();scrollContext=context;scrollFollow?.reset();clear($('messages'));lastMessageShape=undefined;messageCache.clear();}
  progressiveTurns.reset(context+':'+state.selectionVersion+':'+state.detailVersion);
  const visibleTurns:NativeTurn[]=progressiveTurns.view(state.loadingDetail?[]:turns());
  publishWorkspaceRegion('messages',{busy:state.loadingDetail||progressiveTurns.pending});
  progressiveTurns.enqueue();
  const receipts=sendReceipts.view(context,turns());
  const completion=completedGoalPlacement(state.detail?.goal,turns(),state.detail?.goalError||uncertainHistory());
  const nearBottom = scrollFollow?.following ?? true;
  const shape=JSON.stringify([state.desktopMode,completion,receipts.map(r=>[r.id,r.status]),state.selectedId,state.loadingDetail,state.historyError,controlled(),uncertainHistory(),state.detail?.recovering,backgroundActivity(state.detail,{controlled:controlled(),connected:usable()}),[...(state.runtimeNotices.get(state.selectedId!)?.values()||[])],visibleTurns],(key,value)=>['aggregatedOutput','outputToken'].includes(key)?undefined:value);
  if(shape===lastMessageShape){
    for(const turn of visibleTurns)for(const item of turn.items||[]){
      if(item.type!=='commandExecution')continue;
      const previous=$('messages').querySelector<HTMLElement>('details[data-item-id="'+CSS.escape(item.id!)+'"] .command-output-view');
      if(!previous)continue;
      const stamp=String(item.outputToken||(item.aggregatedOutput||'').length)+':'+String(outputPositions.get(state.selectedId+':'+item.id)??'tail');
      if(previous.dataset.outputStamp===stamp)continue;
      previous.replaceWith(renderCommandOutput(item));
    }
    $('messages').querySelectorAll('.tool-output[data-follow-tail="true"]').forEach(pre=>{pre.scrollTop=pre.scrollHeight;});
    if(nearBottom)scroller.scrollTop=scroller.scrollHeight;
    return;
  }
  lastMessageShape=shape;
  const oldTop = scroller.scrollTop, oldHeight = scroller.scrollHeight;
  const viewportTop = scroller.getBoundingClientRect().top;
  const preserveAnchor=state.busy.has('history')||!nearBottom;
  const anchor = preserveAnchor ? [...$('messages').querySelectorAll<HTMLElement>('.message-turn')].find(node => node.getBoundingClientRect().bottom > viewportTop) : null;
  const anchorId = anchor?.dataset.turnId, anchorOffset = anchor ? anchor.getBoundingClientRect().top - viewportTop : 0;
  const opened = new Set($('messages').querySelector('details[data-item-id]') ? [...$('messages').querySelectorAll<HTMLDetailsElement>('details[open][data-item-id]')].map(n => n.dataset.itemId) : savedOpenDetails());
  const n = el('div');
  const commit = () => {reconcileMessages($('messages'), n);messageCache.bind($('messages'));};
  const renderContext=renderSignature([controlled(),uncertainHistory(),backgroundActivity(state.detail,{controlled:controlled(),connected:usable()})]);
  const cachedItem=(item:NativeItem,turnId:string|undefined)=>messageCache.render('item:'+turnId+':'+item.id,renderSignature([renderContext,item]),()=>{const node=renderItem(item);node.dataset.messageId=item.id!;return node;});
  if (state.loadingDetail) { n.append(el('div','empty-history loading','正在读取会话历史…')); commit(); return; }
  if (state.historyError) { n.append(el('div','turn-error',state.historyError)); if(!turns().length){commit();return;} }
  if(state.detail?.recovering)n.append(el('div','history-notice','已恢复本机保存的输出，正在同步最新内容…')); 
  for (const notice of state.runtimeNotices.get(state.selectedId!)?.values() || []) n.append(renderExtensionNotice(notice));
  if (!turns().length) { const empty = el('div','empty-history'); empty.append(icon('chat'),el('p','','此会话暂无消息。'),el('p','',state.desktopMode ? '输入要求，继续此会话。' : controlled() ? '输入要求，开始目标机器工作。' : '正在确认会话的可用入口。')); n.append(empty); }
  if(completion&&!completion.turnId)n.append(renderCompletedGoal(completion.goal));
  visibleTurns.forEach(t => {
    const cachedTurn=messageCache.render('turn:'+t.id,renderSignature([renderContext,t]),()=>{
    const turn = el('section','message-turn'); turn.dataset.turnId = t.id!;
    const meta = el('div','turn-meta'); meta.classList.toggle('needs-attention',['failed','declined','systemError','interrupted'].includes(typeOf(t.status))); meta.append(el('span','',dateTime(t.startedAt || t.createdAt,true)));
    const actualModel = t.model || t.modelInfo?.model, actualEffort = t.effort || t.reasoningEffort || t.modelInfo?.reasoningEffort;
    if (actualModel || actualEffort) meta.append(el('span','turn-model',[actualModel,actualEffort && '思考：' + (effortNames[actualEffort] || actualEffort)].filter(Boolean).join(' · ')));
    const turnStatus = uncertainHistory() && ['inProgress','in_progress','running'].includes(typeOf(t.status)) ? '状态未确认' : statusNames[typeOf(t.status)] || typeOf(t.status);
    meta.append(el('span','turn-status',turnStatus)); turn.append(meta);
    for (const group of timedTurnGroups(t)) {
      if (group.type === 'duration') { turn.append(el('div','turn-duration',group.label)); continue; }
      if (group.type === 'message') { turn.append(cachedItem(group.item,t.id)); continue; }
      const processGroup = renderProcessGroup(t,group,{icon,renderItem:(item:NativeItem)=>cachedItem(item,t.id),
        itemId:'process-' + t.id + '-' + group.key,uncertain:uncertainHistory(),
        background:backgroundActivity(state.detail,{controlled:controlled(),connected:usable()})});
      if (processGroup) turn.append(processGroup);
    }
    const fileItems=(t.items||[]).filter(item=>item.type==='fileChange');
    if(fileItems.some(item=>item.changes?.length)){
      const cwd=currentThread()?.cwd||'';
      const files=messageCache.render('files:'+t.id,renderSignature([cwd,uncertainHistory(),fileItems]),()=>renderTurnFiles(fileItems,{turnId:t.id,cwd,uncertain:uncertainHistory()})||el('div'));
      turn.append(files);
    }
    if (t.error) {
      turn.append(el('div','turn-error',messageOf(t.error)));
      const recovery=authRecoveryMessage(t.error);
      if(recovery)turn.append(el('div','history-notice','登录恢复提示：'+recovery));
    }
    return turn;
    });
    n.append(cachedTurn);
    if(completion?.turnId===t.id)n.append(renderCompletedGoal(completion!.goal));
  });
  for(const receipt of receipts){
    const node=renderItem({id:receipt.id,type:'userMessage',content:receipt.content});
    node.dataset.sendReceipt=receipt.id;
    const status=el('div','user-message-time',sendReceiptLabels[receipt.status as keyof typeof sendReceiptLabels]);status.setAttribute('role','status');node.append(status);n.append(node);
  }
  n.querySelectorAll<HTMLDetailsElement>('details[data-item-id]').forEach(d => { if (opened.has(d.dataset.itemId)) d.open = true; });
  commit();
  const rendered = $('messages');
  for(const turn of visibleTurns)for(const item of turn.items||[]){
    if(item.type!=='commandExecution')continue;
    const previous=rendered.querySelector<HTMLElement>('details[data-item-id="'+CSS.escape(item.id!)+'"] .command-output-view');
    const stamp=String(item.outputToken||(item.aggregatedOutput||'').length)+':'+String(outputPositions.get(state.selectedId+':'+item.id)??'tail');
    if(previous&&previous.dataset.outputStamp!==stamp)previous.replaceWith(renderCommandOutput(item));
  }
  rendered.querySelectorAll('.tool-output[data-follow-tail="true"]').forEach(pre=>{pre.scrollTop=pre.scrollHeight;});
  if (nearBottom && !state.busy.has('history')) scroller.scrollTop = scroller.scrollHeight;
  else if (preserveAnchor) {
    const restored = [...rendered.querySelectorAll<HTMLElement>('.message-turn')].find(node => node.dataset.turnId === anchorId);
    const targetTop = restored ? oldTop + restored.getBoundingClientRect().top - viewportTop - anchorOffset : oldTop + (scroller.scrollHeight - oldHeight);
    // Clamp to real content when a collapsed group shortens the page.
    scroller.scrollTop = targetTop;
  }
  else scroller.scrollTop = oldTop;
}
function renderThread() {
  renderRequests();
  const t = currentThread(); publishWorkspaceRegion('welcome',{hidden:Boolean(state.selectedId)}); publishWorkspaceRegion('conversation',{hidden:!state.selectedId});
  publishWorkspaceLabel('thread-title',{hidden:!state.selectedId});
  publishWorkspaceLabel('breadcrumb-project',{hidden:Boolean(state.selectedId)});
  if (!state.selectedId) { renderControls(); return; }
  setWorkspaceText('thread-title',t ? threadName(t) : '正在读取会话…'); publishWorkspaceLabel('thread-title',{title:$('thread-title').textContent||''}); setWorkspaceText('thread-path',t?.cwd ? '目标机器 · ' + t.cwd : '');
  const own = controlled(), control = typeOf(state.detail?.controlState), busy = ['busy','occupied','active_writer','conflict'].includes(control);
  let badgeText=own ? '由网页执行' : busy ? '已被占用' : '查看模式';
  let noteText=own ? '此会话由当前工作台控制。发送消息会在目标机器执行。' : busy ? '此会话由其他入口管理，当前为查看模式。' : '正在确认会话的可用入口。';
  if(snapshotHistory())noteText=(own ? '历史来自快照。实时状态由目标机器控制连接确认。' : '历史来自快照，正在确认运行状态。')+(busy?' '+noteText:'');
  if(state.desktopMode){badgeText='由桌面执行';noteText='网页操作原桌面会话。模型设置用于下一轮，目标请在桌面设置。';}
  publishWorkspaceLabel('control-badge',{className:'control-badge'+(own?' controlled':busy?' busy':''),text:badgeText});
  publishWorkspaceLabel('control-note',{className:'control-note',text:noteText});
  renderMessages(); renderControls(); resizeInput(); renderThreads();
}
function renderDiagnostics() {
  const s=state.status||{},c=s.connection||{},entries=[];
  if(s.recoveryFailures?.length){entries.push({title:'历史会话恢复',messages:[recoveryMessage(s.recoveryFailures),...s.recoveryFailures.map(f=>f.threadId+'：'+f.message)]});}
  if(c.stage)entries.push({title:'当前阶段',messages:[stages[c.stage!]||c.stage]});
  if(s.service?.pid)entries.push({title:'目标机器服务',messages:['PID '+s.service.pid+(s.service.running?' · 运行中':' · 未运行')]});
  if(s.service?.protocolValidation){const v=s.service.protocolValidation;entries.push({title:'协议兼容性',messages:[`${v.version} · 已核验 ${v.methods} 项接口${v.cached?' · 使用已核验缓存':''}`,...protocolDiagnostics(v)]});}
  if(s.service?.installedVersion&&s.service.installedVersion!==s.service.version)entries.push({title:'引擎更新',messages:[`已安装 ${s.service.installedVersion}，当前运行 ${s.service.version}。任务结束后释放并重新连接，即可使用新引擎。`]});
  const all=[...(s.errors||[]),...state.errors].sort((a,b)=>(timestamp(b.time)?.getTime()||0)-(timestamp(a.time)?.getTime()||0)).slice(0,10);
  for(const e of all)entries.push({title:dateTime(e.time)+(e.stage?' · '+(stages[e.stage]||e.stage):''),messages:[e.message||messageOf(e)],error:true});
  renderDiagnosticsView({selectedId:state.selectedId,entries});
}
const renderRequests=createRequestRenderer({state,sidebar,sideChat:()=>sideChat,requests,questionDrafts,document,element:$,renderControls,renderThreads,notifyTaskEvent:(...args)=>notifyTaskEvent(...args),requestThread,requestPath,currentThread,threadName,pretty,respondRequest:(...args)=>respondRequest(...args),publishRequestCards});

async function loadStatus() { applyStatus(await api('/api/status')); renderStatus(); renderRequests(); return state.status; }
let accountViewVersion=0;
const catalogs=createCatalogReaders({state,version:()=>accountViewVersion,modelId,
  readModels:path=>api(path),readProjects:()=>api('/api/projects'),renderModels,renderProjects});
const {loadModels,loadProjects}=catalogs;
const createdThreads = new Map();
const loadThreads = createSidebarLoader({
  key:append=>JSON.stringify([state.status?.instanceId,state.status?.connection?.connectedAt,state.search,state.sidebarArchived,state.selectedId,append?state.threadCursor:null,append]),
  read:append=>readThreads(append,true),
});
const {readThreads,loadSidebarActivity,loadVisibleThreads}=createSidebarReader({state,createdThreads,connected,loadProjects,threadName,element:$,renderThreads,renderControls,api,loadThreads,recordError,toast,messageOf,requestAnimationFrame});
const {applyDetail,selectThread}=createThreadSelection({cancelNotification:cancelPendingNotification,state,location,history,document,closeNewChat,automations:()=>automations,toggleInspector:open=>toggleInspector(open),element:$,inputId,saveView,resizeInput,renderModels,renderThread,renderThreads,renderRequests,saveDetailSoon:()=>saveDetailSoon(),compactLayout,toggleSidebar:(...args)=>toggleSidebar(...args),refreshSelected:()=>refreshSelected(),scrollFollow:()=>scrollFollow,messageOf,recordError});
const {saveSoon:saveDetailSoon,restore:restoreDetail,cancelScheduled:cancelDetailSave}=createDetailRecovery({state,host:targetHost,read:readDetailCache,write:writeDetailCache,apply:applyDetail});
const readDetail=createDetailReader({state,sends:desktopSends,acknowledgeAttachments:pictures=>attachments?.acknowledge(pictures),
  reportView:()=>reportThreadView(),recordError:error=>recordError(error,'thread'),request:(...args)=>api(...args),
  input:()=>$('message-input'),resizeInput:()=>resizeInput(),saveSends:()=>saveDesktopSends(),
  now:()=>performance.now(),host:()=>targetHost,canDecompress:()=>typeof DecompressionStream==='function',
  applyPreview:preview=>applyDetail(preview,true),turns:()=>turns(),outputBases:values=>outputBases(values),
  decode:data=>decodeOutputs(data),hydrate:(data,bases)=>hydrateOutputs(data,bases),
  recordTiming:value=>{document.body.dataset.logRecovery=value;},defer:(run,delay)=>setTimeout(run,delay),refreshSoon:()=>scheduleDetailRefresh()});
const threadAccess=createThreadAccess({
  key:()=>JSON.stringify([targetHost,state.selectedId,state.selectionVersion,state.detailVersion]),
  ready:()=>usable()&&!state.busy.size,
  desktop:id=>api('/api/desktop/threads/'+encodeURIComponent(id)),
  resume:id=>api('/api/threads/'+encodeURIComponent(id)+'/takeover',{method:'POST'}),messageOf});
const readSelectedDetail=async(id:string,current:()=>boolean)=>{
  const detail=await readDetail(id,current);
  if(!current()||state.desktopMode)return detail;
  return threadAccess.resolve(id,detail,current);
};
const selectedRefresh=createSelectedRefresh({state,blocked:()=>newChatOpen,
  newChatOpen:()=>newChatOpen,restore:restoreDetail,read:readSelectedDetail,turns,merge:mergeLiveTurns,
  apply:applyDetail,updated:()=>{turnNavigation?.update();if(!openingNotification)void finishNotificationNavigation().catch(recordError);}});
const refreshSelected=selectedRefresh.refresh;
async function refreshWorkspace(forceModels = false, statusReady = false) {
  return workspaceRefresh(forceModels,statusReady);
}
const workspaceRefresh=createWorkspaceRefresh({showRefresh:(...args)=>showRefresh(...args),
  loadStatus:()=>loadStatus(),connected:()=>connected(),loadModels:force=>loadModels(force),
  loadProjects:()=>loadProjects(),loadThreads:(...args)=>loadThreads(...args),
  refreshSelected:()=>refreshSelected(),refreshAccountUsage:()=>refreshAccountUsage?.(true)});
const autoRefreshController=createAutoRefresh({hidden:()=>document.hidden,usable:()=>usable(),
  refreshing:()=>state.refreshing,pendingModels:()=>catalogs.pendingModels(),pendingProjects:()=>catalogs.pendingProjects(),
  showRefresh:(...args)=>showRefresh(...args),loadProjects:()=>loadProjects(),loadModels:force=>loadModels(force),
  checked:enabled=>{$('auto-refresh').checked=enabled;},host:()=>targetHost,
  save:(key,value)=>localStorage.setItem(key,value),recordError:(...args)=>recordError(...args)});
const setAutoRefresh=autoRefreshController.setEnabled;
const notificationDelivery=createNotificationDelivery({host:()=>targetHost,worker:()=>notificationSupport().worker,
  prepareWorker:()=>prepareNotificationWorker(),submitWorker:submitWorkerNotification,
  createNative:(title,options)=>new Notification(title,options),submitNative:submitNotification,
  diagnostic:()=>{},publish:publishNotificationView,focus:()=>window.focus(),open:openNotificationThread});
const pushSubscription=createPushSubscription({api,threadId:()=>newChatOpen?null:state.selectedId});
const notificationPreferences=createNotificationPreference({
  setPushEnabled:pushSubscription.setEnabled,host:()=>targetHost,support:()=>notificationSupport(),
  permission:()=>Notification.permission,requestPermission:()=>Notification.requestPermission(),
  prepareWorker:notificationDelivery.prepare,
  read:key=>localStorage.getItem(key),save:(key,value)=>localStorage.setItem(key,value),
  publish:publishNotificationView,recordError});
const setTaskNotifications=notificationPreferences.setEnabled;
async function reportPageNavigation(stage:string,target?:{host?:string;threadId?:string;clickId?:string;testId?:string;instanceId?:string;id?:string;script?:string;scope?:string;endpointHash?:string;windows?:number;mode?:string;error?:string;observedAt?:number},version='page-5'){
  navigationTraces.report({host:target?.host||navigationHost,stage,threadId:target?.threadId,clickId:target?.clickId,testId:target?.testId,
    selectedId:navigationStateReady?state.selectedId:null,visibility:document.visibilityState,version,observedAt:target?.observedAt||Date.now(),
    instanceId:target?.instanceId,id:target?.id,script:target?.script,scope:target?.scope,endpointHash:target?.endpointHash,windows:target?.windows,mode:target?.mode,error:target?.error});
}
async function openNotificationThread(target:{host?:string;threadId:string;clickId?:string}) {
  const {threadId,clickId}=target,host=target.host||targetHost;
  target={...target,host};
  const key=JSON.stringify(target);if(openingNotification===key)return;
  void reportPageNavigation('page-target',target);
  saveNotificationTarget(localStorage,target);
  history.replaceState(null,'',notificationTargetUrl(location.href,target));
  if(state.busy.has('create')){notificationWaitingForCreate=true;return;}
  if(host!==targetHost){
    if(!connectionIds.includes(host)){toast('通知对应的连接已不存在，请在侧栏选择可用连接。',true);history.replaceState(null,'',consumeNotificationTarget(localStorage,target,location.href));await acknowledgeNotificationClick(target.clickId);return;}
    flushDrafts();
    location.assign(notificationTargetUrl(location.href,target));return;
  }
  openingNotification=key;
  try{
    const selection=state.selectionVersion;
    const resolved=await api<{threadId:string;sideChat?:import('./services/side-chat').SideResponse & {parentThreadId:string}}>('/api/threads/'+encodeURIComponent(threadId)+'/notification-target');
    if(openingNotification!==key||state.selectionVersion!==selection)return;
    if(resolved.sideChat){
      const parent=resolved.sideChat.parentThreadId;
      await selectThread(parent,{notification:true});
      if(openingNotification!==key||state.selectionVersion!==selection+1||state.selectedId!==parent||state.historyError||state.detail?.thread?.id!==parent)return;
      sideChat!.openExisting(resolved.sideChat);
      void reportPageNavigation('page-opened',target);
      history.replaceState(null,'',consumeNotificationTarget(localStorage,target,location.href));
      await acknowledgeNotificationClick(target.clickId);
      return;
    }
    await selectThread(threadId,{notification:true});
    await finishNotificationNavigation(target);
    if(state.selectedId===threadId&&(state.historyError||!state.detail))void reportPageNavigation('page-failed',target);
  }catch(error){if(openingNotification===key){void reportPageNavigation('page-failed',target);toast(messageOf(error),true);recordError(error,'notification-navigation');}}
  finally{if(openingNotification===key)openingNotification=null;}
}
async function finishNotificationNavigation(target=pendingNotificationTarget(localStorage,location.href)){
  if(!target||target.host!==targetHost||state.selectedId!==target.threadId||state.detail?.thread?.id!==target.threadId||state.loadingDetail||state.detail?.recovering||state.historyError||state.busy.has('create'))return;
  void reportPageNavigation('page-opened',target);
  history.replaceState(null,'',consumeNotificationTarget(localStorage,target,location.href));
  await acknowledgeNotificationClick(target.clickId);
}
function cancelPendingNotification(){
  openingNotification=null;
  const target=pendingNotificationTarget(localStorage,location.href);if(!target)return;
  notificationWaitingForCreate=false;
  history.replaceState(null,'',consumeNotificationTarget(localStorage,target,location.href));
  void acknowledgeNotificationClick(target.clickId).catch(recordError);
}
async function acknowledgeNotificationClick(clickId?:string){
  if(!clickId)return;
  const registration=await navigator.serviceWorker?.getRegistration();registration?.active?.postMessage({type:'rcm-notification-consumed',clickId});
}
const sendTaskNotification=notificationDelivery.send;
const notifyTaskEvent=createTaskNotifications({enabled:()=>notificationPreferences.enabled()&&!pushSubscription.active(),
  permitted:()=>('Notification' in window)&&Notification.permission==='granted',host:()=>targetHost,
  thread:id=>state.threads.find(t=>t.id===id)||(state.selectedId===id?currentThread():null),
  known:id=>state.status?.controlledThreads?.includes(id!)||state.status?.subscribedThreads?.includes(id!),
  alias:()=>state.status?.host?.alias,threadName,notice:taskNotice,
  lock:(key,work)=>navigator.locks.request(key,work),preference:key=>localStorage.getItem(key),
  deliver:(key,send)=>deliverNotice(localStorage,key,send),send:(...args)=>sendTaskNotification(...args),
  acknowledge:key=>api('/api/notices/ack',{method:'POST',body:{key}}),
  diagnostic:()=>{},recordError});

const {connectRemote,disconnectRemote,takeoverThread,endThreadUse}=createConnectionActions({
  state,api,action,feedback:maintenanceFeedback,applyStatus,renderStatus,loadStatus,connected,refreshWorkspace,renderThread,usable,
  newChatOpen:()=>newChatOpen,applyDetail,recordError,messageOf,toast,input:()=>$('message-input').value,
  saveDrafts:()=>sessionStorage.setItem('rcm.drafts.'+targetHost,JSON.stringify([...state.drafts])),
  focusHandoff:()=>handoffControls!.focus(),handoffError:message=>handoffControls!.showError(message),
});
function maintenanceFeedback(message:string) {
  publishConnectionSettings({feedback:message});
}
async function reloadLogin() {
  const host=targetHost;
  if(!await confirmAction('请先在目标机器 Codex 中完成 ChatGPT 或 API Key 登录。此操作将重启 RCM 专用原生引擎以重新加载登录，影响该引擎的所有入口。请确认其他入口已断开，且任务已结束。系统会再次检查；失败消息不会自动重发。',{title:'重新加载登录',accept:'检查并重新加载',danger:true}))return;
  if(host!==targetHost)return;
  flushDrafts();maintenanceFeedback('');
  await action('release',async()=>{
    await api('/api/account/reload',{method:'POST',body:{allEntrancesDisconnected:true}});
    if(host!==targetHost)return;
    await refreshWorkspace(true);
    maintenanceFeedback('请核对当前账号，再继续发送消息。');
  });
}
async function releaseService() {
  if(!await confirmAction('将停止目标机器的专用服务，影响所有入口。请确认任务已结束，且其他入口已断开。停止后需在目标机执行 maintenance resume 才能重连。',{title:'停止目标服务',accept:'确认停止',danger:true}))return;
  maintenanceFeedback('');
  await action('release',async () => {
    try { await api('/api/service/release',{method:'POST',body:{allEntrancesDisconnected:true}}); if (state.detail) state.detail.controlled = false; await loadStatus(); renderThread(); maintenanceFeedback('可以在目标机器打开 Codex 桌面应用。重新连接前，请按连接维护说明恢复专用服务。'); }
    catch (caught) { const e=caught as import('./services/api').ApiError; if (e.status === 409) { const blockers = Array.isArray(e.details) ? e.details.map((b:{threadId:string;reason:string}) => (state.threads.find(t=>t.id===b.threadId)?.name || b.threadId) + '：' + b.reason).join('\n') : e.details ? pretty(e.details) : ''; throw new Error(messageOf(e) + (blockers ? '\n' + blockers : '') + '\n请先结束相关任务，再释放控制。'); } throw e; }
  });
}
const respondRequest=createRequestResponder({state,action,api,questionDrafts,document,element:$,sideChat:()=>sideChat,renderRequests,loadStatus,refresh:refreshSelected});

const createThreadFromDraft=createThreadSubmit({state,draft:newDraft,draftId:newDraftId,access:WEB_ACCESS,createdThreads,
  preferDesktop:()=>!composer!.isGoalPending()&&!composer!.options().threads.length,
  input:()=>$('message-input'),hasAttachments:()=>attachments!.has(),attachmentsPending:()=>attachments!.pending(),validate:(...args)=>composer!.validateSend(...args),toast,
  hideError:()=>{publishNewChatControls({errorHidden:true});},showError:error=>{publishNewChatControls({error:messageOf(error),errorHidden:false});},recordError,action,
  post:body=>api('/api/threads',{method:'POST',body}),moveAttachments:(...args)=>attachments!.moveDraft(...args),moveComposer:(...args)=>composer!.moveDraft(...args),close:closeNewChat,
  expandProject:id=>sidebar.expandProject(id),clearSearch:()=>{$('thread-search').value='';},saveView,applyDetail,renderThreads,
  send:()=>sendMessage(),loadThreads:()=>loadThreads(),loadStatus:()=>loadStatus()});
const submitMessage=createMessageSend({state,input:()=>$('message-input'),disabled:()=>$('send-message').disabled,
  newChatOpen:()=>newChatOpen,createThread:()=>createThreadFromDraft(),sendDesktop:()=>sendDesktopMessage(),host:()=>targetHost,
  captureAnnotation:()=>annotations!.capture(),annotatedText:(text,draft)=>annotatedText(text,draft.items),acknowledgeAnnotation:draft=>annotations!.acknowledge(draft),
  hasAttachments:()=>attachments?.has(),attachmentsPending:()=>attachments?.pending(),captureAttachments:()=>attachments!.capture(),acknowledgeAttachments:pictures=>attachments!.acknowledge(pictures),
  captureDraft:(id,text)=>state.drafts.capture(id,text),acknowledgeDraft:draft=>state.drafts.acknowledge(draft),usable,controlled,running,touch:touchInput,followUp:followUpAction,
  validate:(text,active)=>composer!.validateSend(text,active),options:()=>composer!.options(),goalPending:()=>composer!.isGoalPending(),prepare:(...args)=>composer!.prepareSend(...args),
  send:context=>sendAfterGoal({...context,api}),post:(path,body)=>api(path,{method:'POST',body}),receipts:sendReceipts,turns,action,
  renderMessages,followScroll:()=>scrollFollow?.schedule(),resize:resizeInput,upsert:upsertTurn,renderThread,refresh:()=>refreshSelected(),recordError,toast});
async function sendMessage(e?:Parameters<typeof submitMessage>[0],alternate=false){return submitMessage(e,alternate);}
const submitPlan=createPlanSubmit({state,newChatOpen:()=>newChatOpen,usable,controlled,running,
  desktopReady:()=>inputReady()&&state.detail?.desktop?.planSupported===true,
  desktopSend:(id,plan)=>api('/api/desktop/threads/'+encodeURIComponent(id)+'/message',{method:'POST',body:{messageId:crypto.randomUUID(),text:implementationText(plan),mode:'default',planTurnId:plan.turnId}}),
  completed:()=>completedPlan(turns()),text:implementationText,access:WEB_ACCESS,
  post:(path,body)=>api(path,{method:'POST',body}),upsert:upsertTurn,renderControls,renderThread,
  refresh:()=>refreshSelected(),recordError:(...args)=>recordError(...args)});
async function implementPlan(id:Parameters<typeof submitPlan>[0],plan:Parameters<typeof submitPlan>[1]){return submitPlan(id,plan);}
const sendDesktopMessage=createDesktopSend({state,input:()=>$('message-input'),
  captureAnnotation:()=>annotations!.capture(),annotatedText:(text,draft)=>annotatedText(text,draft.items),
  acknowledgeAnnotation:draft=>annotations!.acknowledge(draft),hasAttachments:()=>attachments?.has(),
  attachmentsPending:()=>attachments?.pending(),captureAttachments:()=>attachments!.capture(),acknowledgeAttachments:pictures=>attachments!.acknowledge(pictures),
  options:()=>composer!.options(),captureDraft:(id,text)=>state.drafts.capture(id,text),
  acknowledgeDraft:sent=>state.drafts.acknowledge(sent),sends:desktopSends,saveSends:()=>saveDesktopSends(),
  uuid:()=>crypto.randomUUID(),action:(...args)=>action(...args),post:(path,body)=>api(path,{method:'POST',body}),
  refresh:()=>refreshSelected(),resize:()=>resizeInput(),toast:(...args)=>toast(...args)});
const historyPagination=createHistoryPagination({state,busy:value=>publishWorkspaceRegion('messages-scroller',{busy:value}),
  action:(...args)=>action(...args),read:path=>api(path),turns,render:()=>renderThread()});
const interruptThread=createStopRequest({state,newChatOpen:()=>newChatOpen,context:stopContext,turns,kind:typeOf,
  desktopTurnId:()=>typeof state.detail?.desktop?.activeTurnId==='string'?state.detail.desktop.activeTurnId:null,
  controlled,running,feedback:stopFeedback,action:(...args)=>action(...args),api:(...args)=>api(...args),
  refresh:()=>refreshSelected(),recordError:(...args)=>recordError(...args)});
async function moreHistory(options={}) { return historyPagination(options); }
const messageInput=createMessageInput({input:()=>$('message-input'),id:inputId,suspended:()=>draftWritesSuspended,
  persist:(id,value)=>state.drafts.set(id,value),render:()=>renderControls(),send:(...args)=>sendMessage(...args),
  steerQueued:()=>{if(attachments?.has()||attachments?.pending()||annotations?.has()){if(!$('send-message').disabled)void sendMessage(undefined,true);return;}void queuedInputs?.steerFirst();},
  canSend:()=>!$('send-message').disabled,touch:touchInput,shouldSend:shouldSendOnEnter,now:()=>performance.now(),style:input=>getComputedStyle(input)});
function resizeInput() { messageInput.resize(); }
const updateScheduler=createUpdateScheduler({state,defer:(run,delay)=>window.setTimeout(run,delay),cancel:timer=>window.clearTimeout(timer),usable,
  renderMessages:()=>renderMessages(),renderRequests:()=>renderRequests(),renderControls:()=>renderControls(),
  refreshSelected:()=>refreshSelected(),refreshList:()=>loadThreads(false,false,true),report:error=>recordError(error,'thread')});
function scheduleStreamRender(kind='all') { updateScheduler.stream(kind); }
function scheduleDetailRefresh() { updateScheduler.detail(); }
function scheduleListRefresh() { updateScheduler.list(); }
let configurationUpdate:unknown;
const configurationSync=createVersionSync({flush:()=>{if(connectionSavePending())throw Error('Configuration save pending');flushDrafts();if(state.drafts.warned)throw Error('Draft persistence failed');},reload:()=>location.reload(),onError:()=>{if(!connectionSavePending())toast('草稿保存失败，请保留当前页面。',true);}});
configurationSync.receive({version:connectionConfig.configRevision});
document.defaultView!.addEventListener('rcm:configuration-idle',()=>{if(configurationUpdate)configurationSync.receive(configurationUpdate);});
document.addEventListener('compositionstart',configurationSync.compositionStart);
document.addEventListener('compositionend',configurationSync.compositionEnd);
const webVersionSync=createVersionSync({flush:()=>{flushDrafts();if(state.drafts.warned)throw Error("Draft persistence failed");},reload:()=>location.reload(),onError:()=>toast('草稿保存失败，请保留当前页面。',true)});
function receiveWebUpdate(data:unknown){
 webVersionSync.receive(data);
 window.dispatchEvent(new CustomEvent('rcm:system-update',{detail:data}));
}
document.addEventListener('compositionstart',webVersionSync.compositionStart);
document.addEventListener('compositionend',webVersionSync.compositionEnd);

const handleEvent=createEventHandler({state,sideChat:()=>sideChat,accountVersion:{next:()=>++accountViewVersion,get:()=>accountViewVersion},createdThreads,workspaceStarting:()=>workspaceStarting,
  renderThreads,renderProjects,renderModels,refreshAccountUsage:force=>refreshAccountUsage?.(force),catalogs,loadThreads,loadModels,loadProjects,connected,recordError,
  scheduleListRefresh,scheduleDetailRefresh,scheduleStreamRender,authRecoveryMessage,notifyTaskEvent,applyStatus,renderStatus,renderRequests,renderThread,resumeWorkspace,
  notifyManagerError,toast,messageOf,requestKey,updateExtensionNotice,upsertTurn,upsertItem,ensureTurn,turns});
const setupEvents=createEventConnection({lifecycle:{window,document},state,url:()=>targetUrl('/api/events?viewId='+threadViewId),createSource:url=>new EventSource(url),
  resetThreadView:()=>threadViewReporter.reset(),reconnectSideChat:()=>sideChat?.reconnect(),renderStatus,
  reportThreadView,resumeWorkspace,recordError,receiveWebUpdate,receiveConfiguration:data=>{configurationUpdate=data;configurationSync.receive(data);},handleEvent});
const {saveLayout,readLayout,setupResizableLayout,toggleSidebar,toggleInspector}=createLayoutController({element:$,compact:compactLayout});
function wireEvents() {
  automations=installAutomations({api,onOpen:()=>{},
    openSession:async(id,prompt)=>{await selectThread(id,{desktop:true});if(prompt&&state.selectedId===id){const previous=$('message-input').value;if(previous&&previous!==prompt){toast('管理会话已有未发送草稿，请先处理草稿，再返回定时任务继续。',true);$('message-input').focus();return;}$('message-input').value=prompt;state.drafts.set(id,$('message-input').value);resizeInput();renderControls();}$('message-input').focus();},
    openThread:id=>selectThread(id),notify:toast});
  installAutomationNavigation(()=>automations!.open(),()=>automations!.close());
  installDesktopControls({enter:()=>action('desktop-recover',async()=>{
      const id=state.selectedId,selection=state.selectionVersion;
      const detail=await api('/api/desktop/threads/'+encodeURIComponent(id!)+'/recover',{method:'POST'});
      if(id===state.selectedId&&selection===state.selectionVersion){applyDetail(detail,true);threadAccess.reset();}
    }),
    review:()=>action('desktop-review',async()=>{const threadId=state.selectedId;await api('/api/desktop/threads/'+encodeURIComponent(threadId!)+'/acknowledge',{method:'POST',body:{messageId:state.detail?.desktop?.unconfirmed||desktopSends[threadId!]?.messageId}});delete desktopSends[threadId!];saveDesktopSends();await refreshSelected();})});
  document.querySelector('.main-panel')!.classList.toggle('desktop-chat',state.desktopMode);
  setInterval(()=>{if(automations!.opened&&!document.hidden)void automations!.refresh();},15000);

  capacityRetry=installCapacityRetry({container:document.querySelector<HTMLElement>('.composer-region')!,storage:sessionStorage,refresh:refreshSelected,
    context:()=>({host:targetHost,id:state.selectedId,turns:!newChatOpen&&!state.desktopMode?turns():[],unavailableReason:!usable()?'连接尚未恢复，暂不能重试。':running()?'会话正在运行，暂不能重试。':!controlled()?'会话连接恢复后可重试。':'正在确认会话状态，暂不能重试。',ready:!newChatOpen&&!state.desktopMode&&usable()&&controlled()&&!running()&&!uncertainHistory()&&!state.loadingDetail&&!state.historyError&&!state.busy.size}),
    send:async(c,turnId,automatic)=>{try{const result=await api<{turn:NativeTurn}>('/api/threads/'+encodeURIComponent(c.id!)+'/retry-capacity',{method:'POST',body:{turnId,automatic,model:state.model,effort:state.effort,mode:composer!.options().mode}});if(c.host===targetHost&&c.id===state.selectedId){upsertTurn(result.turn);renderThread();scheduleDetailRefresh();}}catch(error){if(c.host===targetHost&&c.id===state.selectedId)await refreshSelected().catch(()=>{});throw error;}}});
  scrollFollow=installScrollFollow($('messages-scroller'),$('messages'));
  attachments=installAttachments({host:targetHost,context:()=>({id:inputId(),ready:inputReady(),busy:state.busy.has('message')||state.busy.has('create')}),changed:renderControls,notify:toast});
  handoffControls??=createHandoffControls({endUse:endThreadUse});
  projectFolders=configureProjectBrowser({api,context:()=>({host:targetHost,instance:state.status?.instanceId,ready:newChatOpen&&usable()&&!$('new-cwd').disabled,open:newChatOpen}),onSelect:(project:import('../contracts/native').NativeProject)=>{
    state.projects=[...state.projects.filter(p=>p.id!==project.id),project];updateNewProjects(project.roots[0]);renderProjects();renderControls();void loadThreads().catch(error=>recordError(error,'刷新新项目'));
  }});
  composer=installComposer({host:targetHost,api,implementPlan,modeChanged:renderControls,images:attachments!.images,context:()=>({id:inputId(),cwd:newChatOpen?newDraft.cwd:currentThread()?.cwd,ready:inputReady(),busy:state.busy.size>0,active:!newChatOpen&&running(),draft:newChatOpen,desktop:!newChatOpen&&state.desktopMode,planSupported:state.detail?.desktop?.planSupported===true,threadReferencesSupported:state.detail?.desktop?.threadReferencesSupported===true,turns:newChatOpen?[]:turns(),goal:newChatOpen?null:state.detail?.goal,goalError:newChatOpen?null:state.detail?.goalError}),refresh:refreshSelected,notify:toast});
  queuedInputs=installQueuedInputs({host:document.querySelector<HTMLElement>('#conversation>.composer-region')!,context:()=>({host:targetHost,id:state.selectedId,queue:state.detail?.queue,visible:!newChatOpen&&!state.desktopMode,ready:usable()&&controlled(),running:running(),supported:featureReady('queueWrite'),editable:featureReady('queueEdit')}),api,refresh:refreshSelected,onError:error=>toast(messageOf(error),true)});
  sideChat=installSideChat({api,requestsChanged:renderRequests,context:()=>({id:inputId(),cwd:currentThread()?.cwd,ready:usable(),model:state.model,effort:state.effort,models:state.models.map(m=>({id:modelId(m),label:m.displayName||modelId(m),defaultEffort:defaultEffort(modelId(m)),efforts:effortsFor(modelId(m)).map(e=>e.value)}))}),renderItem,notify:toast,selectionChanged:()=>{annotations?.refreshMarks();void reportThreadView().catch(e=>recordError(e,'thread'));}});
  annotations=installResponseAnnotations({host:targetHost,context:()=>({id:inputId()}),onSideChat:(fragment:import('./services/side-chat').SideFragment)=>sideChat!.open(fragment),sideSelections:()=>sideChat!.fragments(),changed:renderControls,notify:toast});
  const settings = $('composer-settings');
  document.addEventListener('click',event => { if (!settings.contains(event.target as Node)) settings.open = false; });
  settings.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); settings.open = false; settings.querySelector('summary')!.focus(); } });
  setupResizableLayout();
  notificationPreferences.sync();
  installNotificationActions({change:setTaskNotifications});
  installWorkspaceLifecycle({window,document,host:targetHost,syncNotificationPreference:notificationPreferences.sync,
    readPreference:key=>localStorage.getItem(key),autoRefreshInput:()=>$('auto-refresh'),setAutoRefresh,
    stopAutoRefresh:()=>autoRefreshController.stop(),flushDrafts});
  installThreadSync({window,document,
    canSync:()=>!newChatOpen&&(state.desktopMode?state.transport:connected())&&!state.status?.service?.releasing&&!!state.selectedId&&!state.busy.has('handoff:'+state.selectedId),
    refresh:refreshSelected,resume:resumeWorkspace,
    onError:(error:unknown)=>{if((error as {code?:string})?.code==='READ_SUSPENDED')return;const message='自动同步暂未成功，将自动重试：'+messageOf(error);if(state.historyError!==message){state.historyError=message;recordError(error,'sync');renderThread();}},
  });
  // Placeholder changes can wrap without changing the textarea width.
  new MutationObserver(resizeInput).observe($('message-input'), {attributes:true,attributeFilter:['placeholder']});
  let composerWidth = 0;
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== composerWidth) { composerWidth = width; requestAnimationFrame(resizeInput); }
  }).observe($('message-input'));
  installConnectionManager({api,targetId:targetHost,enabled:typeof connectionConfig.configRevision==='string',flush:()=>{flushDrafts();if(state.drafts.warned)throw Error('草稿保存失败，请保留当前页面。');}});
  installConnectionActions({connect:()=>connected()||connectionPending()?disconnectRemote():connectRemote(),reload:reloadLogin,release:releaseService});
  installWelcomeAction(() => connected() ? openNewDialog() : connectRemote());
  setWorkspaceControlAction('new-thread',openNewDialog); setWorkspaceControlAction('takeover',()=>{if(currentHandoff())return takeoverThread();threadAccess.reset();return refreshSelected();});
  setWorkspaceControlAction('refresh-all',() => action('refresh',() => refreshWorkspace(true)));
  $('project-list').addEventListener('scroll',loadVisibleThreads,{passive:true});
  new ResizeObserver(loadVisibleThreads).observe($('project-list'));
  const historyScroller = $('messages-scroller');
  let lastHistoryTop = historyScroller.scrollTop;
  const loadEarlierNearTop = () => { if (historyScroller.clientHeight > 0 && historyScroller.scrollTop < 100) moreHistory(); };
  historyScroller.addEventListener('scroll',() => {
    const top = historyScroller.scrollTop;
    if (top < lastHistoryTop) loadEarlierNearTop();
    lastHistoryTop = top;
  },{passive:true});
  historyScroller.addEventListener('wheel',event => { if (event.deltaY < 0) loadEarlierNearTop(); },{passive:true});
  historyScroller.addEventListener('keydown',event => { if (['ArrowUp','PageUp','Home'].includes(event.key)) loadEarlierNearTop(); });
  let searchTimer:ReturnType<typeof setTimeout> | undefined; setWorkspaceControlAction('thread-search',e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = (e.target as HTMLInputElement).value.trim(); loadThreads(); },300); });
  installSendActions({guide:()=>sendMessage(undefined,true),stop:interruptThread});
  messageInput.bind($('message-form'));
  installModelSelectActions({
    'model-select':value=>{if(state.desktopMode&&!newChatOpen){void updateDesktopSettings(value,defaultEffort(value));return;}state.model=value;state.effort=defaultEffort(state.model);fillEfforts($('effort-select'),state.model,state.effort);settings.open=false;settings.querySelector('summary')!.focus();renderControls();},
    'effort-select':value=>{if(state.desktopMode&&!newChatOpen){void updateDesktopSettings(state.model,value);return;}state.effort=value;settings.open=false;settings.querySelector('summary')!.focus();renderControls();},
  });
  installNewChatActions({retry:()=>{newDraft.complete();publishNewChatControls({errorHidden:true});renderControls();$('message-input').focus();},
    close:()=>{if(!state.busy.has('create'))closeNewChat();}});

  $('toggle-inspector').onclick = () => toggleInspector(); $('close-inspector').onclick = () => toggleInspector(false);
  $('open-sidebar').onclick = () => toggleSidebar();
  $('close-sidebar').onclick = () => { toggleSidebar(false); $('open-sidebar').focus(); };
  $('sidebar-backdrop').onclick = () => { if (compactLayout()) toggleSidebar(false); toggleInspector(false); };
  document.addEventListener('keydown',e => { if(e.defaultPrevented||document.querySelector('dialog[open]'))return; if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleSidebar(true); $('thread-search').focus(); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openNewDialog(); } if (e.key === 'Escape' && !compactLayout() && window.innerWidth <= 1050) toggleInspector(false); });
  toggleSidebar(!compactLayout() && readLayout('sidebar',true), false);
  toggleInspector(false);
  publishWorkspaceRegion('project-list',{hidden:false});
  prepareWorkspaceControlReasons();
  mobileUI = installMobileUI({openSidebar:()=>toggleSidebar(true,false),closeDrawers:()=>{toggleSidebar(false,false);toggleInspector(false);},layoutChanged:(mobile:boolean)=>{toggleSidebar(!mobile && readLayout('sidebar',true),false);toggleInspector(false);}});
  turnNavigation=installTurnNavigation({scroller:$('messages-scroller'),content:$('messages'),entryHost:document.querySelector<HTMLElement>('.mobile-more-panel')!,follow:scrollFollow,loadEarlier:moreHistory,loadDirectory:()=>api('/api/threads/'+encodeURIComponent(state.selectedId!)+'/turn-directory'),onError:message=>toast(message,true),context:()=>({visible:!newChatOpen&&Boolean(state.selectedId),ready:usable()&&!state.loadingDetail&&!state.historyError&&!state.detail?.recovering&&!selectedRefresh.pending(),turns:state.loadingDetail?[]:turns(),rendering:progressiveTurns.pending,renderHistory:()=>renderThread(),reveal:(id:string)=>progressiveTurns.reveal(id),uncertain:uncertainHistory(),totalTurns:state.detail?.totalTurns,hasEarlier:Boolean(state.historyCursor),cursor:state.historyCursor,loading:state.busy.has('history'),historyError:state.historyError})});
  installOfflineDraftGuard({window,state,flushDrafts,renderStatus,renderControls});
}
const init=createWorkspaceStartup({state,sidebar,document,location,sessionStorage,element:$,setInterval,targetHost,requestedHost,
  installSettings:()=>installSystemUpdate({api,flush:flushDrafts,resetCsrf:()=>{state.csrf='';}}),installAccess:()=>installMobile(api),showMobileError,
  installUsage:options=>refreshAccountUsage=installAccountUsage({details:options.details,api,connected,context:options.context}),showUsageDetails:text=>toast(text,false,3000,'account-usage',{information:true}),
  installBackup:imported=>installBrowserBackup(connectionConfig,flushDrafts,imported),suspendDraftWrites:()=>{draftWritesSuspended=true;},installNavigation:installInspectorNavigation,
  renderControls,renderThreads,renderStatus,renderThread,connected,connectionPending,loadThreads,wireEvents,setupEvents,dispatchReady:()=>window.dispatchEvent(new Event('rcm-ready')),
  setNavigationReady:()=>{notificationNavigationReady=true;},pendingNotification:()=>pendingNotification,clearPendingNotification:()=>{pendingNotification=null;},
  openNotificationThread,restoreDetail,readCsrf:()=>api('/api/csrf'),csrfReady:()=>{void navigationTraces.flush();},loadStatus,refreshWorkspace,connectRemote,recordError,messageOf,publishConnectionBanner,finishStarting:()=>{workspaceStarting=false;void reportPageNavigation('page-ready');requestNotificationTarget();}});

if(state.selectedId)$('message-input').value=state.drafts.get(state.selectedId)||'';
await init();

publishConnectionSelect({value:targetHost});
installConnectionSelectAction(value=>{if(state.busy.has('create'))return;rememberHost(value);if(inputId())state.drafts.set(inputId()!,$('message-input').value);try{sessionStorage.setItem('rcm.drafts.'+targetHost,JSON.stringify([...state.drafts]));}catch{}const url=new URL(location.href);url.searchParams.set('host',value);url.searchParams.delete('thread');location.assign(url);});

const setClearRecoveryDisabled=installClearRecovery(async()=>{flushDrafts();setClearRecoveryDisabled(true);cancelDetailSave();try{await clearDetailCache();location.reload();}catch(e){setClearRecoveryDisabled(false);toast('无法清除日志缓存：'+messageOf(e),true);}});
