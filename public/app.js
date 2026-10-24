import {createNotificationDelivery} from '../src/web/services/notification-delivery';
import {createNotificationPreference} from '../src/web/services/notification-preference';
import {createTaskNotifications} from '../src/web/services/task-notifications';
import {createAutoRefresh} from '../src/web/services/auto-refresh';
import {createDetailRecovery} from '../src/web/services/detail-recovery';
import {createLayoutController} from '../src/web/services/layout';
import {connectionBanner} from '../src/web/services/connection-banner';
import {publishConnectionIndicators,publishConnectionBanner} from '../src/web/components/ConnectionIndicators';
import {publishConnectionSettings,installConnectionActions} from '../src/web/components/ConnectionSettings';
import {publishNotificationView,installNotificationActions,appendNotificationDiagnostic} from '../src/web/components/NotificationControls';
import {createWorkspaceRefresh} from '../src/web/services/workspace-refresh.ts';
import {createDetailReader} from '../src/web/services/detail-reader.ts';
import {createApiClient} from '../src/web/services/api.ts';
import {createSidebarLoader} from '../src/web/services/sidebar-loader.ts';
import {createCatalogReaders} from '../src/web/services/catalogs.ts';
import {createSelectedRefresh} from '../src/web/services/selected-refresh.ts';
import {installDeferredTool} from './deferred-tool.js';
import {renderSelectOptions,renderDiagnosticsView,renderRefreshStatusView,publishWorkspace,createWorkspaceState} from '../src/web/views.tsx';
import {completedGoalPlacement,renderCompletedGoal} from './goal-toolbar.js';
import {installQueuedInputs} from '../src/web/components/QueuedInputs.tsx';
let queuedInputs;
import {createSendReceipts,sendReceiptLabels} from './connection-state.js';
const sendReceipts=createSendReceipts();
import {installResponseAnnotations,annotatedText} from './response-annotations.js';
import {installSideChat} from './side-chat.js';
let annotations,sideChat;
import {authRecoveryMessage} from './shared/account-state.js';
import {RenderCache,renderSignature,ProgressiveTurns} from './render-cache.js';
import {createToasts,confirmAction,createStopFeedback} from './feedback.js';
const stopFeedback=createStopFeedback();
const stopContext=()=>JSON.stringify([targetHost,state.desktopMode,state.selectedId]);
import {configureProjectBrowser} from './project-picker.js';
let projectFolders;
import {installCapacityRetry} from './capacity-retry.js';
let capacityRetry;
import {createVersionSync} from './system-update.js';
import {installSystemUpdate} from '../src/web/components/SystemUpdate';
import {installAccountUsage} from '../src/web/components/AccountUsage';
let refreshAccountUsage;
import {sendAfterGoal} from './goal-submit.js';
import {notificationSupport,prepareNotificationWorker,submitWorkerNotification} from './notification-platform.js';
import {deliverNotice,submitNotification} from './notification-delivery.js';
import {asyncQuestions,QuestionDrafts} from './questions.js';
import {questionForm} from './question-form.js';
import {fileLink,closeFileViewer} from './message-files.js';
import {notifyManagerError, recoveryMessage, selectedRecoveryMessage} from './recovery-state.js';
import {processSummary,renderProcessSummary} from './process-summary.js';
import {activitySource,conversationActivity,renderConversationActivity} from './activity.js';
import {installTurnNavigation} from './turn-navigation.js';
let scrollFollow,scrollContext,turnNavigation;
import {userMessageContent,itemImageUrl,isRasterImage,imageCard} from './message-media.js';
import {markdown} from './message-body.js';
import {userMessageTime, timedTurnGroups} from './message-time.js';
import {renderTurnFiles} from './turn-files.js';
import {reconcileMessages} from './message-dom.js';
import {NewChatDraft} from './new-chat.js';
import {installAttachments} from './attachments.js';
let attachments;
import {Sidebar,projectFolderOptions} from './sidebar.js';
import {DraftStore, shouldSendOnEnter, coalesceRefresh, followUpAction} from './input-state.js';
import {installAutomations} from './automations.js';
let automations;
import {installThreadSync} from './thread-sync.js';
import {installMobileUI, compactLayout, touchInput, installScrollFollow} from './mobile-ui.js';
let mobileUI, draftWritesSuspended = false;
import {createHandoffControls} from './thread-handoff.js';
let handoffControls;
import {installBrowserBackup} from '../src/web/components/BrowserBackup';
import {installComposer, WEB_ACCESS,implementationText,completedPlan} from './composer.js';
import {installMobile,showMobileError} from '../src/web/components/MobileAccess.tsx';
let composer;
import {readDetailCache, writeDetailCache, clearDetailCache, outputBases, hydrateOutputs, decodeOutputs} from './detail-cache.js';
import {outputWindow, OUTPUT_WINDOW_SIZE} from './output-window.js';
import {updateExtensionNotice, renderExtensionNotice, selectConnectionStatus, userContentKey, mergeLiveTurns, taskNotice, backgroundActivity} from './connection-state.js';
function savedHost() { try { return localStorage.getItem('rcm.connection'); } catch { return null; } }
const requestedHost = new URL(location.href).searchParams.get('host');
let pendingNotification=null, notificationNavigationReady=false;
navigator.serviceWorker?.addEventListener('message',event=>{
  const data=event.data;
  if(data?.type!=='rcm-notification-click'||!data.threadId)return;
  if(notificationNavigationReady)openNotificationThread(data);else pendingNotification=data;
});
const connectionConfig=await readConnections();
async function readConnections(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch('/api/connections',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(response.status===401){location.reload();throw new Error('登录已失效，请重新配对。');}
    if(!response.ok)throw new Error('无法读取连接配置。');
    return await response.json();
  } finally {clearTimeout(timer);}
}
const connectionIds=connectionConfig.data.map(c=>c.id);
const targetHost=connectionIds.includes(requestedHost)?requestedHost:connectionIds.includes(savedHost())?savedHost():connectionConfig.defaultConnection;
renderSelectOptions(document.getElementById('connection-select'),connectionConfig.data.map(c=>({value:c.id,label:c.host.alias})),connectionConfig.data[0]?.id||'');
function savedView() { try { return JSON.parse(sessionStorage.getItem('rcm.view.'+targetHost)||'{}'); } catch { return {}; } }
function pendingDesktopSends(){try{return JSON.parse(sessionStorage.getItem('rcm.desktopSends.'+targetHost)||'{}');}catch{return {};}}
const desktopSends=pendingDesktopSends();
function saveDesktopSends(){try{sessionStorage.setItem('rcm.desktopSends.'+targetHost,JSON.stringify(desktopSends));}catch{toast('浏览器无法保存发送回执，请先核对原始会话再重试。',true);}}
function saveView() { try { sessionStorage.setItem('rcm.view.'+targetHost,JSON.stringify({selectedId:state.selectedId,projectId:state.projectId,desktopMode:state.desktopMode})); } catch {} }
function rememberHost(host) { try { localStorage.setItem('rcm.connection',host); } catch {} }
rememberHost(targetHost);
const targetUrl=path=>path+(path.includes('?')?'&':'?')+'host='+targetHost;
const threadViewId=crypto.randomUUID();let threadViewRevision=0,threadViewReport=null;
function reportThreadView(){
  if(!state.transport)return Promise.resolve();
  const threadId=newChatOpen||state.desktopMode||automations?.opened?null:state.selectedId||null;
  const sideThreadId=sideChat?.visibleId||null;
  const key=JSON.stringify([targetHost,threadId,sideThreadId,state.status?.instanceId,state.status?.connection?.connectedAt]);
  if(threadViewReport?.key===key)return threadViewReport.promise;
  const report={key},version=state.detailVersion;threadViewReport=report;
  report.promise=api('/api/thread-view',{method:'POST',body:{viewId:threadViewId,threadId,sideThreadId,revision:++threadViewRevision}}).then(result=>{
    if(threadViewReport===report&&threadId&&state.detailVersion!==version)scheduleDetailRefresh();
    return result;
  }).catch(error=>{if(threadViewReport===report)threadViewReport=null;throw error;});
  return report.promise;
}
const retiredStatusInstances=new Set();
function applyStatus(status){
  const next=selectConnectionStatus(state.status,status,retiredStatusInstances);
  const previous=state.status;
  const connectionChanged=previous&&(previous.instanceId!==next.instanceId||previous.connection?.state!==next.connection?.state||previous.connection?.connectedAt!==next.connection?.connectedAt);
  if(connectionChanged){
    state.listVersion++;state.loadingThreads=false;
    for(const thread of state.threads||[]){delete thread.activity;thread.status={type:'unknown'};}
    if(state.detail){
      state.detail.backgroundTerminals={error:'连接已变化，正在重新核对后台命令。'};
      if(state.detail.thread){delete state.detail.thread.activity;state.detail.thread.status={type:'unknown'};}
    }
  }
  if(previous&&(connectionChanged||
    previous.controlledThreads?.includes(state.selectedId)!==next.controlledThreads?.includes(state.selectedId)||
    Boolean(previous.handoffs?.some(h=>h.threadId===state.selectedId))!==Boolean(next.handoffs?.some(h=>h.threadId===state.selectedId))))state.detailVersion++;
  if(state.status?.instanceId&&next.instanceId!==state.status.instanceId){
    state.csrf='';state.localRequests=[];
    if(state.detail){state.detail.controlled=false;state.detail.controlState='viewing';state.detail.pendingRequests=[];}
  }
  state.status=next;
}

const $ = id => document.getElementById(id);
const state = createWorkspaceState({
  desktopMode:Boolean(savedView().desktopMode), status: null, models: [], projects: [], threads: [], selectedId: savedView().selectedId || null, detail: null,
  sidebar:null, sidebarArchived:false, selectedArchived:false, projectId: savedView().projectId || null, search: '', threadCursor: null, historyCursor: null, loadedOlderHistory: false,
  model: '', effort: '', csrf: '', transport: false, busy: new Set(), loadingThreads: false, loadingModels: false, loadingProjects: false, threadListSource: null,
  runtimeNotices: new Map(), loadingDetail: false, errors: [], localRequests: [], drafts: new DraftStore({storage:()=>sessionStorage,host:targetHost,onError:()=>toast('浏览器无法保存草稿，请先复制重要内容。',true)}), selectionVersion: 0,
  listVersion: 0, detailVersion: 0, threadPageError: false, historyError: '', eventSource: null, lastSync: null, refreshScope: '', refreshMessage: '', refreshing: false, streamRender: false, requestSignature: '',
});
const questionDrafts=new QuestionDrafts(sessionStorage,targetHost,()=>toast('问题草稿暂未保存，请先复制回答。',true));
const newDraftId='local:new-chat-draft';
const newDraft=new NewChatDraft(sessionStorage,'rcm.new-chat.'+targetHost);
let newChatOpen=false;
const inputId=()=>newChatOpen?newDraftId:state.selectedId;
const inputReady=()=>state.desktopMode&&!newChatOpen?Boolean(state.transport&&state.detail?.desktop?.available):newChatOpen?usable()&&Boolean(newDraft.cwd):usable()&&controlled()&&!state.selectedArchived;
function rememberNewDraft(){try{newDraft.save();}catch{toast('新会话草稿设置暂未保存，请保留当前页面。',true);}}
function closeNewChat(restore=true){
  if(!newChatOpen)return;
  state.drafts.set(newDraftId,$('message-input').value);newChatOpen=false;
  $('conversation').append(document.querySelector('.composer-region'));
  $('new-chat-page').hidden=true;document.querySelector('.main-panel').classList.remove('new-chat-open');document.querySelector('.main-panel').classList.toggle('desktop-chat',restore&&state.desktopMode);
  if(restore){$('message-input').value=state.drafts.get(state.selectedId)||'';renderThread();resizeInput();queueMicrotask(()=>void reportThreadView().catch(e=>recordError(e,'thread')));}
}
function flushDrafts() {
  if (draftWritesSuspended) return;
  if (inputId()) state.drafts.set(inputId(),$('message-input').value);
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
const effortNames = {none:'无', minimal:'最低', low:'低', medium:'中', high:'高', xhigh:'超高', max:'最高', ultra:'极高'};
const statusNames = {unknown:'状态未确认',notLoaded:'尚未加载', idle:'就绪', active:'执行中', inProgress:'执行中', in_progress:'执行中', running:'执行中', completed:'已完成', interrupted:'已停止', failed:'失败', systemError:'服务错误', pending:'等待中', declined:'已拒绝', stopped:'已停止', success:'成功'};
const stages = {ssh:'SSH 连接', identity:'身份核验', service:'目标机器服务', protocol:'协议连接', initialize:'协议初始化', models:'模型目录', threads:'会话列表', connected:'已连接', connecting:'正在连接', disconnected:'未连接', reconnecting:'正在重连', error:'连接失败', ready:'已连接'};

function el(tag, className, content) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (content != null) n.textContent = String(content);
  return n;
}
function icon(name, extra = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'icon' + (extra ? ' ' + extra : ''));
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u); return s;
}
function clear(n) { n.replaceChildren(); return n; }
function setText(id, value) { $(id).textContent = value == null || value === '' ? '—' : String(value); }
function pretty(value) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function messageOf(value) {
  const message=typeof value === 'string' ? value : value?.message || pretty(value);
  if(value?.code==='RPC_TIMEOUT'||/timed out after \d+ ms/.test(message)) return value?.readOnly?'读取目标机器超时，已有内容和草稿保留，请重试刷新。':'目标机器响应超时，操作结果尚未确认。请先核对会话记录，避免重复创建或发送。';
  if(/ssh: connect to host .*Operation timed out/i.test(message)) return '无法连接目标机器。请确认目标机器在线且网络可达，然后重新连接。';
  return message;
}
function typeOf(value) { return typeof value === 'string' ? value : value?.type || ''; }
function currentThread() { return state.detail?.thread; }
function turns() { return state.detail?.turns || currentThread()?.turns || []; }
function connected() { return ['connected','ready'].includes(state.status?.connection?.state); }
function connectionPending() {return ['connecting','reconnecting'].includes(state.status?.connection?.state);}
function featureReady(name) {return state.status?.service?.protocolValidation?.features?.[name]?.supported!==false;}
function sessionLabel(session) {
  if(!usable()||!session||typeOf(session.status)==='unknown')return '状态未确认';
  if(session.pendingRequests)return '待处理';
  if(typeOf(session.status)==='active')return '执行中';
  if(session.lastTurnStatus==='failed')return '失败';
  if(session.lastTurnStatus==='completed')return '已完成';
  if(session.lastTurnStatus==='interrupted')return '已停止';
  return statusNames[typeOf(session.status)]||'状态未确认';
}
function usable() { return connected() && state.transport && !state.status?.service?.releasing; }
function requestKey(r) { return r.key ?? (typeof r.id + ':' + String(r.id)); }
function requestPath(r) { return String(r.key ?? r.id); }
function controlled() {
  if (!state.detail || !state.selectedId || state.detail.recovering) return false;
  if(state.busy.has('handoff:'+state.selectedId)||currentHandoff())return false;
  return Boolean(state.detail.controlled || state.status?.controlledThreads?.includes(state.selectedId));
}
function currentHandoff() {
  if(Array.isArray(state.status?.handoffs))return state.status.handoffs.find(v=>v.threadId===state.selectedId)||null;
  return state.detail?.handoff||null;
}
function snapshotHistory() { return state.detail?.historySource === 'snapshot' || currentThread()?.historySource === 'snapshot'; }
function uncertainHistory() { return snapshotHistory() && !controlled() && !state.desktopMode; }
function running() {
  if(state.desktopMode)return typeOf(currentThread()?.status)==='active';
  if (uncertainHistory()) return false;
  return turns().some(t => ['inProgress','in_progress','running'].includes(typeOf(t.status))) || typeOf(currentThread()?.status) === 'active';
}
function requestThread(r) { return r.threadId || r.params?.threadId; }
function requests() {
  const all = [...(state.status?.pendingRequests || []), ...(state.detail?.pendingRequests || []), ...state.localRequests,...(sideChat?.requests()||[]), ...(state.detail?.recovering?[]:asyncQuestions(turns(),state.selectedId))];
  const map = new Map(); all.forEach(r => { if (r?.id != null) map.set(requestKey(r), r); });
  return [...map.values()];
}
function needsAnswer(id) {
  return usable()&&requests().some(r=>requestThread(r)===id&&r.params?.questions?.length&&!questionDrafts.get(r).sent);
}
function threadName(t) {
  const name = String(t?.name || t?.title || t?.preview || '未命名会话').replace(/\s+/g, ' ').trim();
  return name.length > 80 ? name.slice(0, 80) + '…' : name;
}
function baseName(path) { return String(path || '').replace(/\/$/, '').split('/').pop() || path || '项目'; }
function timestamp(value) {
  if (value == null) return null;
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number < 1e12 ? number * 1000 : number) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function dateTime(value, short = false) {
  const d = timestamp(value); if (!d) return '—';
  return new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', ...(short ? {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'} : {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}),hour12:false}).format(d);
}
function relativeTime(value) {
  const d = timestamp(value); if (!d) return '';
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return '刚刚'; if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前';
  if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前'; if (sec < 604800) return Math.floor(sec / 86400) + ' 天前';
  return new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(d);
}
let refreshNoticeTimer = null;
function renderRefresh() {
  renderRefreshStatusView({refreshing:state.refreshing,message:state.refreshMessage,
    time:state.lastSync ? state.refreshScope + '最后更新：' + dateTime(state.lastSync) + '（北京时间）' : '尚未成功刷新'});
  for (const id of ['refresh-all','refresh-projects']) {
    $(id).classList.toggle('refreshing', state.refreshing);
    $(id).setAttribute('aria-busy', String(state.refreshing));
  }
  renderControls();
}
async function showRefresh(scope, work) {
  if (state.refreshing) return;
  clearTimeout(refreshNoticeTimer); refreshNoticeTimer = null;
  state.refreshing = true;
  state.refreshMessage = '正在刷新' + scope + '，请稍候…'; renderRefresh();
  try {
    await work();
    state.lastSync = new Date(); state.refreshScope = scope;
    state.refreshMessage = '';
  } catch (error) {
    state.refreshMessage = scope + '刷新失败：' + (error.message || String(error));
    recordError(error,'refresh');
    refreshNoticeTimer=setTimeout(()=>{refreshNoticeTimer=null;state.refreshMessage='';renderRefresh();},8000);
  } finally { state.refreshing = false; renderRefresh(); }
}
function recordError(error, stage = 'client') {
  const message = messageOf(error);
  const last = state.errors[state.errors.length - 1];
  if (!last || last.message !== message || Date.now() - last.time > 5000) state.errors.push({message,stage,time:Date.now()});
  state.errors = state.errors.slice(-20); renderDiagnostics();
}
function toast(...args) { return (toast.presenter??=createToasts({region:$('toasts'),make:el,icon}))(...args); }

const api=createApiClient({targetUrl,csrf:{get:()=>state.csrf,set:token=>{state.csrf=token;}},flushDrafts,reload:()=>location.reload()});

async function action(key, fn) {
  if (state.busy.has(key)) return;
  state.busy.add(key); renderControls();
  try { return await fn(); }
  catch (e) { recordError(e,key); toast(messageOf(e),true,11000); }
  finally { state.busy.delete(key); if(['connect','disconnect','release'].includes(key))renderStatus();else renderControls(); }
}

function renderStatus() {
  void refreshAccountUsage?.();
  const s = state.status || {}, c = s.connection || {}, h = s.host || {}, service = s.service || {};
  const conn = c.state || 'disconnected';
  if (state.detail && Array.isArray(s.controlledThreads)) state.detail.controlled = s.controlledThreads.includes(state.selectedId);
  if (Array.isArray(s.pendingRequests)) {
    const keys = new Set(s.pendingRequests.map(requestKey));
    state.localRequests = state.localRequests.filter(r => keys.has(requestKey(r)));
    if (state.detail) state.detail.pendingRequests = (state.detail.pendingRequests || []).filter(r => keys.has(requestKey(r)));
  }
  const variant = connected() && state.transport ? 'connected' : ['connecting','reconnecting'].includes(conn) ? 'connecting' : conn === 'error' || conn === 'failed' ? 'error' : '';
  const label = connected() && !state.transport ? '实时连接中断' : stages[conn] || conn;
  document.title = (currentThread() ? threadName(currentThread()) + ' · ' : '') + 'Codex 工作台';
  publishConnectionIndicators({ready:true,variant,label,name:h.alias || '目标机器',address:h.hostname || '目标机器'});
  publishConnectionSettings({ready:true,variant,label,host:h.hostname || h.alias || '目标机器',user:h.user,
    version:service.version || h.version,connectedAt:dateTime(c.connectedAt),transport:state.transport ? '实时通道已连接' : '实时通道未连接',
    icon:connected()||connectionPending() ? 'close' : 'link',connectLabel:state.busy.has('disconnect') ? '正在断开…' : connectionPending()?'取消连接':connected() ? '断开本机连接' : '连接目标机器'});
  const welcome = $('welcome-connect'); clear(welcome); welcome.append(icon(connected() ? 'plus' : 'link'),el('span','',connectionPending() ? '正在连接…' : connected() ? '新建目标机器会话' : '连接 ' + (h.alias || '目标机器')));
  setText('welcome-footnote',connected() ? '已连接。选择左侧会话，或新建目标机器会话。' : '等待连接。此页面不包含演示会话。');
  renderControlOverview();
  renderControls(); renderDiagnostics(); if(!sidebar.menu&&!sidebar.dialog&&!sidebar.drag)renderThreads();
}
function renderControlOverview() {
  const sessions=state.status?.controlledSessions||[],counts=new Map();
  sessions.forEach(session=>{const label=sessionLabel(session);counts.set(label,(counts.get(label)||0)+1);});
  setText('control-overview',sessions.length?'本工作台 · '+[...counts].map(([label,count])=>label+' '+count).join(' · '):'尚未接管会话');
  document.querySelectorAll('.thread-runtime').forEach(badge=>{
    const session=sessions.find(item=>item.id===badge.dataset.threadId);
    badge.textContent=session?sessionLabel(session):'查看模式';
  });
}
function renderConnectionBanner() {
  const s=state.status||{}, c=s.connection||{}, service=s.service||{}, conn=c.state||'disconnected';
  publishConnectionBanner(connectionBanner({transport:state.transport,error:c.error?messageOf(c.error):'',connection:conn,
    stage:c.stage,stageLabel:stages[c.stage],connected:connected(),desktopMode:state.desktopMode,loginRecovery:s.loginRecovery,
    limited:service.protocolValidation?.status==='limited',features:service.protocolValidation?.features,
    recoveryMessage:()=>selectedRecoveryMessage(s.recoveryFailures,newChatOpen?null:state.selectedId)}));
}
function renderControls() {
  publishWorkspace(state);
  annotations?.render();sideChat?.sync();queuedInputs?.render();
  queueMicrotask(()=>turnNavigation?.update());
  capacityRetry?.tick();
  renderConnectionBanner();
  const ready = usable(), own = newChatOpen||controlled()&&!state.selectedArchived, active = !newChatOpen&&running();
  const background = backgroundActivity(state.detail,{controlled:own,connected:ready});
  const stopping=!newChatOpen&&stopFeedback.observe(stopContext(),{confirmed:!state.detail?.recovering&&(state.desktopMode?state.transport&&state.detail?.desktop?.available:ready&&own&&!uncertainHistory()),turns:turns(),status:currentThread()?.status,background:Array.isArray(state.detail?.backgroundTerminals?.data)?background.state:'unknown'});
  const stopLabel=stopping?(state.transport&&(state.desktopMode?state.detail?.desktop?.available:ready)?'停止中…':'停止状态待确认'):'停止';
  const handoff=currentHandoff(),handing=state.busy.has('handoff:'+state.selectedId)||handoff?.state==='checking';
  handoffControls??=createHandoffControls({endUse:endThreadUse});
  handoffControls.render({id:newChatOpen||state.desktopMode?null:state.selectedId,context:targetHost+':'+state.selectedId+':'+state.selectionVersion,running:active,owned:Boolean(state.detail?.controlled||state.status?.controlledThreads?.includes(state.selectedId)),handoff,connected:ready,
    supported:state.status?.service?.protocolValidation?.features?.handoff?.supported===true,busy:handing,archived:state.selectedArchived,conflict:state.detail?.controlState==='conflict'});
  const posting = state.busy.has('message')||state.busy.has('create'), switching = state.busy.has('takeover'), creating = state.busy.has('create');
  $('connection-select').disabled=creating;
  $('new-thread').disabled = !!state.status?.loginRecovery || !ready || !featureReady('create') || creating || !state.models.length || state.loadingModels;
  publishConnectionSettings({connectDisabled:state.busy.has('connect') || state.busy.has('disconnect') || state.busy.has('release')});
  $('welcome-connect').disabled = connectionPending() || state.busy.has('connect') || state.busy.has('disconnect') || (connected() && (!ready || !state.models.length||!featureReady('create')));
  publishConnectionSettings({reloadDisabled:!ready||!featureReady('release')||state.busy.has('release'),
    releaseDisabled:!ready || !featureReady('release') || !state.status?.service?.running || state.busy.has('release'),
    releaseLabel:state.busy.has('release') ? '正在检查并释放…' : '停止目标服务（影响所有入口）'});
  $('refresh-projects').disabled = !ready || state.refreshing; $('refresh-all').disabled = state.refreshing || state.busy.has('refresh');
  $('thread-search').disabled = !connected();
  $('model-select').disabled = !ready || !state.models.length || state.loadingModels;
  $('effort-select').disabled = !ready || !state.model || !effortsFor(state.model).length || state.loadingModels;
  const input = $('message-input'); input.disabled = !ready || !own || posting || handing;
  const followUp=followUpAction({active,touch:touchInput()});
  input.placeholder = !ready ? '连接后继续…' : state.selectedArchived ? '恢复会话后可继续…' : !own ? '接管后发送消息…' : active ? (followUp==='queue'?'排队发送，或 ⌘/Ctrl+Enter 引导…':'补充要求…') : '发送消息…';
  const hasModel = Boolean(modelFor(state.model));
  const hasEffort = effortsFor(state.model).some(e => e.value === state.effort);
  $('send-message').disabled = !!state.status?.loginRecovery || !ready || !own || !featureReady(active?(followUp==='queue'?'queueWrite':'steer'):'message') || posting || attachments?.pending() || (!input.value.trim()&&!attachments?.has()&&!annotations?.has()) || (!active && (!hasModel || !hasEffort));
  $('send-message').setAttribute('aria-label',active ? (followUp==='queue'?'排队发送':'引导当前任务') : '发送消息');
  const guide=$('guide-message');if(guide){guide.hidden=!active||touchInput()||state.desktopMode;guide.disabled=!ready||!own||posting||attachments?.pending()||!featureReady('steer')||(!input.value.trim()&&!attachments?.has()&&!annotations?.has());}
  $('message-form').setAttribute('aria-busy',String(posting));
  $('send-message').title = posting ? '正在发送…' : active ? (followUp==='queue'?'排队发送':'引导当前任务') : '发送消息';
  $('interrupt').hidden = !active&&background.state!=='running'&&!stopping; $('interrupt').disabled = !ready || !own || !featureReady('stop') || state.busy.has('interrupt') || stopping;
  $('takeover').hidden = own || !state.selectedId || state.selectedArchived; $('takeover').disabled = !ready || !featureReady('takeover') || switching || handing || !state.selectedId;
  $('takeover').querySelector('span').textContent = switching ? '正在接管…' : handoff ? '在网页继续' : '接管会话';
  const availability = $('composer-availability');
  const unavailable = !ready ? '连接恢复后可继续，草稿已保留。' : state.selectedArchived ? '此会话已归档，恢复后可继续。' : handing ? '正在确认交还状态，草稿已保留。' : posting ? '' : !featureReady(active?(followUp==='queue'?'queueWrite':'steer'):'message') ? '当前引擎暂不支持此操作。' : active && !featureReady('stop') ? '当前引擎暂不支持停止，仍可补充要求。' : own && !active && !hasModel ? '请选择一个可用模型。' : own && !active && !hasEffort ? '请选择思考档位。' : '';
  availability.textContent = unavailable; availability.hidden = !unavailable;
  $('new-thread').setAttribute('aria-description',!ready ? '连接恢复后可新建会话。' : !state.models.length ? '正在等待目标机器模型目录。' : creating ? '正在创建，请稍候。' : '');
  controlReason('new-thread',$('new-thread').getAttribute('aria-description') || (!featureReady('create') ? '当前引擎不支持创建会话。' : '正在读取模型目录…'));
  controlReason('takeover',!ready ? '连接恢复后可接管。' : switching ? '正在接管，请稍候。' : handing ? '交还状态正在确认，请稍候。' : '当前引擎暂不支持接管。');
  publishConnectionSettings({releaseReason:!ready ? '连接恢复后可检查目标服务。' : !featureReady('release') ? '当前引擎不支持从此入口停止服务。' : state.busy.has('release') ? '正在检查维护条件…' : '目标服务未运行。'});
  $('interrupt').querySelector('span').textContent=stopLabel;
  $('interrupt').title=stopping?'停止请求已发出，等待目标确认。':active?'停止当前轮次':'停止后台命令';
  $('interrupt').setAttribute('aria-label',stopping?stopLabel:$('interrupt').title);
  $('interrupt').setAttribute('aria-busy',String(stopping));
  const indicator=$('running-indicator'),nextIndicator=el('div');
  renderConversationActivity(nextIndicator,newChatOpen?null:conversationActivity(currentThread(),{
    connected:ready,controlled:controlled(),active,background,needsAnswer:needsAnswer(state.selectedId),
  }),icon);
  indicator.hidden=nextIndicator.hidden;
  reconcileMessages(indicator,nextIndicator);
  if(newChatOpen){
    const reason=!ready?'连接恢复后可发送，草稿已保留。':newDraft.phase==='uncertain'?'创建结果未确认，请刷新侧栏核对，避免重复创建。':!newDraft.cwd?'选择一个项目后开始。':creating?'正在创建会话…':'';
    $('send-message').disabled ||= !featureReady('create')||!newDraft.cwd||newDraft.phase!=='editing';
    $('send-message').setAttribute('aria-label',creating?'正在创建会话':'发送并开始会话');
    input.disabled=!ready||posting;input.placeholder='描述你想完成的任务…';
    availability.textContent=reason;availability.hidden=!reason;
    $('new-retry-create').hidden=newDraft.phase!=='uncertain';
    $('new-cwd').disabled=!ready||creating||newDraft.phase==='uncertain';$('close-new-chat').disabled=creating;
    $('interrupt').hidden=true;$('takeover').hidden=true;
    $('thread-title').hidden=false;setText('thread-title','新会话');
  }
  projectFolders?.sync();
  document.querySelectorAll('.project-create').forEach(button => { button.disabled = $('new-thread').disabled; });
  setText('composer-model-label',(modelFor(state.model)?.displayName || state.model || '模型')+' · '+(effortNames[state.effort] || state.effort || '档位'));
  composer?.render(); attachments?.render();
  const draft = own ? active ? '发送补充要求不会更改当前模型。模型与档位在下一轮生效。' : '模型与档位来自目标机器。更改在下一轮生效。' : '查看模式。接管后可在原会话继续工作。';
  setText('composer-hint',state.loadingModels && !state.models.length ? '正在读取目标机器模型目录…' : draft);
  setText('model-selection-note',currentThread()?.model ? '下一轮模型与思考档位' : '下一轮模型与思考档位 · 目标机器未提供当前模型');
  document.querySelectorAll('.request-card button,.request-card input,.request-card textarea').forEach(n => { const card=n.closest('.request-card');n.disabled = state.busy.has('request:' + card.dataset.requestId) || (n.dataset.local!=='true'&&(!ready||(card.dataset.asyncQuestion==='true'&&!state.status?.controlledThreads?.includes(card.dataset.threadId)))); });
  document.querySelectorAll('.request-card').forEach(card => {
    const pending = state.busy.has('request:' + card.dataset.requestId);
    card.setAttribute('aria-busy',String(pending));
    let feedback = card.querySelector('.request-feedback');
    if (!feedback) { feedback = el('p','request-feedback subtle'); feedback.setAttribute('role','status'); card.append(feedback); }
    feedback.textContent = pending ? '正在提交，请稍候…' : card.dataset.asyncQuestion==='true'&&!state.status?.controlledThreads?.includes(card.dataset.threadId) ? '查看模式，请在原操作入口回答。' : !ready ? '连接恢复后可处理此请求，已填内容会保留。' : '';
    feedback.hidden = !feedback.textContent;
  });
  if($('desktop-entry')){
    $('desktop-entry').hidden=newChatOpen||!state.selectedId||state.selectedArchived||own||state.desktopMode;
    $('desktop-entry').disabled=!state.transport||state.busy.size>0||Boolean(handoff&&handoff.state!=='released');
  }
  if($('desktop-review'))$('desktop-review').hidden=true;
  if(state.desktopMode&&!newChatOpen){
    const desktop=state.detail?.desktop,online=state.transport&&desktop?.available,unconfirmed=desktop?.unconfirmed||desktopSends[state.selectedId]?.messageId;
    input.disabled=posting;input.placeholder=active?'任务执行中，可先输入下一条要求…':'发送消息，输入 @ 引用会话…';
    $('takeover').hidden=true;
    $('send-message').disabled=!online||!desktop?.canSend||!!unconfirmed||posting||(!input.value.trim()&&!annotations?.has());
    $('send-message').title='发送到桌面会话';$('send-message').setAttribute('aria-label','发送到桌面会话');
    $('interrupt').hidden=!active&&!stopping;$('interrupt').disabled=!online||state.busy.has('interrupt')||stopping;
    const reason=!state.transport?'网页连接中断，草稿已保留。':desktop?.error||(posting?'':!desktop?'正在确认桌面会话…':unconfirmed?'上次发送结果未确认，请先核对原始会话记录，避免重复发送。':active?'桌面正在执行，请等待完成；需要回答或确认时请在桌面处理。':!desktop.canSend?'桌面状态未确认，请稍后刷新。':'');
    availability.textContent=reason;availability.hidden=!reason;
    $('desktop-review').hidden=!unconfirmed;$('desktop-review').disabled=!online||!desktop?.canSend||posting||state.busy.has('desktop-review');
    setText('composer-hint','使用桌面会话的模型与设置。发送成功仅代表会话已接收，任务结果以原始回复为准。');
  }
  if(automations?.opened){$('thread-title').hidden=false;setText('thread-title','定时任务');}
}
function controlReason(id, text) {
  const button = $(id); let note = $('reason-' + id);
  // Sidebar loading feedback must not insert/remove a row above the project list.
  const compact = id === 'new-thread', hidden = !button.disabled || button.hidden;
  if (!note) { note = el('p',compact ? 'sr-only' : 'control-reason'); note.id = 'reason-' + id; button.after(note); button.setAttribute('aria-describedby',note.id); }
  if (note.textContent !== text) note.textContent = text;
  note.hidden = hidden;
  if (compact) button.title = hidden ? '新建会话（⌘/Ctrl+N）' : text;
}
const sidebar = new Sidebar({node:$('thread-list'),host:targetHost,icon,threadName,relativeTime,api,toast,
  needsAnswer,
  activitySource:t=>activitySource(t,{connected:usable(),webActive:((state.status?.controlledSessions||[]).find(s=>s.id===t.id)?.status||t.status)?.type==='active'}),
  connected:usable,selectedId:()=>state.selectedId,newThread:openNewDialog,
  select:t=>{state.projectId=t.projectId;state.selectedArchived=!!t.archived;saveView();selectThread(t.id);},
  onArchiveView:archived=>{state.sidebarArchived=archived;state.threadCursor=null;state.threads=[];loadThreads();},
  refresh:()=>loadThreads(false,true),
  changed:async(action,t)=>{if(t?.id===state.selectedId&&['archive','restore'].includes(action))state.selectedArchived=action==='archive';await Promise.all([loadThreads(false,true,true),loadStatus()]);if(t?.id===state.selectedId)await refreshSelected();renderControls();},
});
function renderProjects() { renderThreads(); if(newChatOpen&&!state.busy.has('create')){updateNewProjects();renderControls();} }
function renderThreads() {
  setText('projects-heading','工作区');
  if(state.sidebar)sidebar.render({...state.sidebar,data:state.threads},{search:state.search,loading:state.loadingThreads});
  setText('breadcrumb-project',state.projects.find(p=>p.id===state.projectId)?.name||'工作区');
  $('more-threads').hidden=!state.threadPageError&&!state.threadCursor&&(!state.loadingThreads||state.threads.length>0);
  $('more-threads').textContent=state.threadPageError?'加载失败，点击重试':state.loadingThreads?'正在加载会话…':'加载更多会话';
  $('more-threads').disabled=state.loadingThreads;
  $('more-threads').onclick=()=>loadThreads(Boolean(state.threadCursor));
}
function modelId(m) { return m.model || m.id; }
function modelFor(id) { return state.models.find(m => modelId(m) === id || m.id === id); }
function effortsFor(id) {
  const m = modelFor(id); return (m?.supportedReasoningEfforts || []).map(e => typeof e === 'string' ? {value:e,label:effortNames[e] || e,description:''} : {value:e.reasoningEffort || e.effort,label:effortNames[e.reasoningEffort || e.effort] || e.reasoningEffort || e.effort,description:e.description || ''}).filter(e => e.value);
}
function defaultEffort(id) { const m = modelFor(id), opts = effortsFor(id); return opts.some(e => e.value === m?.defaultReasoningEffort) ? m.defaultReasoningEffort : opts[0]?.value || ''; }
function fillModels(select, selected) {
  const options=state.models.length?state.models.map(m=>({value:modelId(m),label:m.displayName||modelId(m),title:m.description||''})):[{value:'',label:state.loadingModels?'正在读取模型…':'等待模型目录'}];
  const value=state.models.some(m=>modelId(m)===selected)?selected:state.models.length?modelId(state.models.find(m=>m.isDefault)||state.models[0]):'';
  renderSelectOptions(select,options,value);
}
function fillEfforts(select, model, effort) {
  const opts=effortsFor(model);
  renderSelectOptions(select,opts.length?opts.map(e=>({value:e.value,label:e.label,title:e.description})):[{value:'',label:'无可用档位'}],opts.some(e=>e.value===effort)?effort:defaultEffort(model));
}
function renderModels(preferThread = false) {
  const t = currentThread();
  if (preferThread && !newChatOpen && t?.model) state.model = modelFor(t.model) ? modelId(modelFor(t.model)) : t.model;
  if (preferThread && !newChatOpen && t?.reasoningEffort) state.effort = t.reasoningEffort;
  // Preserve restored preferences until the model catalog arrives.
  if (!state.models.length) {
    fillModels($('model-select'),state.model); fillEfforts($('effort-select'),state.model,state.effort);
    renderControls(); return;
  }
  state.model = modelId(modelFor(state.model) || state.models.find(m => m.isDefault) || state.models[0]);
  if (preferThread && !newChatOpen && t?.reasoningEffort) state.effort = t.reasoningEffort;
  if (!effortsFor(state.model).some(e => e.value === state.effort)) state.effort = defaultEffort(state.model);
  fillModels($('model-select'),state.model); fillEfforts($('effort-select'),state.model,state.effort);
  renderControls();
}

function toolDetails(item, title, iconName = 'terminal') {
  const d = el('details','tool-block'); d.dataset.itemId = item.id || title; d.dataset.running = String(['inProgress','in_progress','running'].includes(typeOf(item.status)));
  const summary = el('summary'); summary.append(icon(iconName),el('span','tool-title',title),el('span','tool-status',uncertainHistory() && ['inProgress','in_progress','running'].includes(typeOf(item.status)) ? '状态未确认' : (item.type==='commandExecution'&&item.exitCode===-1?'已终止':statusNames[typeOf(item.status)] || typeOf(item.status))),icon('chevron','chevron'));
  const body = el('div','tool-content'); d.append(summary,body); return {d,body};
}
let outputPositions;
try{outputPositions=new Map(JSON.parse(sessionStorage.getItem('rcm.outputPositions.'+targetHost)||'[]'));}catch{outputPositions=new Map();}
function saveOutputPositions(){try{sessionStorage.setItem('rcm.outputPositions.'+targetHost,JSON.stringify([...outputPositions].slice(-200)));}catch{}}
function savedOpenDetails(){try{return JSON.parse(sessionStorage.getItem('rcm.openDetails.'+targetHost+'.'+state.selectedId)||'[]');}catch{return [];}}
function renderCommandOutput(item,{threadId=state.selectedId,refresh=renderMessages}={}) {
  const output = item.aggregatedOutput || (uncertainHistory() ? '快照未包含命令输出。' : typeOf(item.status) === 'inProgress' ? '等待命令输出…' : '无命令输出');
  const wrap=el('div','command-output-view');
  wrap.dataset.outputStamp=String(item.outputToken||output.length)+':'+String(outputPositions.get(threadId+':'+item.id)??'tail');
  if(item.outputPartial){wrap.append(el('span','subtle','已显示输出开头，正在补齐完整日志…'),el('pre','tool-output',output));return wrap;}
  if(output.length<=OUTPUT_WINDOW_SIZE) { wrap.append(el('pre','tool-output',output)); return wrap; }
  const key=threadId+':'+item.id, page=outputWindow(output,outputPositions.get(key) ?? 'tail');
  const controls=el('div','output-controls');
  controls.append(el('span','','完整输出已保留 · '+(page.start+1)+'–'+page.end+' / '+page.total+' 字符'));
  for(const [label,position,disabled] of [['开头',0,page.start===0],['上一段',Math.max(0,page.start-OUTPUT_WINDOW_SIZE),page.start===0],['下一段',page.end,page.end===page.total],['跟随最新','tail',page.following]]) {
    const b=el('button','secondary-button',label);b.type='button';b.disabled=disabled;
    b.onclick=()=>{outputPositions.set(key,position);saveOutputPositions();refresh();};controls.append(b);
  }
  const jump=el('input');jump.type='number';jump.min='1';jump.max=String(Math.ceil(page.total/OUTPUT_WINDOW_SIZE));jump.value=String(page.following?Number(jump.max):Math.floor(page.start/OUTPUT_WINDOW_SIZE)+1);jump.setAttribute('aria-label','输出段号');jump.style.width='5em';
  jump.oninput=()=>{const n=Number(jump.value);if(Number.isInteger(n)&&n>=1&&n<=Number(jump.max))outputPositions.set(key,(n-1)*OUTPUT_WINDOW_SIZE);};
  jump.onblur=()=>setTimeout(refresh,0);
  const go=el('button','secondary-button','跳转');go.type='button';go.onclick=()=>{jump.oninput();saveOutputPositions();refresh();};
  controls.append(el('span','','跳转到段'),jump,el('span','','/ '+jump.max),go);
  const download=el('button','secondary-button','下载完整输出');download.type='button';
  download.onclick=()=>{const url=URL.createObjectURL(new Blob([output],{type:'text/plain;charset=utf-8'}));const a=el('a');a.href=url;a.download='command-'+item.id+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};controls.append(download);
  const pre=el('pre','tool-output',page.text);pre.dataset.followTail=String(page.following);
  wrap.append(controls,pre);return wrap;
}
function renderItem(item,{threadId=state.selectedId,side=false,refresh=renderMessages}={}) {
  const imageUrl=options=>itemImageUrl(threadId,item.id,{...options,host:targetHost});
  const fileContext={threadId,itemId:item.id,host:targetHost};
  const bodyMarkdown=text=>markdown(text,0,{file:(path,label)=>fileLink(path,label,fileContext),image:(path,label)=>{
    if(!isRasterImage(path))return null;
    if(path.startsWith('/')&&!path.startsWith('//'))return imageCard(imageUrl({reference:path}),label||'回复图片');
    if(/^data:image\/(png|jpeg|webp|gif);base64,/.test(path))return imageCard(path,label||'回复图片');
    return null;
  }});
  if (item.type === 'userMessage' || item.type === 'goalMessage') {
    const m=el('div','message user'),bubble=el('div','user-bubble'),content=item.type==='goalMessage'?{text:item.objective,images:[]}:userMessageContent(item.content);
    if(item.type==='goalMessage'){m.setAttribute('aria-label','目标');bubble.append(el('div','goal-message-label','目标'));}
    if(content.text)bubble.append(el('div','user-message-text',content.text));
    for(const part of content.images){
      const src=part.type==='image'&&/^data:image\/(png|jpeg|webp|gif);base64,/.test(part.url||'')?part.url:imageUrl({part:part.index});
      bubble.append(imageCard(src,'图片附件 '+(part.index+1)));
    }
    m.append(bubble);
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
      card.append(reply,el('small','','此通知是历史记录。填写并发送后，才会提交你的决定。'));m.append(card,bodyMarkdown(text.slice(heartbeat.index+heartbeat[0].length)));
    }else m.append(bodyMarkdown(text)); return m;
  }
  if (item.type === 'reasoning') {
    const r = el('details','reasoning-block'); r.dataset.itemId = item.id; r.append(el('summary','','思考摘要'));
    const text = [...(item.summary || []),...(item.content || [])].map(x => typeof x === 'string' ? x : x.text || '').join('\n'); r.append(el('p','',text || '目标机器未提供摘要。')); return r;
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
      load:async()=>item.detailsDeferred?(await api('/api/threads/'+encodeURIComponent(threadId)+'/items/'+encodeURIComponent(item.id)+'/detail')).item:item,
      render:(value,body)=>{body.append(el('div','tool-meta','服务：'+(value.server||'—')));
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
function kindName(kind) { const k = typeOf(kind); return {add:'新增',delete:'删除',update:'修改',create:'新增',modify:'修改'}[k] || k || '修改'; }
let lastMessageShape;
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
  const visibleTurns=progressiveTurns.view(state.loadingDetail?[]:turns());
  $('messages').setAttribute('aria-busy',String(state.loadingDetail||progressiveTurns.pending));
  progressiveTurns.enqueue();
  const receipts=sendReceipts.view(context,turns());
  const completion=completedGoalPlacement(state.detail?.goal,turns(),state.detail?.goalError||uncertainHistory());
  const nearBottom = scrollFollow?.following ?? true;
  const shape=JSON.stringify([completion,receipts.map(r=>[r.id,r.status]),state.selectedId,state.loadingDetail,state.historyError,controlled(),uncertainHistory(),state.detail?.recovering,backgroundActivity(state.detail,{controlled:controlled(),connected:usable()}),[...(state.runtimeNotices.get(state.selectedId)?.values()||[])],visibleTurns],(key,value)=>['aggregatedOutput','outputToken'].includes(key)?undefined:value);
  if(shape===lastMessageShape){
    for(const turn of visibleTurns)for(const item of turn.items||[]){
      if(item.type!=='commandExecution')continue;
      const previous=$('messages').querySelector('details[data-item-id="'+CSS.escape(item.id)+'"] .command-output-view');
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
  const anchor = preserveAnchor ? [...$('messages').querySelectorAll('.message-turn')].find(node => node.getBoundingClientRect().bottom > viewportTop) : null;
  const anchorId = anchor?.dataset.turnId, anchorOffset = anchor ? anchor.getBoundingClientRect().top - viewportTop : 0;
  const opened = new Set($('messages').querySelector('details[data-item-id]') ? [...$('messages').querySelectorAll('details[open][data-item-id]')].map(n => n.dataset.itemId) : savedOpenDetails());
  const n = el('div');
  const commit = () => {reconcileMessages($('messages'), n);messageCache.bind($('messages'));};
  const renderContext=renderSignature([controlled(),uncertainHistory(),backgroundActivity(state.detail,{controlled:controlled(),connected:usable()})]);
  const cachedItem=(item,turnId)=>messageCache.render('item:'+turnId+':'+item.id,renderSignature([renderContext,item]),()=>{const node=renderItem(item);node.dataset.messageId=item.id;return node;});
  if (state.loadingDetail) { n.append(el('div','empty-history loading','正在读取会话历史…')); commit(); return; }
  if (state.historyError) { n.append(el('div','turn-error',state.historyError)); if(!turns().length){commit();return;} }
  if(state.detail?.recovering)n.append(el('div','history-notice','已恢复本机保存的输出，正在同步最新内容…')); 
  for (const notice of state.runtimeNotices.get(state.selectedId)?.values() || []) n.append(renderExtensionNotice(notice));
  if (!turns().length) { const empty = el('div','empty-history'); empty.append(icon('chat'),el('p','','此会话暂无消息。'),el('p','',state.desktopMode ? '通过桌面继续此会话。' : controlled() ? '输入要求，开始目标机器工作。' : '接管后，可以在此会话开始工作。')); n.append(empty); }
  if(completion&&!completion.turnId)n.append(renderCompletedGoal(completion.goal));
  visibleTurns.forEach(t => {
    const cachedTurn=messageCache.render('turn:'+t.id,renderSignature([renderContext,t]),()=>{
    const turn = el('section','message-turn'); turn.dataset.turnId = t.id;
    const meta = el('div','turn-meta'); meta.classList.toggle('needs-attention',['failed','declined','systemError','interrupted'].includes(typeOf(t.status))); meta.append(el('span','',dateTime(t.startedAt || t.createdAt,true)));
    const actualModel = t.model || t.modelInfo?.model, actualEffort = t.effort || t.reasoningEffort || t.modelInfo?.reasoningEffort;
    if (actualModel || actualEffort) meta.append(el('span','turn-model',[actualModel,actualEffort && '思考：' + (effortNames[actualEffort] || actualEffort)].filter(Boolean).join(' · ')));
    const turnStatus = uncertainHistory() && ['inProgress','in_progress','running'].includes(typeOf(t.status)) ? '状态未确认' : statusNames[typeOf(t.status)] || typeOf(t.status);
    meta.append(el('span','turn-status',turnStatus)); turn.append(meta);
    for (const group of timedTurnGroups(t)) {
      if (group.type === 'duration') { turn.append(el('div','turn-duration',group.label)); continue; }
      if (group.type === 'message') { turn.append(cachedItem(group.item,t.id)); continue; }
      const processGroup = el('details','activity-group process-group');
      processGroup.dataset.itemId = 'process-' + t.id + '-' + group.key;
      if (group.durationLabel) processGroup.classList.add('has-duration');
      const description = processSummary(t,group.items,{uncertain:uncertainHistory(),background:backgroundActivity(state.detail,{controlled:controlled(),connected:usable()})});
      if (description.hidden && !group.durationLabel) continue;
      const summary = renderProcessSummary(description,{durationLabel:group.durationLabel,icon});
      const body = el('div','activity-items');
      for (const item of group.items) { body.append(cachedItem(item,t.id)); }
      processGroup.append(summary,body); turn.append(processGroup);
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
    if(completion?.turnId===t.id)n.append(renderCompletedGoal(completion.goal));
  });
  for(const receipt of receipts){
    const node=renderItem({id:receipt.id,type:'userMessage',content:receipt.content});
    node.dataset.sendReceipt=receipt.id;
    const status=el('div','user-message-time',sendReceiptLabels[receipt.status]);status.setAttribute('role','status');node.append(status);n.append(node);
  }
  n.querySelectorAll('details[data-item-id]').forEach(d => { if (opened.has(d.dataset.itemId)) d.open = true; });
  commit();
  const rendered = $('messages');
  for(const turn of visibleTurns)for(const item of turn.items||[]){
    if(item.type!=='commandExecution')continue;
    const previous=rendered.querySelector('details[data-item-id="'+CSS.escape(item.id)+'"] .command-output-view');
    const stamp=String(item.outputToken||(item.aggregatedOutput||'').length)+':'+String(outputPositions.get(state.selectedId+':'+item.id)??'tail');
    if(previous&&previous.dataset.outputStamp!==stamp)previous.replaceWith(renderCommandOutput(item));
  }
  rendered.querySelectorAll('.tool-output[data-follow-tail="true"]').forEach(pre=>{pre.scrollTop=pre.scrollHeight;});
  if (nearBottom && !state.busy.has('history')) scroller.scrollTop = scroller.scrollHeight;
  else if (preserveAnchor) {
    const restored = [...rendered.querySelectorAll('.message-turn')].find(node => node.dataset.turnId === anchorId);
    const targetTop = restored ? oldTop + restored.getBoundingClientRect().top - viewportTop - anchorOffset : oldTop + (scroller.scrollHeight - oldHeight);
    // Clamp to real content when a collapsed group shortens the page.
    scroller.scrollTop = targetTop;
  }
  else scroller.scrollTop = oldTop;
}
function renderThread() {
  renderRequests();
  const t = currentThread(); $('welcome').hidden = Boolean(state.selectedId); $('conversation').hidden = !state.selectedId;
  $('thread-title').hidden = !state.selectedId;
  $('breadcrumb-project').hidden = Boolean(state.selectedId);
  if (!state.selectedId) { renderControls(); return; }
  setText('thread-title',t ? threadName(t) : '正在读取会话…'); $('thread-title').title = $('thread-title').textContent; setText('thread-path',t?.cwd ? '目标机器 · ' + t.cwd : '');
  const own = controlled(), control = typeOf(state.detail?.controlState), busy = ['busy','occupied','active_writer','conflict'].includes(control);
  const badge = $('control-badge'); badge.className = 'control-badge' + (own ? ' controlled' : busy ? ' busy' : ''); badge.textContent = own ? '已取得控制' : busy ? '已被占用' : '查看模式';
  const note = $('control-note');
  note.className = 'control-note';
  note.textContent = own ? '此会话由当前工作台控制。发送消息会在目标机器执行。' : busy ? '此会话由其他入口管理，当前为查看模式。' : '当前只读取历史。点击“接管会话”后，可以继续原会话。';
  if (snapshotHistory()) note.textContent = (own ? '历史来自快照。实时状态由目标机器控制连接确认。' : '历史快照，运行状态需接管后确认。') + (busy ? ' ' + note.textContent : '');
  if(state.desktopMode){badge.textContent='桌面托管';note.textContent='消息由 Codex 桌面执行，沿用该会话的原生工具。';}
  renderMessages(); renderControls(); resizeInput();
}
function renderDiagnostics() {
  const s=state.status||{},c=s.connection||{},entries=[];
  if(s.recoveryFailures?.length){entries.push({title:'历史会话恢复',messages:[recoveryMessage(s.recoveryFailures),...s.recoveryFailures.map(f=>f.threadId+'：'+f.message)]});}
  if(c.stage)entries.push({title:'当前阶段',messages:[stages[c.stage]||c.stage]});
  if(s.service?.pid)entries.push({title:'目标机器服务',messages:['PID '+s.service.pid+(s.service.running?' · 运行中':' · 未运行')]});
  if(s.service?.protocolValidation){const v=s.service.protocolValidation;entries.push({title:'协议兼容性',messages:[`${v.version} · 已核验 ${v.methods} 项接口${v.cached?' · 使用已核验缓存':''}`,...Object.values(v.features||{}).filter(f=>!f.supported).map(f=>f.reason)]});}
  if(s.service?.installedVersion&&s.service.installedVersion!==s.service.version)entries.push({title:'引擎更新',messages:[`已安装 ${s.service.installedVersion}，当前运行 ${s.service.version}。任务结束后释放并重新连接，即可使用新引擎。`]});
  const all=[...(s.errors||[]),...state.errors].sort((a,b)=>(timestamp(b.time)?.getTime()||0)-(timestamp(a.time)?.getTime()||0)).slice(0,10);
  for(const e of all)entries.push({title:dateTime(e.time)+(e.stage?' · '+(stages[e.stage]||e.stage):''),messages:[e.message||messageOf(e)],error:true});
  renderDiagnosticsView({selectedId:state.selectedId,entries});
}
function renderRequests() {
  const list = requests().filter(r=>!questionDrafts.get(r).sent), signature = JSON.stringify([state.selectedId,sideChat?.id,list]);
  if (signature === state.requestSignature) { renderControls(); return; }
  state.requestSignature = signature;
  for(const r of list)if(r.params?.questions?.length)notifyTaskEvent('manager/request',r);
  if(!sidebar.menu&&!sidebar.dialog&&!sidebar.drag)renderThreads();
  const saved = new Map([...document.querySelectorAll('.request-card')].map(card => [card.dataset.requestId, {fields:[...card.querySelectorAll('input,textarea')].map(f => ({name:f.name,value:f.value,checked:f.checked})),open:Boolean(card.querySelector('details[open]'))}]));
  const inline = clear($('conversation-requests'));if(sideChat)clear(sideChat.requestsHost);
  list.forEach(r => {
    const threadId=requestThread(r);
    if(threadId&&threadId!==state.selectedId&&threadId!==sideChat?.id)return;
    const method = r.method || '', p = r.params || {}, question = Array.isArray(p.questions) && p.questions.length > 0;
    const knownApproval = /requestApproval|approval|requestPermissions/i.test(method) || ['approval','commandApproval','fileApproval','command','file','permissions'].includes(r.kind);
    const card = el('div','request-card'); card.dataset.requestId = requestPath(r);
    const title = question ? '需要你的回答' : /commandExecution/i.test(method) ? '命令执行审批' : /fileChange/i.test(method) ? '文件修改审批' : /requestPermissions/i.test(method) ? '权限请求' : knownApproval ? '操作审批' : '工具请求待处理';
    if(!question)card.append(el('h4','',title));
    card.dataset.asyncQuestion=String(r.kind==='asyncQuestion');card.dataset.threadId=requestThread(r)||'';
    if (requestThread(r)&&!question) {
      const target = currentThread()?.id===requestThread(r)?currentThread():state.threads.find(t => t.id === requestThread(r));
      card.append(el('p','request-origin','会话：' + (target ? threadName(target) : requestThread(r))));
    }
    if (p.reason) card.append(el('p','',p.reason));
    if (p.command) card.append(el('pre','',p.command));
    if (p.cwd) card.append(el('p','','目标机器目录：' + p.cwd));
    if (Array.isArray(p.changes)) p.changes.forEach(c => card.append(el('p','',c.path)));
    if (question) {
      if(questionDrafts.get(r).skipped){
        card.append(el('p','subtle','已跳过问题'));
        const restore=el('button','text-button','重新回答');restore.dataset.local='true';restore.onclick=()=>{questionDrafts.set(r,{skipped:false,collapsed:false});state.requestSignature='';renderRequests();};card.append(restore);
      }else card.append(questionForm(r,{drafts:questionDrafts,submit:answer=>respondRequest(r,answer),rerender:()=>{state.requestSignature='';renderRequests();}}));
    } else {
      if (!knownApproval) card.append(el('p','','此工具需要专用实现。请查看请求详情。可以取消请求，避免会话一直等待。'));
      const detail = el('details','request-detail'); detail.append(el('summary','','请求详情'),el('pre','',pretty({method,params:p}))); card.append(detail);
      const actions = el('div','request-actions');
      if (knownApproval) { const available = p.availableDecisions; const accepts = !Array.isArray(available) || !available.length || available.includes('accept'); const declines = !Array.isArray(available) || !available.length || available.includes('decline'); const accept = el('button','accept','允许一次'); accept.onclick = () => respondRequest(r,{decision:'accept'}); if (accepts) actions.append(accept); if(available?.includes('acceptForSession')){const session=el('button','accept','本会话允许');session.onclick=()=>respondRequest(r,{decision:'acceptForSession'});actions.append(session);} const decline = el('button','','拒绝'); decline.onclick = () => respondRequest(r,{decision:'decline'}); if (declines) actions.append(decline); }
      const cancel = el('button','','取消请求'); cancel.onclick = () => respondRequest(r,{decision:'cancel'}); if (!Array.isArray(p.availableDecisions) || !p.availableDecisions.length || p.availableDecisions.includes('cancel')) actions.append(cancel); card.append(actions);
    }
    const previous = saved.get(requestPath(r));
    if (previous) {
      card.querySelectorAll('input,textarea').forEach(f => { const found = previous.fields.find(x => x.name === f.name && (f.type !== 'radio' || x.value === f.value)); if (found) { if (f.type === 'radio') f.checked = found.checked; else f.value = found.value; } });
      if (previous.open && card.querySelector('details')) card.querySelector('details').open = true;
    }
    if(sideChat?.id&&threadId===sideChat.id)sideChat.requestsHost.append(card);else inline.append(card);
  });
  renderControls();
}

async function loadStatus() { applyStatus(await api('/api/status')); renderStatus(); renderRequests(); return state.status; }
let accountViewVersion=0;
const catalogs=createCatalogReaders({state,version:()=>accountViewVersion,modelId,
  readModels:path=>api(path),readProjects:()=>api('/api/projects'),renderModels,renderProjects});
const {loadModels,loadProjects}=catalogs;
const createdThreads = new Map();
let threadSearch = '';
const loadThreads = createSidebarLoader({
  key:append=>JSON.stringify([state.status?.instanceId,state.status?.connection?.connectedAt,state.search,state.sidebarArchived,state.selectedId,append?state.threadCursor:null,append]),
  read:append=>readThreads(append,true),
});
async function readThreads(append = false, reportFailure = false) {
  if (!connected() || (append && (state.loadingThreads || !state.threadCursor))) return;
  // Restore project metadata before grouping the cross-project thread list.
  if (state.projectId && !state.projects.length) await loadProjects();
  const seq = ++state.listVersion; state.loadingThreads = true; state.threadPageError = false;
  if (!append) {
    if (threadSearch !== state.search) {
      state.threads = [...createdThreads.values()].filter(t => !state.search || threadName(t).includes(state.search));
      $('project-list').scrollTop = 0;
    }
    threadSearch = state.search; state.threadCursor = null;
  }
  renderThreads();
  const q = new URLSearchParams({activity:'deferred'}); if (state.search) q.set('search',state.search); if(state.selectedId)q.set('selectedId',state.selectedId);
  if (append && state.threadCursor) q.set('cursor',state.threadCursor);
  try {
    if(state.sidebarArchived)q.set('archived','true');
    const d = await api('/api/sidebar?' + q); if (seq !== state.listVersion) return;
    if(state.sidebar?.accountScope===d.accountScope){const previous=new Map(state.threads.map(t=>[t.id,t.activity]));for(const t of d.data||[])if(!t.activity&&previous.has(t.id))t.activity=previous.get(t.id);}
    const accountChanged=state.sidebar&&state.sidebar.accountScope!==d.accountScope;
    if(accountChanged){createdThreads.clear();if(append){void loadThreads(false,false,true);return;}}
    state.sidebar=d;state.projects=d.projects||[];if(d.selectedThread?.id===state.selectedId)state.selectedArchived=!!d.selectedThread.archived;
    state.threadListSource = d.historySource || null;
    for (const thread of d.data || []) createdThreads.delete(thread.id);
    const pending = state.sidebarArchived?[]:[...createdThreads.values()].filter(t => !state.search || threadName(t).includes(state.search));
    const all = append ? [...state.threads,...(d.data || [])] : [...pending,...(d.data || [])];
    const seen = new Set(); state.threads = all.filter(t => !seen.has(t.id) && seen.add(t.id)); state.threadCursor = d.nextCursor || null;
    void loadSidebarActivity(d,seq);
  } catch (e) { if (seq === state.listVersion) { state.threadPageError = true; recordError(e,'threads'); toast(messageOf(e),true); } if (reportFailure) throw e; }
  finally { if (seq === state.listVersion) { state.loadingThreads = false; renderThreads(); renderControls(); if (!state.threadPageError) requestAnimationFrame(loadVisibleThreads); } }
}
async function loadSidebarActivity(snapshot,seq){
  const instance=state.status?.instanceId,connection=state.status?.connection?.connectedAt;
  const current=()=>seq===state.listVersion&&state.sidebar===snapshot&&connected()&&state.status?.instanceId===instance&&state.status?.connection?.connectedAt===connection;
  const ids=(snapshot.data||[]).map(t=>t.id);
  for(let offset=0;offset<ids.length&&current();offset+=200){
    try{
      const data=await api('/api/sidebar/activity?'+new URLSearchParams({ids:JSON.stringify(ids.slice(offset,offset+200))}));
      if(!current()||data.accountScope!==snapshot.accountScope)return;
      const activity=new Map((data.data||[]).map(t=>[t.id,t.activity]));
      for(const t of state.threads)if(activity.has(t.id)){if(activity.get(t.id))t.activity=activity.get(t.id);else delete t.activity;}
      renderThreads();
    }catch(error){if(current())recordError(error,'sidebar-activity');return;}
  }
}
function loadVisibleThreads() {
  const list = $('project-list');
  if (list.clientHeight > 0 && list.scrollHeight - list.scrollTop - list.clientHeight < 120) loadThreads(true);
}
const {saveSoon:saveDetailSoon,restore:restoreDetail,cancelScheduled:cancelDetailSave}=createDetailRecovery({state,host:targetHost,read:readDetailCache,write:writeDetailCache,apply:applyDetail});
function applyDetail(data, resetModels = false) {
  if(data.goalError&&state.detail?.thread?.id===data.thread?.id)data.goal=state.detail.goal;
  state.detail = {...data, turns:data.turns || data.thread?.turns || []};
  state.historyCursor = data.nextCursor || data.historyCursor || null; state.historyError = '';
  if (resetModels) renderModels(true); renderThread(); renderRequests(); if(!data.recovering)saveDetailSoon();
}
async function selectThread(id,options={}) {
  if(state.busy.has('create'))return;
  const url=new URL(location.href);url.searchParams.delete('thread');history.replaceState(null,'',url);
  closeNewChat();
  automations?.close();state.desktopMode=Boolean(options.desktop||id===automations?.threadId);
  document.querySelector('.main-panel').classList.toggle('desktop-chat',state.desktopMode);
  toggleInspector(false);
  $('messages').style.paddingBottom = '';
  if (inputId()) state.drafts.set(inputId(),$('message-input').value);
  const seq = ++state.selectionVersion; state.selectedId = id; state.detail = null; state.historyCursor = null; state.loadedOlderHistory = false; state.loadingDetail = true; state.historyError = ''; saveView();
  $('message-input').value = state.drafts.get(id) || ''; resizeInput(); renderThread(); renderThreads(); if (compactLayout()) toggleSidebar(false, false);
  try { await refreshSelected(); if (seq !== state.selectionVersion) return; scrollFollow?.schedule(); }
  catch (e) { if (seq !== state.selectionVersion) return; state.loadingDetail = false; state.historyError = messageOf(e); recordError(e,'thread'); renderThread(); }
}
const readSelectedDetail=createDetailReader({state,sends:desktopSends,
  reportView:()=>reportThreadView(),recordError:error=>recordError(error,'thread'),request:(...args)=>api(...args),
  input:()=>$('message-input'),resizeInput:()=>resizeInput(),saveSends:()=>saveDesktopSends(),
  now:()=>performance.now(),host:()=>targetHost,canDecompress:()=>typeof DecompressionStream==='function',
  applyPreview:preview=>applyDetail(preview,true),turns:()=>turns(),outputBases:values=>outputBases(values),
  decode:data=>decodeOutputs(data),hydrate:(data,bases)=>hydrateOutputs(data,bases),
  recordTiming:value=>{document.body.dataset.logRecovery=value;},defer:(run,delay)=>setTimeout(run,delay),refreshSoon:()=>scheduleDetailRefresh()});
const selectedRefresh=createSelectedRefresh({state,blocked:()=>automations?.opened||newChatOpen,
  newChatOpen:()=>newChatOpen,restore:restoreDetail,read:readSelectedDetail,turns,merge:mergeLiveTurns,
  apply:applyDetail,updated:()=>turnNavigation?.update()});
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
  diagnostic:notificationDiagnostic,publish:publishNotificationView,focus:()=>window.focus(),open:openNotificationThread});
const notificationPreferences=createNotificationPreference({host:()=>targetHost,support:()=>notificationSupport(),
  permission:()=>Notification.permission,requestPermission:()=>Notification.requestPermission(),
  prepareWorker:notificationDelivery.prepare,
  read:key=>localStorage.getItem(key),save:(key,value)=>localStorage.setItem(key,value),
  publish:publishNotificationView,recordError});
const setTaskNotifications=notificationPreferences.setEnabled;
function notificationDiagnostic(message) {
  appendNotificationDiagnostic(dateTime(new Date()) + ' · ' + message);
}
function openNotificationThread({host,threadId}) {
  if(host!==targetHost){
    if(!connectionIds.includes(host))return;
    flushDrafts();
    const url=new URL(location.href);url.searchParams.set('host',host);url.searchParams.set('thread',threadId);location.assign(url);return;
  }
  selectThread(threadId);
}
const sendTaskNotification=notificationDelivery.send;
const notifyTaskEvent=createTaskNotifications({enabled:()=>notificationPreferences.enabled(),
  permitted:()=>('Notification' in window)&&Notification.permission==='granted',host:()=>targetHost,
  thread:id=>state.threads.find(t=>t.id===id)||(state.selectedId===id?currentThread():null),
  known:id=>state.status?.controlledThreads?.includes(id)||state.status?.subscribedThreads?.includes(id),
  alias:()=>state.status?.host?.alias,threadName,notice:taskNotice,
  lock:(key,work)=>navigator.locks.request(key,work),preference:key=>localStorage.getItem(key),
  deliver:(key,send)=>deliverNotice(localStorage,key,send),send:(...args)=>sendTaskNotification(...args),
  acknowledge:key=>api('/api/notices/ack',{method:'POST',body:{key}}),
  diagnostic:notificationDiagnostic,recordError});

async function connectRemote() {
  maintenanceFeedback('');
  const success = await action('connect',async () => {
    const data = await api('/api/connect',{method:'POST',body:{},timeout:150000});
    if (data.connection) { applyStatus(data); renderStatus(); } else await loadStatus();
    return true;
  });
  if (success) { renderStatus(); if(connected())refreshWorkspace().catch(e => recordError(e,'sync')); }
}
async function disconnectRemote() {
  maintenanceFeedback('');
  return action('disconnect',async () => { await api('/api/disconnect',{method:'POST'}); await loadStatus(); if (state.detail) state.detail.controlled = false; renderThread(); });
}
async function takeoverThread() {
  if (!state.selectedId || !usable()) return;
  const id = state.selectedId,selection=state.selectionVersion;
  const current=()=>id===state.selectedId&&selection===state.selectionVersion&&!newChatOpen;
  await action('takeover',async () => {
    try { const d = await api('/api/threads/' + encodeURIComponent(id) + '/takeover',{method:'POST'}); if(current())applyDetail(d,true); await loadStatus(); }
    catch (e) {
      recordError(e,'takeover');
      if(!current())return;
      if (e.code==='WRITER_CONFLICT'&&state.detail) { state.detail.controlled = false; state.detail.controlState = 'conflict'; renderThread(); }
      toast(messageOf(e),true,8000,'takeover');
    }
  });
}
async function endThreadUse() {
  const id=state.selectedId,selection=state.selectionVersion;
  if(!id||!usable())return;
  state.drafts.set(id,$('message-input').value);
  try{sessionStorage.setItem('rcm.drafts.'+targetHost,JSON.stringify([...state.drafts]));}catch{}
  await action('handoff:'+id,async()=>{
    try {
      const handoff=await api('/api/threads/'+encodeURIComponent(id)+'/handoff',{method:'POST',timeout:45000});
      if(id===state.selectedId&&selection===state.selectionVersion&&state.detail){state.detail.controlled=false;state.detail.handoff=handoff;state.detail.controlState='viewing';}
      await loadStatus();renderThread();
      if(id===state.selectedId&&selection===state.selectionVersion)handoffControls.focus();
    }catch(error){recordError(error,'handoff');await loadStatus().catch(()=>{});renderThread();if(id===state.selectedId&&selection===state.selectionVersion)handoffControls.showError(messageOf(error));}
  });
}
function maintenanceFeedback(message) {
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
    catch (e) { if (e.status === 409) { const blockers = Array.isArray(e.details) ? e.details.map(b => (state.threads.find(t=>t.id===b.threadId)?.name || b.threadId) + '：' + b.reason).join('\n') : e.details ? pretty(e.details) : ''; throw new Error(messageOf(e) + (blockers ? '\n' + blockers : '') + '\n请先结束相关任务，再释放控制。'); } throw e; }
  });
}
async function respondRequest(r, answer) {
  await action('request:' + requestPath(r), async () => {
    const instance=state.status?.instanceId,returnFocus=document.activeElement?.closest('.request-card')?.dataset.requestId===requestPath(r);
    if(r.kind==='asyncQuestion')await api('/api/threads/'+encodeURIComponent(r.threadId)+'/question-answer',{method:'POST',body:{...answer,turnId:r.params.turnId,itemId:r.params.itemId}});
    else await api('/api/requests/' + encodeURIComponent(requestPath(r)) + '/respond',{method:'POST',body:answer});
    questionDrafts.clear(r);if(r.kind==='asyncQuestion')questionDrafts.set(r,{sent:true});
    if(instance!==state.status?.instanceId)return;
    const remove = list => (list || []).filter(x => requestKey(x) !== requestKey(r));
    state.localRequests = remove(state.localRequests); if (state.status) state.status.pendingRequests = remove(state.status.pendingRequests); if (state.detail) state.detail.pendingRequests = remove(state.detail.pendingRequests);
    renderRequests();if(returnFocus){if(state.selectedId===requestThread(r))$('message-input').focus();else if(sideChat?.id===requestThread(r))document.querySelector('.side-chat-panel .composer textarea')?.focus();}await loadStatus();
  });
}
function updateNewProjects(projectRoot) {
  const preferred=(typeof projectRoot==='string'?projectRoot:null)||newDraft.cwd||state.projects.find(p=>p.id===state.projectId)?.roots?.[0]||currentThread()?.cwd;
  const select=clear($('new-cwd'));
  const options=projectFolderOptions(state.projects);
  for(const p of options){const option=el('option','',p.name);option.value=p.root;select.append(option);}
  if(options.some(p=>p.root===preferred))select.value=preferred;
  newDraft.cwd=select.value;rememberNewDraft();
}
function openNewDialog(projectRoot) {
  if(state.busy.has('create'))return;
  automations?.close();document.querySelector('.main-panel').classList.remove('desktop-chat');
  flushDrafts();updateNewProjects(projectRoot);
  $('new-cwd').onchange=()=>{newDraft.cwd=$('new-cwd').value;rememberNewDraft();renderControls();};
  state.selectionVersion++;newChatOpen=true;$('new-chat-page').hidden=false;document.querySelector('.main-panel').classList.add('new-chat-open');
  void reportThreadView().catch(e=>recordError(e,'thread'));
  $('new-composer-slot').append(document.querySelector('.composer-region'));
  $('message-input').value=state.drafts.get(newDraftId)||'';
  $('new-chat-error').hidden=true;toggleInspector(false);if(compactLayout())toggleSidebar(false,false);
  renderModels();renderControls();resizeInput();mobileUI?.syncDrawers();$('message-input').focus();
}
async function createThreadFromDraft(){
  if(state.busy.has('create')||newDraft.phase!=='editing')return;
  const cwd=newDraft.cwd,model=state.model,effort=state.effort,text=$('message-input').value;
  if(!cwd||(!text.trim()&&!attachments.has())||attachments.pending())return;
  try{composer.validateSend(text,false);}catch(error){toast(error.message,true);return;}
  state.drafts.set(newDraftId,text);$('new-chat-error').hidden=true;
  let created=false;
  await action('create',async()=>{
    try{
      newDraft.begin();
      const d=await api('/api/threads',{method:'POST',body:{cwd,model,effort,access:WEB_ACCESS}});
      const id=d.thread?.id||d.id;if(!id)throw Error('未返回会话 ID，请刷新侧栏核对创建结果。');
      const thread={...d.thread,id,cwd,name:d.thread?.name||'新会话'};
      createdThreads.set(id,thread);state.threads.unshift(thread);
      attachments.moveDraft(newDraftId,id);composer.moveDraft(newDraftId,id);
      closeNewChat(false);state.desktopMode=false;state.drafts.set(id,text);state.drafts.delete(newDraftId);
      state.sidebarArchived=false;state.selectedArchived=false;state.selectedId=id;state.selectionVersion++;
      state.model=model;state.effort=effort;state.loadingDetail=false;
      const project=state.projects.find(p=>p.roots?.includes(cwd));state.projectId=project?.id||null;if(project)sidebar.expandProject(project.id);
      state.search='';$('thread-search').value='';state.historyCursor=null;state.loadedOlderHistory=false;state.historyError='';
      saveView();$('message-input').value=text;applyDetail({...d,thread,controlled:true},true);renderThreads();
      newDraft.complete();created=true;
    }catch(error){
      newDraft.failed(error);$('new-chat-error').textContent=messageOf(error);$('new-chat-error').hidden=false;recordError(error,'create');
    }
  });
  if(created){await sendMessage();void Promise.allSettled([loadThreads(),loadStatus()]);}
}
async function sendMessage(e,alternate=false) {
  e?.preventDefault();
  if ($('send-message').disabled&&!alternate) return;
  if(newChatOpen){await createThreadFromDraft();return;}
  if(state.desktopMode){await sendDesktopMessage();return;}
  const annotationDraft=annotations.capture();
  const text = annotatedText($('message-input').value.trim(),annotationDraft.items), id = state.selectedId;
  if ((!text&&!attachments?.has()) || attachments?.pending() || !id || !usable() || !controlled() || state.busy.has('message')) return;
  const active = running(), selection = state.selectionVersion;
  const followUp=followUpAction({active,touch:touchInput(),alternate});
  try{composer.validateSend(text,active);}catch(error){toast(error.message,true);return;}
  const sent = state.drafts.capture(id,$('message-input').value), pictures=attachments.capture();
  await action('message',async () => {
    const images=pictures.items.map(i=>({url:i.url}));
    const options=composer.options();
    if(options.threads.length&&(active||composer.isGoalPending()))throw new Error('请在当前任务结束后单独发送会话引用，暂不能与启动目标模式合并发送。草稿已保留。');
    const payload = active ? {text,images,skills:options.skills,plugins:options.plugins,threads:options.threads} : {text,images,model:state.model,effort:state.effort,...options};
    const scope=targetHost+':'+id;
    const content=[...(text?[{type:'text',text}]:[]),...images.map(i=>({type:'image',url:i.url}))];
    const receipt=sendReceipts.begin(scope,content,turns());
    renderMessages();scrollFollow?.schedule();
    let d,submitted=false;
    try{
      const goalStarted=await composer.prepareSend(id,text,active);
      submitted=true;
      d=followUp==='queue'?await api('/api/threads/'+encodeURIComponent(id)+'/queue-add',{method:'POST',body:payload}):await sendAfterGoal({goalStarted,id,payload,active,api});
      if(d.queuedSubmission){sendReceipts.remove(scope,receipt);if(scope===targetHost+':'+state.selectedId&&selection===state.selectionVersion&&state.detail){const queue=state.detail.queue||{data:[]};state.detail.queue={...queue,data:[...(queue.data||[]).filter(q=>q.id!==d.queuedSubmission.id),d.queuedSubmission]};}}
      else sendReceipts.accept(receipt,d);
    }catch(error){
      if(submitted)sendReceipts.fail(receipt,error);else receipt.status='failed';
      if(scope===targetHost+':'+state.selectedId)renderMessages();
      throw error;
    }
    attachments.acknowledge(pictures);annotations.acknowledge(annotationDraft);
    const cleared = state.drafts.acknowledge(sent);
    if (scope===targetHost+':'+state.selectedId && cleared && $('message-input').value === sent.text) { $('message-input').value = ''; resizeInput(); }
    if (scope===targetHost+':'+state.selectedId && selection === state.selectionVersion) { if(d.turn)upsertTurn(d.turn);renderThread(); }
    try { if (id === state.selectedId && selection === state.selectionVersion) await refreshSelected(); } catch (err) { recordError(err,'thread'); }
  });
}
async function implementPlan(id,plan){
  if(id!==state.selectedId||newChatOpen||state.desktopMode||!usable()||!controlled()||running()||state.busy.size||completedPlan(turns())?.turnId!==plan.turnId)throw Object.assign(new Error('会话状态已变化，请重新核对计划。'),{status:409});
  const selection=state.selectionVersion;
  state.busy.add('message');renderControls();
  try{
    const d=await api('/api/threads/'+encodeURIComponent(id)+'/message',{method:'POST',body:{text:implementationText(plan),mode:'default',access:WEB_ACCESS,model:state.model,effort:state.effort}});
    if(id===state.selectedId&&selection===state.selectionVersion){
      if(d.turn)upsertTurn(d.turn);
      renderThread();
      try{await refreshSelected();}catch(error){recordError(error,'thread');}
    }
  }finally{state.busy.delete('message');renderControls();}
}
async function sendDesktopMessage(){
  const annotationDraft=annotations.capture();
  const id=state.selectedId,selection=state.selectionVersion,text=annotatedText($('message-input').value.trim(),annotationDraft.items);
  if(!text||state.busy.has('message')||!state.detail?.desktop?.canSend)return;
  if(desktopSends[id])return;
  if(attachments?.has()){toast('桌面入口暂不支持草稿中的图片，请返回网页入口处理图片后再发送。',true);return;}
  const options=composer.options();
  if(options.skills.length||options.plugins.length){toast('桌面入口暂不支持草稿中的技能或插件引用，请删除后再发送。',true);return;}
  const sent=state.drafts.capture(id,$('message-input').value),messageId=crypto.randomUUID();
  desktopSends[id]={messageId,text:sent.text};saveDesktopSends();
  await action('message',async()=>{
    try{
      await api('/api/desktop/threads/'+encodeURIComponent(id)+'/message',{method:'POST',body:{messageId,text,threads:options.threads}});
      annotations.acknowledge(annotationDraft);
      delete desktopSends[id];saveDesktopSends();
      const cleared=state.drafts.acknowledge(sent);
      if(id===state.selectedId&&selection===state.selectionVersion&&cleared&&$('message-input').value===sent.text){$('message-input').value='';resizeInput();}
    }catch(error){
      if(error.status>=400&&error.status<500&&error.code!=='OUTCOME_UNKNOWN'&&error.code!=='SEND_PENDING'){delete desktopSends[id];saveDesktopSends();}
      throw error;
    }finally{
      if(id===state.selectedId&&selection===state.selectionVersion)await refreshSelected();
    }
  });
}
async function interruptThread() {
  if(state.busy.has('interrupt')||stopFeedback.has(stopContext())||!state.selectedId||newChatOpen)return;
  const desktop=state.desktopMode,id=state.selectedId,selection=state.selectionVersion,key=stopContext();
  const turnId=[...turns()].reverse().find(t=>['inProgress','in_progress','running'].includes(typeOf(t.status)))?.id;
  if(desktop?!turnId:!controlled())return;
  const current=()=>key===stopContext()&&selection===state.selectionVersion&&!newChatOpen;
  const request=stopFeedback.begin(key,turnId,!desktop&&!running());
  await action('interrupt',async()=>{
    try {
      await api((desktop?'/api/desktop/threads/':'/api/threads/')+encodeURIComponent(id)+'/interrupt',{method:'POST',...(desktop?{body:{turnId}}:{})});
    } catch(error) {
      stopFeedback.settle(key,request,error);
      if(current())throw error;
      recordError(error,'interrupt');return;
    }
    stopFeedback.settle(key,request);
    if(current())await refreshSelected();
  });
}
async function moreHistory({deferRender=false}={}) {
  if (!state.historyCursor || !state.selectedId || !state.detail || state.loadingDetail || state.busy.has('history')) return;
  const id = state.selectedId, version = state.selectionVersion;
  $('messages-scroller').setAttribute('aria-busy','true');
  try { return await action('history',async () => {
    let d;
    try{d=await api((state.desktopMode?'/api/desktop/threads/'+encodeURIComponent(id)+'/history':'/api/threads/'+encodeURIComponent(id)+'/history')+'?cursor='+encodeURIComponent(state.historyCursor)+'&lazyTools=1'+(state.desktopMode?'&threadId='+encodeURIComponent(id):''));}
    catch(error){if(error.code==='HISTORY_CURSOR_CHANGED')throw new Error('历史记录已更新。请刷新会话后再向上滚动。');throw error;}
    if (id !== state.selectedId || version !== state.selectionVersion) return;
    const old = new Map(turns().map(t => [t.id,t])); const all = [...[...(d.data || [])].reverse(),...turns()]; const seen = new Set(); state.detail.turns = all.filter(t => !seen.has(t.id) && seen.add(t.id)).map(t => old.get(t.id) || t);
    state.historyCursor = d.nextCursor || null; state.loadedOlderHistory = true; if (d.historySource === 'snapshot') state.detail.historySource = 'snapshot'; if(!deferRender)renderThread();return true;
  }); } finally { $('messages-scroller').setAttribute('aria-busy','false'); }
}
let inputSizeKey;
function resizeInput() {
  const t = $('message-input');
  if (!t.clientWidth) return;
  const key=JSON.stringify([t.value,t.clientWidth,getComputedStyle(t).font,getComputedStyle(t).lineHeight]);
  if(inputSizeKey===key)return;
  inputSizeKey=key;
  t.style.height = '0px';
  const height = Math.max(34,t.scrollHeight);
  t.style.height = Math.min(160,height) + 'px';
  t.style.overflowY = height > 160 ? 'auto' : 'hidden';
}
function upsertTurn(t) {
  if (!state.detail) return;
  state.detail.turns = mergeLiveTurns(turns(),[t]);
}
function ensureTurn(id) {
  if (!state.detail) return null;
  let t = turns().find(t => t.id === id);
  if (!t) { t = {id:id || 'live',status:'inProgress',items:[]}; state.detail.turns = [...turns(),t]; }
  return t;
}
function upsertItem(turnId,item) { const t = ensureTurn(turnId); if (!t) return; if (item.type === 'userMessage') t.items = t.items.filter(old => !old.localAccepted || userContentKey(old.content) !== userContentKey(item.content)); const i = t.items.findIndex(x => x.id === item.id); if (i >= 0) t.items[i] = mergeLiveTurns([{id:turnId,items:[t.items[i]]}],[{id:turnId,items:[item]}])[0].items[0]; else t.items.push(item); }
let streamFullRender=false;
function scheduleStreamRender(kind='all') {
  if(kind!=='text')streamFullRender=true;
  if (state.streamRender) return; state.streamRender = true;
  setTimeout(() => { state.streamRender = false; const full=streamFullRender;streamFullRender=false;renderMessages();if(full){renderRequests();renderControls();} },80);
}
let detailRefreshTimer, listRefreshTimer;
function scheduleDetailRefresh() { if(detailRefreshTimer)return; detailRefreshTimer = setTimeout(() => { detailRefreshTimer=null; if (usable() && state.selectedId) refreshSelected().catch(e => recordError(e,'thread')); },650); }
function scheduleListRefresh() { clearTimeout(listRefreshTimer); listRefreshTimer = setTimeout(() => { if (usable()) loadThreads(false,false,true); },1000); }
const webVersionSync=createVersionSync({flush:()=>{flushDrafts();if(state.drafts.warned)throw Error("Draft persistence failed");},reload:()=>location.reload(),onError:()=>toast('草稿保存失败，请保留当前页面。',true)});
function receiveWebUpdate(data){
 webVersionSync.receive(data);
 window.dispatchEvent(new CustomEvent('rcm:system-update',{detail:data}));
}
document.addEventListener('compositionstart',webVersionSync.compositionStart);
document.addEventListener('compositionend',webVersionSync.compositionEnd);

function handleEvent(event) {
  let data; try { data = JSON.parse(event.data); } catch { return; }
  const method = data.method || event.type, p = data.params || {};
  sideChat?.event(method,p);
  if(method==='account/updated'){
    const version=++accountViewVersion;
    state.listVersion++;createdThreads.clear();state.sidebar=null;state.threads=[];state.projects=[];state.models=[];state.threadCursor=null;
    renderThreads();renderProjects();renderModels();
    void refreshAccountUsage?.(true);
    // Drain old reads before reloading; their version guards discard late data.
    void Promise.allSettled([catalogs.pendingModels(),catalogs.pendingProjects(),loadThreads.pending()]).then(()=>{
      if(version!==accountViewVersion||!connected())return;
      return Promise.allSettled([loadModels(true),loadProjects(),loadThreads(false,true)]).then(results=>{for(const result of results)if(result.status==='rejected')recordError(result.reason,'账号切换刷新');});
    });
    return;
  }
  if (method==='manager/sidebarChanged'||/thread\/(section|readState)\//.test(method)||method.startsWith('threadSection/'))scheduleListRefresh();
  if(method==='manager/taskNotice'){
    // Historical notifications are intentionally not replayed.
    return;
  }
  if(authRecoveryMessage(p.turn?.error||p.error))void refreshAccountUsage?.(true);
  if(!data.replayed)notifyTaskEvent(method,p);
  if (method === 'manager/status') {
    const was = connected(),previousConnection=state.status?.connection?.connectedAt,previousInstance=state.status?.instanceId; applyStatus(p.status || p); renderStatus(); renderRequests(); renderThread();
    for(const request of state.status.pendingRequests||[])notifyTaskEvent('manager/request',request);
    if (!workspaceStarting && connected() && (!was||previousConnection!==state.status?.connection?.connectedAt||previousInstance!==state.status?.instanceId)) resumeWorkspace().catch(e => recordError(e,'sync'));
    return;
  }
  if (method === 'manager/error') { recordError(p.message || p.error || p,p.stage || 'remote'); if(notifyManagerError(p))toast(messageOf(p.message || p.error || p),true,11000); return; }
  if (method === 'manager/request') {
    const r = p.request || p; if (r.id != null) state.localRequests = [...state.localRequests.filter(x => requestKey(x) !== requestKey(r)),r];
    renderRequests();
    return;
  }
  if (method === 'serverRequest/resolved' || method === 'manager/requestResolved') {
    const rid = p.requestId ?? p.id, resolvedKey = p.key ?? (typeof rid + ':' + String(rid)); const filter = list => (list || []).filter(r => requestKey(r) !== resolvedKey);
    state.localRequests = filter(state.localRequests); if (state.status) state.status.pendingRequests = filter(state.status.pendingRequests); if (state.detail) state.detail.pendingRequests = filter(state.detail.pendingRequests); renderRequests(); return;
  }
  if (/thread\/(started|name\/updated|archived|unarchived)|turn\/(started|completed)/.test(method)) scheduleListRefresh();
  const threadId = p.threadId || p.thread?.id;
  if (method === 'mcpServer/startupStatus/updated') {
    updateExtensionNotice(state.runtimeNotices,p);
    if (threadId === state.selectedId && state.detail) scheduleStreamRender();
    return;
  }
  if (threadId !== state.selectedId || !state.detail) return;
  if (method === 'thread/tokenUsage/updated' || method === 'turn/moderationMetadata') return;
  if (method === 'thread/goal/cleared') { scheduleDetailRefresh(); return; }
  if (method === 'thread/queue/changed') { scheduleDetailRefresh(); return; }
  if (method === 'thread/status/changed') { state.detail.thread.status = p.status; scheduleStreamRender(); return; }
  if (method === 'thread/name/updated') { state.detail.thread.name = p.threadName || p.name; renderThread(); return; }
  if (method === 'turn/started' || method === 'turn/completed') {
    if (p.turn) upsertTurn(p.turn); if (method === 'turn/completed') { state.detail.thread.status = {type:'idle'}; scheduleDetailRefresh(); }
    else state.detail.thread.status = {type:'active',activeFlags:[]}; scheduleStreamRender(); return;
  }
  if (method === 'item/started' || method === 'item/completed') { if (p.item) upsertItem(p.turnId,p.item); scheduleStreamRender(); return; }
  if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
    const t = ensureTurn(p.turnId); if (!t) return; let item = t.items.find(x => x.id === p.itemId);
    if (!item) { item = {id:p.itemId,type:method.includes('/plan/') ? 'plan' : 'agentMessage',text:''}; t.items.push(item); } item.text = (item.text || '') + (p.delta || ''); scheduleStreamRender('text'); return;
  }
  if (method === 'item/commandExecution/outputDelta') {
    if(state.status?.service?.outputJournal){scheduleDetailRefresh();return;}
    const t = ensureTurn(p.turnId); if (!t) return; let item = t.items.find(x => x.id === p.itemId);
    if (!item) { item = {id:p.itemId,type:'commandExecution',status:'inProgress',aggregatedOutput:''}; t.items.push(item); }
    item.aggregatedOutput = (item.aggregatedOutput || '') + (p.delta || ''); scheduleStreamRender(); return;
  }
  if (method === 'item/reasoning/summaryTextDelta') {
    const t = ensureTurn(p.turnId); if (!t) return; let item = t.items.find(x => x.id === p.itemId);
    if (!item) { item = {id:p.itemId,type:'reasoning',summary:[]}; t.items.push(item); }
    const i = p.summaryIndex || 0; item.summary[i] = (item.summary[i] || '') + (p.delta || ''); scheduleStreamRender('text'); return;
  }
  if (method === 'error') {
    const t = ensureTurn(p.turnId || turns().at(-1)?.id); if (t) t.error = p.error || p; recordError(p.error || p,'remote'); scheduleStreamRender(); return;
  }
  if (/updated|completed|changed/.test(method)) scheduleDetailRefresh();
}
function setupEvents() {
  const es = new EventSource(targetUrl('/api/events?viewId='+threadViewId)); state.eventSource = es;
  es.onopen = () => {
    threadViewReport=null;
    sideChat?.reconnect();
    const restored = !state.transport; state.transport = true; renderStatus();
    void reportThreadView().catch(e=>recordError(e,'thread'));
    if (restored) resumeWorkspace().catch(e => { recordError(e,'sync'); renderStatus(); });
  };
  es.addEventListener('system/update',event=>{if(state.eventSource===es)receiveWebUpdate(JSON.parse(event.data));});
  es.onmessage = handleEvent;
  ['manager/status','manager/error','manager/request','manager/requestResolved'].forEach(name => es.addEventListener(name,handleEvent));
  es.onerror = () => { state.transport = false; renderStatus(); };
}
const {saveLayout,readLayout,setupResizableLayout,toggleSidebar,toggleInspector}=createLayoutController({element:$,compact:compactLayout});
function wireEvents() {
  automations=installAutomations({api,onOpen:()=>{flushDrafts();closeNewChat();state.selectionVersion++;toggleInspector(false);if(compactLayout())toggleSidebar(false,false);queueMicrotask(renderControls);},
    openSession:async(id,prompt)=>{await selectThread(id,{desktop:true});if(prompt&&state.selectedId===id){const previous=$('message-input').value;if(previous&&previous!==prompt){toast('管理会话已有未发送草稿，请先处理草稿，再返回定时任务继续。',true);$('message-input').focus();return;}$('message-input').value=prompt;state.drafts.set(id,$('message-input').value);resizeInput();renderControls();}$('message-input').focus();},
    openThread:id=>selectThread(id),notify:toast});
  const scheduleNav=el('button','automations-nav');scheduleNav.id='open-automations';scheduleNav.type='button';scheduleNav.textContent='定时任务';scheduleNav.onclick=()=>automations.open();document.querySelector('.inspector-nav').append(scheduleNav);
  const desktopEntry=el('button','text-button','通过桌面继续');desktopEntry.id='desktop-entry';desktopEntry.type='button';desktopEntry.hidden=true;desktopEntry.onclick=()=>selectThread(state.selectedId,{desktop:true});$('takeover').after(desktopEntry);
  const review=el('button','text-button','已核对会话记录，解锁发送');review.id='desktop-review';review.type='button';review.hidden=true;
  review.onclick=()=>action('desktop-review',async()=>{const threadId=state.selectedId;await api('/api/desktop/threads/'+encodeURIComponent(threadId)+'/acknowledge',{method:'POST',body:{messageId:state.detail?.desktop?.unconfirmed||desktopSends[threadId]?.messageId}});delete desktopSends[threadId];saveDesktopSends();await refreshSelected();});
  $('composer-availability').after(review);
  document.querySelector('.main-panel').classList.toggle('desktop-chat',state.desktopMode);
  setInterval(()=>{if(automations.opened&&!document.hidden)void automations.refresh();},15000);

  capacityRetry=installCapacityRetry({container:document.querySelector('.composer-region'),storage:sessionStorage,refresh:refreshSelected,
    context:()=>({host:targetHost,id:state.selectedId,turns:!newChatOpen&&!state.desktopMode?turns():[],unavailableReason:!usable()?'连接尚未恢复，暂不能重试。':running()?'会话正在运行，暂不能重试。':!controlled()?'接管会话后可重试。':'正在确认会话状态，暂不能重试。',ready:!newChatOpen&&!state.desktopMode&&usable()&&controlled()&&!running()&&!uncertainHistory()&&!state.loadingDetail&&!state.historyError&&!state.busy.size}),
    send:async(c,turnId,automatic)=>{try{const result=await api('/api/threads/'+encodeURIComponent(c.id)+'/retry-capacity',{method:'POST',body:{turnId,automatic,model:state.model,effort:state.effort,mode:composer.options().mode}});if(c.host===targetHost&&c.id===state.selectedId){upsertTurn(result.turn);renderThread();scheduleDetailRefresh();}}catch(error){if(c.host===targetHost&&c.id===state.selectedId)await refreshSelected().catch(()=>{});throw error;}}});
  queuedInputs=installQueuedInputs({host:document.querySelector('#conversation>.composer-region'),context:()=>({host:targetHost,id:state.selectedId,queue:state.detail?.queue,visible:!newChatOpen&&!state.desktopMode,ready:usable()&&controlled(),running:running(),supported:featureReady('queueWrite')}),api,refresh:refreshSelected,onError:error=>toast(messageOf(error),true)});
  scrollFollow=installScrollFollow($('messages-scroller'),$('messages'));
  attachments=installAttachments({host:targetHost,context:()=>({id:inputId(),ready:inputReady()&&!state.desktopMode,busy:state.busy.has('message')||state.busy.has('create')}),changed:renderControls,notify:toast});
  handoffControls??=createHandoffControls({endUse:endThreadUse});
  projectFolders=configureProjectBrowser({api,context:()=>({host:targetHost,instance:state.status?.instanceId,ready:newChatOpen&&usable()&&!$('new-cwd').disabled,open:newChatOpen}),onSelect:project=>{
    state.projects=[...state.projects.filter(p=>p.id!==project.id),project];updateNewProjects(project.roots[0]);renderProjects();renderControls();void loadThreads().catch(error=>recordError(error,'刷新新项目'));
  }});
  composer=installComposer({host:targetHost,api,implementPlan,context:()=>({id:inputId(),cwd:newChatOpen?newDraft.cwd:currentThread()?.cwd,ready:inputReady(),busy:state.busy.size>0,active:!newChatOpen&&running(),draft:newChatOpen,desktop:state.desktopMode,threadReferencesSupported:state.detail?.desktop?.threadReferencesSupported===true,turns:turns(),goal:newChatOpen?null:state.detail?.goal,goalError:newChatOpen?null:state.detail?.goalError}),refresh:refreshSelected,notify:toast});
  sideChat=installSideChat({api,requestsChanged:renderRequests,context:()=>({id:inputId(),cwd:currentThread()?.cwd,ready:usable(),model:state.model,effort:state.effort,models:state.models.map(m=>({id:modelId(m),label:m.displayName||modelId(m),defaultEffort:defaultEffort(modelId(m)),efforts:effortsFor(modelId(m)).map(e=>e.value)}))}),renderItem,notify:toast,selectionChanged:()=>{annotations?.refreshMarks();void reportThreadView().catch(e=>recordError(e,'thread'));}});
  annotations=installResponseAnnotations({host:targetHost,context:()=>({id:inputId()}),onSideChat:fragment=>sideChat.open(fragment),sideSelections:()=>sideChat.fragments(),changed:renderControls,notify:toast});
  const settings = $('composer-settings');
  document.addEventListener('click',event => { if (!settings.contains(event.target)) settings.open = false; });
  settings.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); settings.open = false; settings.querySelector('summary').focus(); } });
  setupResizableLayout();
  notificationPreferences.sync();
  installNotificationActions({change:setTaskNotifications,test:() => { if (notificationPreferences.enabled() && Notification.permission === 'granted') sendTaskNotification('Codex · 测试通知','浏览器通知已接入。请检查设备通知中心。','codex-test'); }});
  const syncNotificationPreference=notificationPreferences.sync;
  window.addEventListener('focus',syncNotificationPreference);
  window.addEventListener('storage',event=>{if(event.key==='rcm.taskNotifications.'+targetHost)syncNotificationPreference();});

  let autoRefresh = false;
  try { autoRefresh = localStorage.getItem('rcm.autoRefresh.' + targetHost) === 'true'; } catch {}
  setAutoRefresh(autoRefresh);
  $('auto-refresh').onchange = event => setAutoRefresh(event.target.checked);
  window.addEventListener('pagehide', () => { flushDrafts(); autoRefreshController.stop(); });
  window.addEventListener('pageshow', event => { if (event.persisted) setAutoRefresh($('auto-refresh').checked); });
  document.addEventListener('visibilitychange',() => { if (document.hidden) flushDrafts(); });
  installThreadSync({window,document,
    canSync:()=>!automations?.opened&&!newChatOpen&&(state.desktopMode?state.transport:connected())&&!state.status?.service?.releasing&&!!state.selectedId&&!state.busy.has('handoff:'+state.selectedId),
    refresh:refreshSelected,resume:resumeWorkspace,
    onError:error=>{const message='自动同步暂未成功，将自动重试：'+messageOf(error);if(state.historyError!==message){state.historyError=message;recordError(error,'sync');renderThread();}},
  });
  let composerWidth = 0;
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== composerWidth) { composerWidth = width; requestAnimationFrame(resizeInput); }
  }).observe($('message-input'));
  installConnectionActions({connect:()=>connected()||connectionPending()?disconnectRemote():connectRemote(),reload:reloadLogin,release:releaseService});
  $('welcome-connect').onclick = () => connected() ? openNewDialog() : connectRemote();
  $('new-thread').onclick = openNewDialog; $('takeover').onclick = takeoverThread;
  $('refresh-all').onclick = () => action('refresh',() => refreshWorkspace(true)); $('refresh-projects').onclick = () => action('projects',() => showRefresh('侧边栏',()=>loadThreads(false,true)));
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
  let searchTimer; $('thread-search').oninput = e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = e.target.value.trim(); loadThreads(); },300); };
  const guide=el('button','text-button','引导');guide.id='guide-message';guide.type='button';guide.title='引导当前任务（⌘/Ctrl+Enter）';guide.hidden=true;guide.onclick=()=>sendMessage(undefined,true);$('interrupt').before(guide);
  $('message-form').onsubmit = sendMessage; $('interrupt').onclick = interruptThread;
  $('message-input').oninput = () => { if (inputId() && !draftWritesSuspended) state.drafts.set(inputId(),$('message-input').value); resizeInput(); renderControls(); };
  let composing = false, compositionEnded = -Infinity;
  $('message-input').addEventListener('compositionstart',() => { composing = true; });
  $('message-input').addEventListener('compositionend',() => { composing = false; compositionEnded = performance.now(); });
  $('message-input').onkeydown = e => { if (shouldSendOnEnter(e,{touch:touchInput(),composing,compositionEnded})) { e.preventDefault(); if (!$('send-message').disabled&&!e.repeat&&!e.altKey) sendMessage(undefined,e.metaKey||e.ctrlKey); } };
  $('model-select').onchange = e => { state.model = e.target.value; state.effort = defaultEffort(state.model); fillEfforts($('effort-select'),state.model,state.effort); settings.open=false;settings.querySelector('summary').focus();renderControls(); };
  $('effort-select').onchange = e => { state.effort = e.target.value;settings.open=false;settings.querySelector('summary').focus();renderControls(); };
  $('new-retry-create').onclick=()=>{newDraft.complete();$('new-chat-error').hidden=true;renderControls();$('message-input').focus();};
  $('close-new-chat').onclick=()=>{if(!state.busy.has('create'))closeNewChat();};

  $('toggle-inspector').onclick = () => toggleInspector(); $('close-inspector').onclick = () => toggleInspector(false);
  $('open-sidebar').onclick = () => toggleSidebar();
  $('close-sidebar').onclick = () => { toggleSidebar(false); $('open-sidebar').focus(); };
  $('sidebar-backdrop').onclick = () => { if (compactLayout()) toggleSidebar(false); toggleInspector(false); };
  $('toggle-projects').onclick = () => { const show = $('project-list').hidden; $('project-list').hidden = !show; $('toggle-projects').setAttribute('aria-expanded',String(show)); saveLayout('projects',show); };
  document.addEventListener('keydown',e => { if(e.defaultPrevented||document.querySelector('dialog[open]'))return; if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleSidebar(true); $('thread-search').focus(); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openNewDialog(); } if (e.key === 'Escape' && !compactLayout() && window.innerWidth <= 1050) toggleInspector(false); });
  toggleSidebar(!compactLayout() && readLayout('sidebar',true), false);
  toggleInspector(false);
  $('project-list').hidden = !readLayout('projects',true);
  $('toggle-projects').setAttribute('aria-expanded',String(!$('project-list').hidden));
  mobileUI = installMobileUI({closeDrawers:()=>{toggleSidebar(false,false);toggleInspector(false);},layoutChanged:mobile=>{toggleSidebar(!mobile && readLayout('sidebar',true),false);toggleInspector(false);}});
  turnNavigation=installTurnNavigation({scroller:$('messages-scroller'),content:$('messages'),entryHost:document.querySelector('.mobile-more-panel'),follow:scrollFollow,loadEarlier:moreHistory,loadDirectory:()=>api('/api/threads/'+encodeURIComponent(state.selectedId)+'/turn-directory'),onError:message=>toast(message,true),context:()=>({visible:!newChatOpen&&Boolean(state.selectedId),ready:usable()&&!state.loadingDetail&&!state.historyError&&!state.detail?.recovering&&!selectedRefresh.pending(),turns:state.loadingDetail?[]:turns(),rendering:progressiveTurns.pending,renderHistory:()=>renderThread(),reveal:id=>progressiveTurns.reveal(id),uncertain:uncertainHistory(),totalTurns:state.detail?.totalTurns,hasEarlier:Boolean(state.historyCursor),cursor:state.historyCursor,loading:state.busy.has('history'),historyError:state.historyError})});
  window.addEventListener('offline',() => {  flushDrafts(); state.transport=false; renderStatus(); renderControls(); });
}
async function init() {
  let systemUpdate=null,mobileInstalled=false;
  const loadSettings=()=>{systemUpdate??=installSystemUpdate({api,flush:flushDrafts,resetCsrf:()=>{state.csrf='';}});void systemUpdate.open();};
  const loadMobile=()=>{if(mobileInstalled)return;mobileInstalled=true;installMobile(api).catch(showMobileError);};
  refreshAccountUsage=installAccountUsage({details:text=>toast(text,false,3000,'account-usage',{information:true}),api,connected,context:()=>targetHost+':'+state.status?.instanceId+':'+state.status?.connection?.connectedAt});
  void refreshAccountUsage();
  setInterval(()=>{if(!document.hidden)void refreshAccountUsage();},15000);
  setInterval(()=>{if(document.hidden)return;renderControls();if(!sidebar.menu&&!sidebar.dialog&&!sidebar.drag)renderThreads();},5000);
  setInterval(()=>{if(connected()&&!state.loadingThreads&&!sidebar.pending&&!sidebar.drag&&!sidebar.menu&&!sidebar.dialog&&!document.hidden)loadThreads();},15000);
  $('messages').addEventListener('click',e=>{
    const summary=e.target.closest('summary');if(!summary)return;
    const detail=summary.closest('details[data-item-id]');if(!detail)return;
    const ids=new Set([...$('messages').querySelectorAll('details[open][data-item-id]')].map(n=>n.dataset.itemId));
    if(detail.open)ids.delete(detail.dataset.itemId);else ids.add(detail.dataset.itemId);
    try{sessionStorage.setItem('rcm.openDetails.'+targetHost+'.'+state.selectedId,JSON.stringify([...ids]));}catch{}
  });
  installBrowserBackup(connectionConfig,flushDrafts,()=>{draftWritesSuspended=true;});
  const inspector=$('inspector');
  const navigation=el('nav','inspector-nav');navigation.setAttribute('aria-label','工作区详情分类');
  inspector.querySelector('.inspector-heading').after(navigation);
  const groups=[...inspector.querySelectorAll(':scope > details')];
  const category=group=>group.id==='mobile-access'?'mobile':'settings';
  groups.forEach(group=>{group.open=group.id!=='diagnostics'&&group.id!=='browser-backup'&&!group.classList.contains('connection-section');});
  const views=[['settings','设置'],['mobile','手机访问']];
  function showInspectorView(view){
    if(view==='settings'&&!$('app-shell').classList.contains('inspector-hidden'))loadSettings();
    if(view==='mobile')loadMobile();
    groups.forEach(group=>{group.dataset.viewHidden=String(category(group)!==view);group.hidden=group.dataset.viewHidden==='true'||group.dataset.empty==='true';});
    navigation.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
    inspector.scrollTop = 0;
  }
  for(const [view,title] of views){const button=el('button','',title);button.type='button';button.dataset.view=view;button.onclick=()=>showInspectorView(view);navigation.append(button);}
  showInspectorView('settings');
  wireEvents(); renderStatus(); renderThread(); renderThreads(); setupEvents();
  window.dispatchEvent(new Event('rcm-ready'));
  notificationNavigationReady=true;
  const linkedThread=new URL(location.href).searchParams.get('thread');
  const notification=pendingNotification || (linkedThread && requestedHost===targetHost?{host:targetHost,threadId:linkedThread}:null);
  pendingNotification=null;
  if(notification)openNotificationThread(notification);
  else if(state.selectedId)restoreDetail(state.selectedId,state.selectionVersion);
  try { const c = await api('/api/csrf'); state.csrf = c.token; await loadStatus(); if (connected()) await refreshWorkspace(false,true); else if (!connectionPending()) await connectRemote(); }
  catch (e) { recordError(e,'init'); publishConnectionBanner({hidden:false,className:'connection-banner error',text:messageOf(e)}); }
  finally{workspaceStarting=false;}
}
if(state.selectedId)$('message-input').value=state.drafts.get(state.selectedId)||'';
await init();

$('connection-select').value=targetHost;
$('connection-select').onchange=()=>{if(state.busy.has('create'))return;rememberHost($('connection-select').value);if(inputId())state.drafts.set(inputId(),$('message-input').value);try{sessionStorage.setItem('rcm.drafts.'+targetHost,JSON.stringify([...state.drafts]));}catch{}const url=new URL(location.href);url.searchParams.set('host',$('connection-select').value);url.searchParams.delete('thread');location.assign(url);};

const clearRecovery=el('button','text-button','清除日志缓存并重新加载');
clearRecovery.type='button';
clearRecovery.onclick=async()=>{flushDrafts();clearRecovery.disabled=true;cancelDetailSave();try{await clearDetailCache();location.reload();}catch(e){clearRecovery.disabled=false;toast('无法清除日志缓存：'+messageOf(e),true);}};
$('diagnostics').append(clearRecovery);
