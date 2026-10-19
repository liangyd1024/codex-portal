import {notificationSupport,prepareNotificationWorker,submitWorkerNotification} from './notification-platform.js';
import {deliverNotice,submitNotification} from './notification-delivery.js';
import {asyncQuestions,QuestionDrafts} from './questions.js';
import {questionForm} from './question-form.js';
import {fileLink,closeFileViewer} from './message-files.js';
import {notifyManagerError, recoveryMessage, selectedRecoveryMessage} from './recovery-state.js';
import {activitySource,conversationActivity,renderConversationActivity,processGroupStatus} from './activity.js';
let scrollFollow,scrollContext;
import {userMessageContent,itemImageUrl,isRasterImage,imageCard} from './message-media.js';
import {markdown, groupTurnItems} from './message-body.js';
import {reconcileMessages} from './message-dom.js';
import {NewChatDraft} from './new-chat.js';
import {installAttachments} from './attachments.js';
let attachments;
import {Sidebar} from './sidebar.js';
import {DraftStore, shouldSendOnEnter, coalesceRefresh} from './input-state.js';
import {installAutomations} from './automations.js';
let automations;
import {installThreadSync} from './thread-sync.js';
import {installMobileUI, compactLayout, touchInput, installScrollFollow} from './mobile-ui.js';
let mobileUI, draftWritesSuspended = false;
import {createHandoffControls} from './thread-handoff.js';
let handoffControls;
import {installBrowserBackup} from './browser-backup.js';
import {installComposer, WEB_ACCESS} from './composer.js';
import {installMobile} from './mobile.js';
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
const response=await fetch('/api/connections');
if(!response.ok)throw new Error('无法读取连接配置。');
const connectionConfig=await response.json();
const connectionIds=connectionConfig.data.map(c=>c.id);
const targetHost=connectionIds.includes(requestedHost)?requestedHost:connectionIds.includes(savedHost())?savedHost():connectionConfig.defaultConnection;
document.getElementById('connection-select').replaceChildren(...connectionConfig.data.map(c=>new Option(c.host.alias,c.id)));
function savedView() { try { return JSON.parse(sessionStorage.getItem('rcm.view.'+targetHost)||'{}'); } catch { return {}; } }
function pendingDesktopSends(){try{return JSON.parse(sessionStorage.getItem('rcm.desktopSends.'+targetHost)||'{}');}catch{return {};}}
const desktopSends=pendingDesktopSends();
function saveDesktopSends(){try{sessionStorage.setItem('rcm.desktopSends.'+targetHost,JSON.stringify(desktopSends));}catch{toast('浏览器无法保存发送回执，请先核对原始会话再重试。',true);}}
function saveView() { try { sessionStorage.setItem('rcm.view.'+targetHost,JSON.stringify({selectedId:state.selectedId,projectId:state.projectId,desktopMode:state.desktopMode})); } catch {} }
function rememberHost(host) { try { localStorage.setItem('rcm.connection',host); } catch {} }
rememberHost(targetHost);
const targetUrl=path=>path+(path.includes('?')?'&':'?')+'host='+targetHost;
const retiredStatusInstances=new Set();
function applyStatus(status){
  const next=selectConnectionStatus(state.status,status,retiredStatusInstances);
  const previous=state.status;
  if(previous&&(previous.instanceId!==next.instanceId||previous.connection?.state!==next.connection?.state||
    previous.controlledThreads?.includes(state.selectedId)!==next.controlledThreads?.includes(state.selectedId)||
    Boolean(previous.handoffs?.some(h=>h.threadId===state.selectedId))!==Boolean(next.handoffs?.some(h=>h.threadId===state.selectedId))))state.detailVersion++;
  if(state.status?.instanceId&&next.instanceId!==state.status.instanceId){
    state.csrf='';state.localRequests=[];
    if(state.detail){state.detail.controlled=false;state.detail.controlState='viewing';state.detail.pendingRequests=[];}
  }
  state.status=next;
}

const $ = id => document.getElementById(id);
const state = {
  desktopMode:Boolean(savedView().desktopMode), status: null, models: [], projects: [], threads: [], selectedId: savedView().selectedId || null, detail: null,
  sidebar:null, sidebarArchived:false, selectedArchived:false, projectId: savedView().projectId || null, search: '', threadCursor: null, historyCursor: null, loadedOlderHistory: false,
  model: '', effort: '', csrf: '', transport: false, busy: new Set(), loadingThreads: false, loadingModels: false, loadingProjects: false, threadListSource: null,
  runtimeNotices: new Map(), loadingDetail: false, errors: [], localRequests: [], drafts: new DraftStore({storage:()=>sessionStorage,host:targetHost,onError:()=>toast('浏览器无法保存草稿，请先复制重要内容。',true)}), selectionVersion: 0,
  listVersion: 0, detailVersion: 0, threadPageError: false, historyError: '', eventSource: null, lastSync: null, refreshScope: '', refreshMessage: '', refreshing: false, streamRender: false, requestSignature: '',
};
const questionDrafts=new QuestionDrafts(sessionStorage,targetHost,()=>toast('问题草稿暂未保存，请先复制回答。',true));
const newDraftId='local:new-chat-draft';
const newDraft=new NewChatDraft(sessionStorage,'rcm.new-chat.'+targetHost);
let newChatOpen=false;
const inputId=()=>newChatOpen?newDraftId:state.selectedId;
const inputReady=()=>state.desktopMode&&!newChatOpen?false:newChatOpen?usable()&&Boolean(newDraft.cwd):usable()&&controlled()&&!state.selectedArchived;
function rememberNewDraft(){try{newDraft.save();}catch{toast('新会话草稿设置暂未保存，请保留当前页面。',true);}}
function closeNewChat(restore=true){
  if(!newChatOpen)return;
  state.drafts.set(newDraftId,$('message-input').value);newChatOpen=false;
  $('conversation').append(document.querySelector('.composer-region'));
  $('new-chat-page').hidden=true;document.querySelector('.main-panel').classList.remove('new-chat-open');document.querySelector('.main-panel').classList.toggle('desktop-chat',restore&&state.desktopMode);
  if(restore){$('message-input').value=state.drafts.get(state.selectedId)||'';renderThread();resizeInput();}
}
function flushDrafts() {
  if (draftWritesSuspended) return;
  if (inputId()) state.drafts.set(inputId(),$('message-input').value);
  else state.drafts.persist();
  saveView(); saveOutputPositions();
}
const resumeWorkspace = coalesceRefresh(async () => {
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
  const all = [...(state.status?.pendingRequests || []), ...(state.detail?.pendingRequests || []), ...state.localRequests, ...asyncQuestions(turns(),state.selectedId)];
  const map = new Map(); all.forEach(r => { if (r?.id != null) map.set(requestKey(r), r); });
  return [...map.values()];
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
  const n = $('refresh-status');
  n.hidden = !state.refreshMessage;
  n.classList.toggle('error', !state.refreshing && state.refreshMessage.includes('失败'));
  n.setAttribute('aria-busy', String(state.refreshing));
  setText('refresh-message', state.refreshMessage);
  setText('refresh-time', state.lastSync ? state.refreshScope + '最后更新：' + dateTime(state.lastSync) + '（北京时间）' : '尚未成功刷新');
  const syncTime = timestamp(state.lastSync);
  const compactTime = syncTime ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(syncTime) : '';
  setText('refresh-compact', state.refreshing ? '刷新中…' : state.refreshMessage.endsWith('刷新成功') ? '已刷新' + (compactTime ? ' · ' + compactTime : '') : state.refreshMessage.includes('失败') ? '刷新失败' : state.refreshMessage);
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
    state.refreshMessage = scope + '刷新成功';
    refreshNoticeTimer = setTimeout(() => {
      refreshNoticeTimer = null;
      state.refreshMessage = '';
      renderRefresh();
    }, 2500);
  } catch (error) {
    state.refreshMessage = scope + '刷新失败：' + (error.message || String(error));
    recordError(error,'refresh');
  } finally { state.refreshing = false; renderRefresh(); }
}
function recordError(error, stage = 'client') {
  const message = messageOf(error);
  const last = state.errors[state.errors.length - 1];
  if (!last || last.message !== message || Date.now() - last.time > 5000) state.errors.push({message,stage,time:Date.now()});
  state.errors = state.errors.slice(-20); renderDiagnostics();
}
function toast(message, error = false, duration = 7500) {
  const n = el('div','toast' + (error ? ' error' : '')); n.setAttribute('role', error ? 'alert' : 'status');
  n.append(icon(error ? 'alert' : 'check'), el('p','', message));
  const close = el('button','icon-button'); close.type = 'button'; close.setAttribute('aria-label','关闭提示'); close.append(icon('close')); close.onclick = () => n.remove(); n.append(close);
  $('toasts').append(n); setTimeout(() => n.remove(), duration);
}
async function api(path, options = {}) {
  path=targetUrl(path);
  const method = options.method || 'GET';
  const headers = {Accept:'application/json',...options.headers};
  if (method !== 'GET') {
    if (!state.csrf) { const c = await api('/api/csrf'); state.csrf = c.token; }
    headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = state.csrf;
  }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeout || 90000);
  let response;
  try {
    response = await fetch(path, {method, credentials:'same-origin', headers, signal:controller.signal, ...(method !== 'GET' ? {body:JSON.stringify(options.body || {})} : {})});
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('服务未返回有效数据。请查看连接诊断。'); }
    if (!response.ok) {
      if(response.status===401&&data.error?.code==='PAIRING_REQUIRED'){flushDrafts();location.reload();}
      const e = new Error(data.error?.message || data.message || '请求失败，HTTP ' + response.status);
      e.readOnly = method==='GET'; e.status = response.status; e.code = data.error?.code; e.details = data.error?.details; throw e;
    }
    // Freshness uses this browser's clock, including observations from SSH hosts.
    for(const thread of [data.thread,...(Array.isArray(data.data)?data.data:[])]) {
      if(thread?.activity)thread.activity.observedAt=Date.now();
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(method==='GET'?'读取超时，已有内容和草稿保留，请重试刷新。':'操作结果未确认，草稿已保留。请先核对会话记录，避免重复提交。');
    if (e instanceof TypeError) throw new Error('无法连接本机服务。请确认服务仍在运行。');
    throw e;
  } finally { clearTimeout(timer); }
}
async function action(key, fn) {
  if (state.busy.has(key)) return;
  state.busy.add(key); renderControls();
  try { return await fn(); }
  catch (e) { recordError(e,key); toast(messageOf(e),true,11000); }
  finally { state.busy.delete(key); if(['connect','disconnect','release'].includes(key))renderStatus();else renderControls(); }
}

function renderStatus() {
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
  setText('host-name',h.alias || '目标机器'); setText('breadcrumb-host',h.alias || '目标机器');
  setText('host-address',h.hostname || '目标机器'); setText('connection-label',label); setText('inspector-connection',label);
  setText('detail-host',h.hostname || h.alias || '目标机器'); setText('detail-user',h.user);
  setText('detail-version', service.version || h.version); setText('detail-connected', dateTime(c.connectedAt));
  setText('transport-label', state.transport ? '实时通道已连接' : '实时通道未连接');
  ['machine-dot','inspector-dot'].forEach(id => $(id).className = 'connection-dot ' + variant);
  $('connection-pill').className = 'connection-pill ' + variant;
  $('connection-pill').querySelector('.connection-dot').className = 'connection-dot ' + variant;
  const connect = $('connect-button'); clear(connect); connect.append(icon(connected()||connectionPending() ? 'close' : 'link'),el('span','',state.busy.has('disconnect') ? '正在断开…' : connectionPending()?'取消连接':connected() ? '断开本机连接' : '连接目标机器'));
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
  const banner = $('connection-banner');
  const error = c.error ? messageOf(c.error) : '';
  if (!state.transport) { banner.hidden = false; banner.className = 'connection-banner'; banner.textContent = '与网页服务的连接已中断，正在自动重连。已有内容和草稿保留，恢复后将自动同步。'; }
  else if (error) { banner.hidden = false; banner.className = 'connection-banner error'; banner.textContent = error; }
  else if (['connecting','reconnecting'].includes(conn)) { banner.hidden = false; banner.className = 'connection-banner'; banner.textContent = '正在连接目标机器。' + (c.stage ? (stages[c.stage] || c.stage) + '…' : '正在核验连接状态…'); }
  else if(connected()&&service.protocolValidation?.status==='limited'){const names={create:'新建会话',takeover:'接管会话',message:'发送消息',steer:'补充要求',stop:'停止',queue:'排队输入',handoff:'交还桌面端',release:'释放控制'};const disabled=Object.entries(service.protocolValidation.features||{}).filter(([,v])=>!v.supported).map(([name])=>names[name]||name);banner.hidden=false;banner.className='connection-banner';banner.textContent='已连接。当前引擎暂不支持：'+(disabled.join('、')||'部分协议读取')+'。其他已核验功能仍可使用。详见连接诊断。';}
  else if(connected()&&selectedRecoveryMessage(s.recoveryFailures,newChatOpen?null:state.selectedId)){banner.hidden=false;banner.className='connection-banner';banner.textContent=selectedRecoveryMessage(s.recoveryFailures,state.selectedId);}
  else banner.hidden = true;
}
function renderControls() {
  renderConnectionBanner();
  const ready = usable(), own = newChatOpen||controlled()&&!state.selectedArchived, active = !newChatOpen&&running();
  const background = backgroundActivity(state.detail,{controlled:own,connected:ready});
  const handoff=currentHandoff(),handing=state.busy.has('handoff:'+state.selectedId)||handoff?.state==='checking';
  handoffControls??=createHandoffControls({endUse:endThreadUse});
  handoffControls.render({id:newChatOpen?null:state.selectedId,context:targetHost+':'+state.selectedId+':'+state.selectionVersion,running:active,owned:Boolean(state.detail?.controlled||state.status?.controlledThreads?.includes(state.selectedId)),handoff,connected:ready,
    supported:state.status?.service?.protocolValidation?.features?.handoff?.supported===true,busy:handing,archived:state.selectedArchived,conflict:state.detail?.controlState==='conflict'});
  const posting = state.busy.has('message')||state.busy.has('create'), switching = state.busy.has('takeover'), creating = state.busy.has('create');
  $('connection-select').disabled=creating;
  $('new-thread').disabled = !ready || !featureReady('create') || creating || !state.models.length || state.loadingModels;
  $('connect-button').disabled = state.busy.has('connect') || state.busy.has('disconnect') || state.busy.has('release');
  $('welcome-connect').disabled = connectionPending() || state.busy.has('connect') || state.busy.has('disconnect') || (connected() && (!ready || !state.models.length||!featureReady('create')));
  $('release-service').disabled = !ready || !featureReady('release') || !state.status?.service?.running || state.busy.has('release');
  $('release-service').textContent = state.busy.has('release') ? '正在检查并释放…' : '停止目标服务（影响所有入口）';
  $('refresh-projects').disabled = !ready || state.refreshing; $('refresh-all').disabled = state.refreshing || state.busy.has('refresh');
  $('thread-search').disabled = !connected();
  $('model-select').disabled = !ready || !state.models.length || state.loadingModels;
  $('effort-select').disabled = !ready || !state.model || !effortsFor(state.model).length || state.loadingModels;
  const input = $('message-input'); input.disabled = !ready || !own || posting || handing;
  input.placeholder = !ready ? '连接后继续…' : state.selectedArchived ? '恢复会话后可继续…' : !own ? '接管后发送消息…' : active ? '补充要求…' : '发送消息…';
  const hasModel = Boolean(state.model && state.models.some(m => modelId(m) === state.model));
  const hasEffort = effortsFor(state.model).some(e => e.value === state.effort);
  $('send-message').disabled = !ready || !own || !featureReady(active?'steer':'message') || posting || attachments?.pending() || (!input.value.trim()&&!attachments?.has()) || (!active && (!hasModel || !hasEffort));
  $('send-message').setAttribute('aria-label',active ? '补充当前轮次' : '发送消息');
  $('message-form').setAttribute('aria-busy',String(posting));
  $('send-message').title = posting ? '正在发送…' : active ? '补充当前轮次' : '发送消息';
  $('interrupt').hidden = !active&&background.state!=='running'; $('interrupt').disabled = !ready || !own || !featureReady('stop') || state.busy.has('interrupt');
  $('takeover').hidden = own || !state.selectedId || state.selectedArchived; $('takeover').disabled = !ready || !featureReady('takeover') || switching || handing || !state.selectedId;
  $('takeover').querySelector('span').textContent = switching ? '正在接管…' : handoff ? '在网页继续' : '接管会话';
  const availability = $('composer-availability');
  const unavailable = !ready ? '连接恢复后可继续，草稿已保留。' : state.selectedArchived ? '此会话已归档，恢复后可继续。' : handing ? '正在确认交还状态，草稿已保留。' : posting ? '正在发送…' : state.busy.has('interrupt') ? '正在请求停止，请稍候…' : !featureReady(active?'steer':'message') ? '当前引擎暂不支持此操作。' : active && !featureReady('stop') ? '当前引擎暂不支持停止，仍可补充要求。' : own && !hasModel ? '请选择一个可用模型。' : own && !hasEffort ? '请选择思考档位。' : '';
  availability.textContent = unavailable; availability.hidden = !unavailable;
  $('new-thread').setAttribute('aria-description',!ready ? '连接恢复后可新建会话。' : !state.models.length ? '正在等待目标机器模型目录。' : creating ? '正在创建，请稍候。' : '');
  controlReason('new-thread',$('new-thread').getAttribute('aria-description') || (!featureReady('create') ? '当前引擎不支持创建会话。' : '正在读取模型目录…'));
  controlReason('takeover',!ready ? '连接恢复后可接管。' : switching ? '正在接管，请稍候。' : handing ? '交还状态正在确认，请稍候。' : '当前引擎暂不支持接管。');
  controlReason('release-service',!ready ? '连接恢复后可检查目标服务。' : !featureReady('release') ? '当前引擎不支持从此入口停止服务。' : state.busy.has('release') ? '正在检查维护条件…' : '目标服务未运行。');
  $('interrupt').title=active?'停止当前轮次':'停止后台命令';
  $('interrupt').setAttribute('aria-label',state.busy.has('interrupt') ? '正在请求停止' : $('interrupt').title);
  $('interrupt').setAttribute('aria-busy',String(state.busy.has('interrupt')));
  const indicator=$('running-indicator'),nextIndicator=el('div');
  renderConversationActivity(nextIndicator,newChatOpen?null:conversationActivity(currentThread(),{
    connected:ready,controlled:controlled(),active,background,
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
    $('new-cwd').disabled=creating||newDraft.phase==='uncertain';$('close-new-chat').disabled=creating;
    $('interrupt').hidden=true;$('takeover').hidden=true;
    $('thread-title').hidden=false;setText('thread-title','新会话');
  }
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
  if($('desktop-review'))$('desktop-review').hidden=true;
  if(state.desktopMode&&!newChatOpen){
    const desktop=state.detail?.desktop,online=state.transport&&desktop?.available,unconfirmed=desktop?.unconfirmed||desktopSends[state.selectedId]?.messageId;
    input.disabled=posting;input.placeholder=active?'任务执行中，可先输入下一条要求…':'描述要创建、修改或删除的定时任务…';
    $('takeover').hidden=true;
    $('send-message').disabled=!online||!desktop?.canSend||!!unconfirmed||posting||!input.value.trim();
    $('send-message').title='发送到桌面会话';$('send-message').setAttribute('aria-label','发送到桌面会话');
    $('interrupt').hidden=!active;$('interrupt').disabled=!online||state.busy.has('interrupt');
    const reason=!state.transport?'网页连接中断，草稿已保留。':desktop?.error||(posting?'正在发送到桌面…':!desktop?'正在确认桌面会话…':unconfirmed?'上次发送结果未确认，请先核对原始会话记录，避免重复创建任务。':active?'桌面正在执行，请等待完成；需要回答或确认时请在桌面处理。':!desktop.canSend?'桌面状态未确认，请稍后刷新。':'');
    availability.textContent=reason;availability.hidden=!reason;
    $('desktop-review').hidden=!unconfirmed;$('desktop-review').disabled=!online||!desktop?.canSend||posting||state.busy.has('desktop-review');
    setText('composer-hint','使用桌面会话的模型与设置。发送成功仅代表会话已接收，任务结果以原始回复为准。');
  }
  if(automations?.opened){$('thread-title').hidden=false;setText('thread-title','定时任务');}
}
function controlReason(id, text) {
  const button = $(id); let note = $('reason-' + id);
  if (!note) { note = el('p','control-reason'); note.id = 'reason-' + id; button.after(note); button.setAttribute('aria-describedby',note.id); }
  note.textContent = text; note.hidden = !button.disabled || button.hidden;
}
const sidebar = new Sidebar({node:$('thread-list'),host:targetHost,icon,threadName,relativeTime,api,toast,
  activitySource:t=>activitySource(t,{connected:usable(),webActive:((state.status?.controlledSessions||[]).find(s=>s.id===t.id)?.status||t.status)?.type==='active'}),
  connected:usable,selectedId:()=>state.selectedId,newThread:openNewDialog,
  select:t=>{state.projectId=t.projectId;state.selectedArchived=!!t.archived;saveView();selectThread(t.id);},
  onArchiveView:archived=>{state.sidebarArchived=archived;state.threadCursor=null;state.threads=[];loadThreads();},
  refresh:()=>loadThreads(false,true),
  changed:async(action,t)=>{if(t?.id===state.selectedId&&['archive','restore'].includes(action))state.selectedArchived=action==='archive';await Promise.all([loadThreads(false,true),loadStatus()]);if(t?.id===state.selectedId)await refreshSelected();renderControls();},
});
function renderProjects() { renderThreads(); if(newChatOpen&&!state.busy.has('create')){updateNewProjects();renderControls();} }
function renderThreads() {
  setText('projects-heading',state.loadingProjects||state.loadingThreads?'工作区 · 同步中':'工作区');
  if(state.sidebar)sidebar.render({...state.sidebar,data:state.threads},{search:state.search,loading:state.loadingThreads});
  setText('breadcrumb-project',state.projects.find(p=>p.id===state.projectId)?.name||'工作区');
  $('more-threads').hidden=!state.loadingThreads&&!state.threadPageError&&!state.threadCursor;
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
  clear(select); if (!state.models.length) { const o = el('option','',state.loadingModels ? '正在读取模型…' : '等待模型目录'); o.value = ''; select.append(o); return; }
  state.models.forEach(m => { const o = el('option','',m.displayName || modelId(m)); o.value = modelId(m); o.title = m.description || ''; select.append(o); });
  select.value = state.models.some(m => modelId(m) === selected) ? selected : modelId(state.models.find(m => m.isDefault) || state.models[0]);
}
function fillEfforts(select, model, effort) {
  clear(select); const opts = effortsFor(model);
  if (!opts.length) { const o = el('option','','无可用档位'); o.value = ''; select.append(o); return; }
  opts.forEach(e => { const o = el('option','',e.label); o.value = e.value; o.title = e.description; select.append(o); });
  select.value = opts.some(e => e.value === effort) ? effort : defaultEffort(model);
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
  if (!modelFor(state.model)) state.model = state.models.length ? modelId(state.models.find(m => m.isDefault) || state.models[0]) : '';
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
function renderCommandOutput(item) {
  const output = item.aggregatedOutput || (uncertainHistory() ? '快照未包含命令输出。' : typeOf(item.status) === 'inProgress' ? '等待命令输出…' : '无命令输出');
  const wrap=el('div','command-output-view');
  wrap.dataset.outputStamp=String(item.outputToken||output.length)+':'+String(outputPositions.get(state.selectedId+':'+item.id)??'tail');
  if(item.outputPartial){wrap.append(el('span','subtle','已显示输出开头，正在补齐完整日志…'),el('pre','tool-output',output));return wrap;}
  if(output.length<=OUTPUT_WINDOW_SIZE) { wrap.append(el('pre','tool-output',output)); return wrap; }
  const key=state.selectedId+':'+item.id, page=outputWindow(output,outputPositions.get(key) ?? 'tail');
  const controls=el('div','output-controls');
  controls.append(el('span','','完整输出已保留 · '+(page.start+1)+'–'+page.end+' / '+page.total+' 字符'));
  for(const [label,position,disabled] of [['开头',0,page.start===0],['上一段',Math.max(0,page.start-OUTPUT_WINDOW_SIZE),page.start===0],['下一段',page.end,page.end===page.total],['跟随最新','tail',page.following]]) {
    const b=el('button','secondary-button',label);b.type='button';b.disabled=disabled;
    b.onclick=()=>{outputPositions.set(key,position);saveOutputPositions();renderMessages();};controls.append(b);
  }
  const jump=el('input');jump.type='number';jump.min='1';jump.max=String(Math.ceil(page.total/OUTPUT_WINDOW_SIZE));jump.value=String(page.following?Number(jump.max):Math.floor(page.start/OUTPUT_WINDOW_SIZE)+1);jump.setAttribute('aria-label','输出段号');jump.style.width='5em';
  jump.oninput=()=>{const n=Number(jump.value);if(Number.isInteger(n)&&n>=1&&n<=Number(jump.max))outputPositions.set(key,(n-1)*OUTPUT_WINDOW_SIZE);};
  jump.onblur=()=>setTimeout(renderMessages,0);
  const go=el('button','secondary-button','跳转');go.type='button';go.onclick=()=>{jump.oninput();saveOutputPositions();renderMessages();};
  controls.append(el('span','','跳转到段'),jump,el('span','','/ '+jump.max),go);
  const download=el('button','secondary-button','下载完整输出');download.type='button';
  download.onclick=()=>{const url=URL.createObjectURL(new Blob([output],{type:'text/plain;charset=utf-8'}));const a=el('a');a.href=url;a.download='command-'+item.id+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};controls.append(download);
  const pre=el('pre','tool-output',page.text);pre.dataset.followTail=String(page.following);
  wrap.append(controls,pre);return wrap;
}
function renderItem(item) {
  const imageUrl=options=>itemImageUrl(state.selectedId,item.id,{...options,host:targetHost});
  const fileContext={threadId:state.selectedId,itemId:item.id,host:targetHost};
  const bodyMarkdown=text=>markdown(text,0,{file:(path,label)=>fileLink(path,label,fileContext),image:(path,label)=>{
    if(!isRasterImage(path))return null;
    if(path.startsWith('/')&&!path.startsWith('//'))return imageCard(imageUrl({reference:path}),label||'回复图片');
    if(/^data:image\/(png|jpeg|webp|gif);base64,/.test(path))return imageCard(path,label||'回复图片');
    return null;
  }});
  if (item.type === 'userMessage') {
    const m=el('div','message user'),bubble=el('div','user-bubble'),content=userMessageContent(item.content);
    if(content.text)bubble.append(el('div','user-message-text',content.text));
    for(const part of content.images){
      const src=part.type==='image'&&/^data:image\/(png|jpeg|webp|gif);base64,/.test(part.url||'')?part.url:imageUrl({part:part.index});
      bubble.append(imageCard(src,'图片附件 '+(part.index+1)));
    }
    m.append(bubble);return m;
  }
  if (['agentMessage','plan'].includes(item.type)) {
    const m = el('article','message agent'); m.setAttribute('aria-label',item.type === 'plan' ? '计划' : 'Codex 回复'); const label = el('div','agent-label' + (item.type === 'agentMessage' ? ' message-author' : '')); label.append(icon('mark'),el('span','',item.type === 'plan' ? '计划' : 'Codex')); m.append(label);
    const text=String(item.text||''), heartbeat=text.match(/<heartbeat>\s*<automation_id>([^<]+)<\/automation_id>\s*<decision>([^<]+)<\/decision>\s*<message>([\s\S]*?)<\/message>\s*<\/heartbeat>/);
    if(heartbeat){
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
    body.append(renderCommandOutput(item));
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
    body.append(el('div','tool-meta', '服务：' + (item.server || '—')));
    if (item.arguments) body.append(el('pre','tool-output',pretty(item.arguments)));
    if (item.result) body.append(el('pre','tool-output',pretty(item.result)));
    if (item.error) body.append(el('div','tool-error',messageOf(item.error)));
  } else if (item.type === 'functionCallOutput') body.append(el('pre','tool-output',typeof item.output === 'string' ? item.output : pretty(item.output)));
  else if (item.type === 'dynamicToolCall') { body.append(el('pre','tool-output',pretty(item.arguments || {}))); if (item.contentItems) body.append(el('pre','tool-output',pretty(item.contentItems))); }
  else if (item.type === 'webSearch') body.append(el('pre','tool-output',item.query || pretty(item.action || item)));
  else body.append(el('pre','tool-output',pretty(item)));
  return d;
}
function kindName(kind) { const k = typeOf(kind); return {add:'新增',delete:'删除',update:'修改',create:'新增',modify:'修改'}[k] || k || '修改'; }
let lastMessageShape;
function renderMessages() {
  // Keep the jump input stable while the user types; render after blur.
  if(document.activeElement?.matches('.output-controls input')) return;
  const scroller = $('messages-scroller');
  const context=targetHost+':'+state.selectedId;
  if(scrollContext!==context){closeFileViewer();scrollContext=context;scrollFollow?.reset();clear($('messages'));lastMessageShape=undefined;}
  const nearBottom = scrollFollow?.following ?? true;
  const shape=JSON.stringify([state.selectedId,state.loadingDetail,state.historyError,controlled(),uncertainHistory(),state.detail?.recovering,[...(state.runtimeNotices.get(state.selectedId)?.values()||[])],turns()],(key,value)=>['aggregatedOutput','outputToken'].includes(key)?undefined:value);
  if(shape===lastMessageShape){
    for(const turn of turns())for(const item of turn.items||[]){
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
  const anchor = state.busy.has('history') ? [...$('messages').querySelectorAll('.message-turn')].find(node => node.getBoundingClientRect().bottom > viewportTop) : null;
  const anchorId = anchor?.dataset.turnId, anchorOffset = anchor ? anchor.getBoundingClientRect().top - viewportTop : 0;
  const opened = new Set($('messages').querySelector('details[data-item-id]') ? [...$('messages').querySelectorAll('details[open][data-item-id]')].map(n => n.dataset.itemId) : savedOpenDetails());
  const n = el('div');
  const commit = () => reconcileMessages($('messages'), n);
  if (state.loadingDetail) { n.append(el('div','empty-history loading','正在读取会话历史…')); commit(); return; }
  if (state.historyError) { n.append(el('div','turn-error',state.historyError)); if(!turns().length){commit();return;} }
  if(state.detail?.recovering)n.append(el('div','history-notice','已恢复本机保存的输出，正在同步最新内容…')); 
  for (const notice of state.runtimeNotices.get(state.selectedId)?.values() || []) n.append(renderExtensionNotice(notice));
  if (!turns().length) { const empty = el('div','empty-history'); empty.append(icon('chat'),el('p','','此会话暂无消息。'),el('p','',controlled() ? '输入要求，开始目标机器工作。' : '接管后，可以在此会话开始工作。')); n.append(empty); }
  turns().forEach(t => {
    const turn = el('section','message-turn'); turn.dataset.turnId = t.id;
    const meta = el('div','turn-meta'); meta.classList.toggle('needs-attention',['failed','declined','systemError','interrupted'].includes(typeOf(t.status))); meta.append(el('span','',dateTime(t.startedAt || t.createdAt,true)));
    const actualModel = t.model || t.modelInfo?.model, actualEffort = t.effort || t.reasoningEffort || t.modelInfo?.reasoningEffort;
    if (actualModel || actualEffort) meta.append(el('span','turn-model',[actualModel,actualEffort && '思考：' + (effortNames[actualEffort] || actualEffort)].filter(Boolean).join(' · ')));
    const turnStatus = uncertainHistory() && ['inProgress','in_progress','running'].includes(typeOf(t.status)) ? '状态未确认' : statusNames[typeOf(t.status)] || typeOf(t.status);
    meta.append(el('span','turn-status',turnStatus)); turn.append(meta);
    for (const group of groupTurnItems(t)) {
      if (group.type === 'message') { const message=renderItem(group.item); message.dataset.messageId=group.item.id; turn.append(message); continue; }
      const processGroup = el('details','activity-group process-group');
      processGroup.dataset.itemId = 'process-' + t.id + '-' + group.key;
      const summary = el('summary');
      summary.append(icon('chevron','chevron'),el('span','','查看过程'));
      const processStatus = processGroupStatus(t,group.items,{uncertain:uncertainHistory(),background:backgroundActivity(state.detail,{controlled:controlled(),connected:usable()})});
      if (processStatus) summary.append(el('span','process-status',processStatus));
      const body = el('div','activity-items');
      for (const item of group.items) { const message=renderItem(item); message.dataset.messageId=item.id; body.append(message); }
      processGroup.append(summary,body); turn.append(processGroup);
    }
    if (t.error) turn.append(el('div','turn-error',messageOf(t.error)));
    n.append(turn);
  });
  n.querySelectorAll('details[data-item-id]').forEach(d => { if (opened.has(d.dataset.itemId)) d.open = true; });
  commit();
  const rendered = $('messages');
  rendered.querySelectorAll('.tool-output[data-follow-tail="true"]').forEach(pre=>{pre.scrollTop=pre.scrollHeight;});
  if (nearBottom && !state.busy.has('history')) scroller.scrollTop = scroller.scrollHeight;
  else if (state.busy.has('history')) {
    const restored = [...rendered.querySelectorAll('.message-turn')].find(node => node.dataset.turnId === anchorId);
    const targetTop = restored ? oldTop + restored.getBoundingClientRect().top - viewportTop - anchorOffset : oldTop + (scroller.scrollHeight - oldHeight);
    // A short initial page can leave blank space below the last message.
    // Retain that space so the browser does not clamp the restored position.
    const missingSpace = targetTop - (scroller.scrollHeight - scroller.clientHeight);
    if (missingSpace > 0) rendered.style.paddingBottom = (parseFloat(rendered.style.paddingBottom) || 0) + Math.ceil(missingSpace) + 'px';
    scroller.scrollTop = targetTop;
  }
  else scroller.scrollTop = oldTop;
}
function renderThread() {
  renderRequests();
  const t = currentThread(); $('welcome').hidden = Boolean(state.selectedId); $('conversation').hidden = !state.selectedId;
  $('thread-title').hidden = !state.selectedId;
  $('breadcrumb-project').hidden = Boolean(state.selectedId);
  if (!state.selectedId) { renderSession(); renderFiles(); renderControls(); return; }
  setText('thread-title',t ? threadName(t) : '正在读取会话…'); $('thread-title').title = $('thread-title').textContent; setText('thread-path',t?.cwd ? '目标机器 · ' + t.cwd : '');
  const own = controlled(), control = typeOf(state.detail?.controlState), busy = ['busy','occupied','active_writer','conflict'].includes(control);
  const badge = $('control-badge'); badge.className = 'control-badge' + (own ? ' controlled' : busy ? ' busy' : ''); badge.textContent = own ? '已取得控制' : busy ? '已被占用' : '查看模式';
  const note = $('control-note');
  note.className = 'control-note' + (busy ? ' error' : '');
  note.textContent = own ? '此会话由当前工作台控制。发送消息会在目标机器执行。' : busy ? '此会话仍在另一个入口中使用。请在原入口结束此会话的使用并等待释放，再重试。' : '当前只读取历史。点击“接管会话”后，可以继续原会话。';
  if (snapshotHistory()) note.textContent = (own ? '历史来自快照。实时状态由目标机器控制连接确认。' : '历史快照，运行状态需接管后确认。') + (busy ? ' ' + note.textContent : '');
  if(state.desktopMode){badge.textContent='桌面托管';note.textContent='消息由 Codex 桌面执行，定时任务与桌面共用。';}
  renderMessages(); renderSession(); renderFiles(); renderControls(); resizeInput();
}
function renderSession() {
  const queued=clear($('queued-inputs')), queue=state.detail?.queue;
  if(!queue)queued.append(el('p','subtle','接管会话后核对排队输入。'));
  else if(queue.error)queued.append(el('p','turn-error','排队输入未确认：'+queue.error));
  else if(!queue.data?.length)queued.append(el('p','subtle','没有排队输入。'));
  else {
    queued.append(el('p','subtle',`${queue.data.length}${queue.nextCursor?' 条以上':' 条'}输入等待执行。`));
    queue.data.forEach(item=>queued.append(el('p','queued-input',(item.input||[]).map(i=>i.text||`[${i.type}]`).join('\n'))));
  }
  const n = clear($('session-status')), t = currentThread();
  if (!t) { n.append(el('p','subtle','尚未选择会话。')); return; }
  const pairs = [['控制状态',controlled() ? '当前工作台' : '查看模式'],['执行状态',uncertainHistory() ? '状态未确认' : statusNames[typeOf(t.status)] || typeOf(t.status) || '状态未确认'],['当前模型',t.model || '目标机器未提供'],['当前思考档位',t.reasoningEffort ? effortNames[t.reasoningEffort] || t.reasoningEffort : '目标机器未提供'],['最近更新',dateTime(t.updatedAt,true)]];
  pairs.forEach(([k,v]) => { const d = el('div','session-detail'); d.append(el('span','',k),el('span','',v)); n.append(d); });
  n.append(el('p','session-id','会话 ID · ' + t.id));
  if (state.detail?.goal) { const g = state.detail.goal; n.append(el('div','goal-card','目标：' + (g.objective || g.prompt || g.description || pretty(g)))); }
}
function renderFiles() {
  const map = new Map(); turns().forEach(t => (t.items || []).forEach(item => { if (item.type === 'fileChange') (item.changes || []).forEach(c => map.set(c.path,c)); }));
  const n = clear($('file-changes')); setText('file-count',map.size);
  if (!map.size) { n.append(el('p','subtle',state.selectedId ? '当前已加载记录中暂无文件变化。' : '选择会话后显示文件变化。')); return; }
  [...map.values()].forEach(c => { const row = el('div','file-row'); row.append(icon('file'),el('span','file-path',c.path),el('span','file-kind',kindName(c.kind))); row.title = '目标机器文件：' + c.path; n.append(row); });
}
function renderDiagnostics() {
  const n = clear($('diagnostic-content')), s = state.status || {}, c = s.connection || {};
  if(s.recoveryFailures?.length){const d=el('div','diagnostic-entry');d.append(el('time','','历史会话恢复'),el('p','',recoveryMessage(s.recoveryFailures)));for(const failure of s.recoveryFailures)d.append(el('p','',failure.threadId+'：'+failure.message));n.append(d);}
  if (c.stage) { const d = el('div','diagnostic-entry'); d.append(el('time','','当前阶段'),el('p','',stages[c.stage] || c.stage)); n.append(d); }
  if (s.service?.pid) { const d = el('div','diagnostic-entry'); d.append(el('time','','目标机器服务'),el('p','','PID ' + s.service.pid + (s.service.running ? ' · 运行中' : ' · 未运行'))); n.append(d); }
  if(s.service?.protocolValidation){const v=s.service.protocolValidation,d=el('div','diagnostic-entry');d.append(el('time','','协议兼容性'),el('p','',`${v.version} · 已核验 ${v.methods} 项接口${v.cached?' · 使用已核验缓存':''}`));Object.entries(v.features||{}).filter(([,feature])=>!feature.supported).forEach(([,feature])=>d.append(el('p','',feature.reason)));n.append(d);}
  if(s.service?.installedVersion&&s.service.installedVersion!==s.service.version){const d=el('div','diagnostic-entry');d.append(el('time','','引擎更新'),el('p','',`已安装 ${s.service.installedVersion}，当前运行 ${s.service.version}。任务结束后释放并重新连接，即可使用新引擎。`));n.append(d);}
  const all = [...(s.errors || []),...state.errors].sort((a,b) => (timestamp(b.time)?.getTime() || 0) - (timestamp(a.time)?.getTime() || 0)).slice(0,10);
  all.forEach(e => { const d = el('div','diagnostic-entry error'); d.append(el('time','',dateTime(e.time) + (e.stage ? ' · ' + (stages[e.stage] || e.stage) : '')),el('p','',e.message || messageOf(e))); n.append(d); });
  if (!n.childNodes.length) n.append(el('p','subtle','暂无错误记录。连接后显示服务状态。'));
}
function renderRequests() {
  const list = requests().filter(r=>!questionDrafts.get(r).sent), signature = JSON.stringify([state.selectedId,list]);
  if (signature === state.requestSignature) { renderControls(); return; }
  state.requestSignature = signature;
  const saved = new Map([...document.querySelectorAll('.request-card')].map(card => [card.dataset.requestId, {fields:[...card.querySelectorAll('input,textarea')].map(f => ({name:f.name,value:f.value,checked:f.checked})),open:Boolean(card.querySelector('details[open]'))}]));
  const n = clear($('pending-requests')); const inline = clear($('conversation-requests'));
  $('request-count').hidden = !list.length; setText('request-count',list.length);
  if (!list.length) { const empty = el('div','inspector-empty'); empty.append(icon('check'),el('span','','暂无待处理请求')); n.append(empty); renderControls(); return; }
  list.forEach(r => {
    const method = r.method || '', p = r.params || {}, question = Array.isArray(p.questions) && p.questions.length > 0;
    const knownApproval = /requestApproval|approval|requestPermissions/i.test(method) || ['approval','commandApproval','fileApproval','command','file','permissions'].includes(r.kind);
    const card = el('div','request-card'); card.dataset.requestId = requestPath(r);
    const title = question ? '需要你的回答' : /commandExecution/i.test(method) ? '命令执行审批' : /fileChange/i.test(method) ? '文件修改审批' : /requestPermissions/i.test(method) ? '权限请求' : knownApproval ? '操作审批' : '工具请求待处理';
    if(!question)card.append(el('h4','',title));
    card.dataset.asyncQuestion=String(r.kind==='asyncQuestion');card.dataset.threadId=requestThread(r)||'';
    if (requestThread(r)) {
      const target = currentThread()?.id===requestThread(r)?currentThread():state.threads.find(t => t.id === requestThread(r));
      card.append(el('p','request-origin','会话：' + (target ? threadName(target) : requestThread(r))));
      if (requestThread(r) !== state.selectedId) { const open = el('button','text-button','查看此会话'); open.onclick = () => selectThread(requestThread(r)); card.append(open); }
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
    if(requestThread(r) === state.selectedId) { inline.append(card); n.append(el('p','subtle','当前会话的请求显示在输入框上方。')); } else n.append(card);
  });
  renderControls();
}

async function loadStatus() { applyStatus(await api('/api/status')); renderStatus(); renderRequests(); return state.status; }
let modelLoadPromise, projectLoadPromise, workspaceRefreshPromise;
async function loadModels(force = false) {
  if (modelLoadPromise) return modelLoadPromise;
  state.loadingModels = true; renderModels();
  modelLoadPromise = (async () => {
    const all = []; let cursor = null;
    do { const data = await api('/api/models' + (force ? '?refresh=1' : '') + (cursor ? (force ? '&' : '?') + 'cursor=' + encodeURIComponent(cursor) : '')); all.push(...(data.data || [])); cursor = data.nextCursor; } while (cursor);
    const seen = new Set(); state.models = all.filter(m => { const id = modelId(m); if (!id || m.hidden || seen.has(id)) return false; seen.add(id); return true; });
  })();
  try { await modelLoadPromise; }
  finally { modelLoadPromise = null; state.loadingModels = false; renderModels(); }
}
async function loadProjects() {
  if (projectLoadPromise) return projectLoadPromise;
  state.loadingProjects = true; renderProjects();
  projectLoadPromise = (async () => { const d = await api('/api/projects'); state.projects = d.data || []; if (state.projectId && !state.projects.some(p => p.id === state.projectId)) state.projectId = null; })();
  try { await projectLoadPromise; }
  finally { projectLoadPromise = null; state.loadingProjects = false; renderProjects(); }
}
const createdThreads = new Map();
let threadSearch = '';
async function loadThreads(append = false, reportFailure = false) {
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
  const q = new URLSearchParams(); if (state.search) q.set('search',state.search); if(state.selectedId)q.set('selectedId',state.selectedId);
  if (append && state.threadCursor) q.set('cursor',state.threadCursor);
  try {
    if(state.sidebarArchived)q.set('archived','true');
    const d = await api('/api/sidebar?' + q); if (seq !== state.listVersion) return;
    state.sidebar=d;state.projects=d.projects||[];if(d.selectedThread?.id===state.selectedId)state.selectedArchived=!!d.selectedThread.archived;
    state.threadListSource = d.historySource || null;
    for (const thread of d.data || []) createdThreads.delete(thread.id);
    const pending = state.sidebarArchived?[]:[...createdThreads.values()].filter(t => !state.search || threadName(t).includes(state.search));
    const all = append ? [...state.threads,...(d.data || [])] : [...pending,...(d.data || [])];
    const seen = new Set(); state.threads = all.filter(t => !seen.has(t.id) && seen.add(t.id)); state.threadCursor = d.nextCursor || null;
  } catch (e) { if (seq === state.listVersion) { state.threadPageError = true; recordError(e,'threads'); toast(messageOf(e),true); } if (reportFailure) throw e; }
  finally { if (seq === state.listVersion) { state.loadingThreads = false; renderThreads(); renderControls(); if (!state.threadPageError) requestAnimationFrame(loadVisibleThreads); } }
}
function loadVisibleThreads() {
  const list = $('project-list');
  if (list.clientHeight > 0 && list.scrollHeight - list.scrollTop - list.clientHeight < 120) loadThreads(true);
}
let cacheSaveTimer,cacheWritePending=false,lastCacheStamp='';
function saveDetailSoon(){
  if(cacheSaveTimer||cacheWritePending)return;
  cacheSaveTimer=setTimeout(async()=>{
    cacheSaveTimer=null;
    const detail=state.detail,id=state.selectedId;
    if(!detail||detail.recovering||detail.outputPreview)return;
    // Large snapshots use structured cloning. Avoid copying tens of MB every
    // SSE refresh, and never queue multiple writes behind a slow browser.
    const stamp=JSON.stringify([id,detail.thread,detail.turns],(key,value)=>['aggregatedOutput','outputCompressed'].includes(key)?undefined:value);
    if(stamp===lastCacheStamp)return;
    cacheWritePending=true;
    try{await writeDetailCache(targetHost,id,detail);lastCacheStamp=stamp;}
    finally{cacheWritePending=false;}
  },5000);
}
async function restoreDetail(id,seq){
  const version=state.detailVersion;
  const cached=await readDetailCache(targetHost,id);
  if(!cached||id!==state.selectedId||seq!==state.selectionVersion||version!==state.detailVersion||state.detail)return;
  state.loadingDetail=false;applyDetail(cached,true);
}
function applyDetail(data, resetModels = false) {
  if(data.goalError&&state.detail?.thread?.id===data.thread?.id)data.goal=state.detail.goal;
  state.detail = {...data, turns:data.turns || data.thread?.turns || []};
  state.historyCursor = data.nextCursor || data.historyCursor || null; state.historyError = '';
  if (resetModels) renderModels(true); renderThread(); renderRequests(); if(!data.recovering)saveDetailSoon();
}
async function selectThread(id,options={}) {
  if(state.busy.has('create')){toast('正在创建会话，请稍候。');return;}
  const url=new URL(location.href);url.searchParams.delete('thread');history.replaceState(null,'',url);
  closeNewChat();
  automations?.close();state.desktopMode=Boolean(options.desktop||id===automations?.threadId);
  document.querySelector('.main-panel').classList.toggle('desktop-chat',state.desktopMode);
  toggleInspector(false);
  $('messages').style.paddingBottom = '';
  if (inputId()) state.drafts.set(inputId(),$('message-input').value);
  const seq = ++state.selectionVersion; state.selectedId = id; state.detail = null; state.historyCursor = null; state.loadedOlderHistory = false; state.loadingDetail = true; state.historyError = ''; saveView();
  $('message-input').value = state.drafts.get(id) || ''; resizeInput(); renderThread(); renderThreads(); if (compactLayout()) toggleSidebar(false, false);
  await restoreDetail(id,seq);
  if(seq!==state.selectionVersion)return;
  try { await refreshSelected(); if (seq !== state.selectionVersion) return; scrollFollow?.schedule(); }
  catch (e) { if (seq !== state.selectionVersion) return; state.loadingDetail = false; state.historyError = messageOf(e); recordError(e,'thread'); renderThread(); }
}
async function readSelectedDetail(id,isCurrent){
  if(state.desktopMode){
    const data=await api('/api/automations/session');if(data.thread.id!==id)throw new Error('管理会话已更换，请从定时任务入口重新打开。');
    const pending=desktopSends[id];
    if(pending&&data.desktop?.receipts?.[pending.messageId]?.status==='accepted'){
      if(state.drafts.get(id)===pending.text){state.drafts.set(id,'');if(isCurrent()&&$('message-input').value===pending.text){$('message-input').value='';resizeInput();}}
      delete desktopSends[id];saveDesktopSends();
    }
    return data;
  }
  const cold=!state.detail,started=performance.now();let firstMs=null;
  if(!state.detail){
    const preview=await api('/api/threads/'+encodeURIComponent(id)+'?preview=1');
    if(!isCurrent())return preview;
    state.loadingDetail=false;applyDetail(preview,true);firstMs=performance.now()-started;
  }
  const bases=outputBases(turns());
  const versions=Object.fromEntries([...bases].slice(-50).map(([id,b])=>[id,b.token]));
  const encoding=(typeof DecompressionStream==='function'?'?outputEncoding=gzip-base64':'?outputEncoding=plain')+(cold?'&fast=1':'');
  const response=await api('/api/threads/' + encodeURIComponent(id)+encoding,{headers:{'X-Output-Versions':JSON.stringify(versions)}}),received=performance.now();
  const result=hydrateOutputs(await decodeOutputs(response),bases);
  if(cold&&isCurrent())document.body.dataset.logRecovery=JSON.stringify({host:targetHost,id,firstMs:Math.round(firstMs),networkMs:Math.round(received-started-firstMs),decodeMs:Math.round(performance.now()-received),completeMs:Math.round(performance.now()-started)});
  if(cold)setTimeout(()=>{if(isCurrent())scheduleDetailRefresh();},1000);
  return result;
}
const detailReads = new Map();
async function refreshSelected() {
  if (automations?.opened||newChatOpen||!state.selectedId) return;
  const id = state.selectedId, seq = state.selectionVersion, version = state.detailVersion;
  const key=JSON.stringify([id,seq,version]);
  const isCurrent=()=>!newChatOpen&&id===state.selectedId&&seq===state.selectionVersion&&version===state.detailVersion;
  if(detailReads.has(key)) return detailReads.get(key);
  const read=(async()=>{
  if(!state.detail)await restoreDetail(id,seq);
  if(!isCurrent())return;
  const resetModels=!state.detail||state.loadingDetail;
  const data = await readSelectedDetail(id,isCurrent); if (!isCurrent()) return;
  data.turns = mergeLiveTurns(turns(), data.turns || data.thread?.turns || []);
  if (state.loadedOlderHistory) data.nextCursor = state.historyCursor;
  state.loadingDetail=false;
  applyDetail(data,resetModels);
  })().catch(error=>{if(isCurrent())throw error;});
  detailReads.set(key,read);
  try { await read; }
  finally { if(detailReads.get(key)===read)detailReads.delete(key); }
}
async function refreshWorkspace(forceModels = false) {
  if (workspaceRefreshPromise) return workspaceRefreshPromise;
  workspaceRefreshPromise = showRefresh('工作区', async () => {
    await loadStatus(); if (!connected()) throw new Error('目标机器未连接。请先连接，再刷新。');
    const results = await Promise.allSettled([loadModels(forceModels),loadProjects(),loadThreads(false,true),refreshSelected()]);
    const labels = ['模型列表','项目列表','会话列表','当前会话'];
    const failures = results.flatMap((r,i) => r.status === 'rejected' ? [labels[i] + '：' + (r.reason?.message || String(r.reason))] : []);
    if (failures.length) throw new Error(failures.join('；'));
  });
  try { await workspaceRefreshPromise; }
  finally { workspaceRefreshPromise = null; }
}
let autoRefreshTimer = null;
async function refreshCatalogs() {
  if (!usable() || state.refreshing || modelLoadPromise || projectLoadPromise) return;
  await showRefresh('项目和模型列表', async () => {
    const results = await Promise.allSettled([loadProjects(),loadModels(true)]);
    const labels = ['项目列表','模型列表'];
    const failures = results.flatMap((r,i) => r.status === 'rejected' ? [labels[i] + '：' + (r.reason?.message || String(r.reason))] : []);
    if (failures.length) throw new Error(failures.join('；'));
  });
}
function setAutoRefresh(enabled) {
  clearInterval(autoRefreshTimer); autoRefreshTimer = null;
  $('auto-refresh').checked = enabled;
  try { localStorage.setItem('rcm.autoRefresh.' + targetHost, String(enabled)); } catch {}
  if (enabled) autoRefreshTimer = setInterval(() => {
    refreshCatalogs().catch(error => recordError(error,'refresh'));
  },30000);
}
let taskNotificationsEnabled = false;

function renderTaskNotifications() {
  const {supported,message} = notificationSupport();
  $('task-notifications').disabled = !supported || notificationPending;
  $('task-notifications').checked = taskNotificationsEnabled && supported && Notification.permission === 'granted';
  $('test-notification').disabled = !$('task-notifications').checked;
  setText('notification-status', !supported ? message : Notification.permission === 'denied' ? '通知已被阻止。请在浏览器网站设置中允许通知。' : $('task-notifications').checked ? '已开启：每次执行完成、失败、停止或需要你处理时都会通知，正在查看会话时也会通知；多个页面只提醒一次。页面关闭或被系统暂停期间不能实时通知，重新打开并恢复连接后补发。' : '通知未开启');
}
let notificationPending = false;
let notificationRegistration;
async function setTaskNotifications(enabled) {
  if(notificationPending)return;
  const host=targetHost;
  notificationPending=true;
  $('task-notifications').disabled=true;
  setText('notification-status',enabled?'正在申请通知权限…':'正在关闭通知…');
  let failure;
  try {
    if(enabled && !notificationSupport().supported)throw Error(notificationSupport().message);
    // Request synchronously from the user gesture before awaiting worker setup.
    if(enabled && Notification.permission==='default')await Notification.requestPermission();
    const allowed=enabled && Notification.permission==='granted';
    if(allowed && notificationSupport().worker)notificationRegistration=await prepareNotificationWorker();
    if(host!==targetHost)return;
    taskNotificationsEnabled=allowed;
    localStorage.setItem('rcm.taskNotifications.'+host,String(allowed));
  } catch(error){failure=error.message;recordError(error,'notifications');}
  finally {notificationPending=false;if(host===targetHost){renderTaskNotifications();if(failure)setText('notification-status','通知未开启：'+failure+'。请重试。');}}
}
const liveNotifications = new Set();
function notificationDiagnostic(message) {
  let list = $('notification-history');
  if (!list) { list = el('div','notification-history'); list.id = 'notification-history'; list.setAttribute('role','log'); document.querySelector('.notification-controls').append(list); }
  list.prepend(el('p','',dateTime(new Date()) + ' · ' + message));
  while (list.children.length > 8) list.lastElementChild.remove();
}
function openNotificationThread({host,threadId}) {
  if(host!==targetHost){
    if(!connectionIds.includes(host))return;
    flushDrafts();
    const url=new URL(location.href);url.searchParams.set('host',host);url.searchParams.set('thread',threadId);location.assign(url);return;
  }
  selectThread(threadId);
}
async function sendTaskNotification(title, body, tag, threadId, host=targetHost) {
  if(notificationSupport().worker){
    try {
      notificationRegistration ||= await prepareNotificationWorker();
      return await submitWorkerNotification(notificationRegistration,title,{body,tag,data:{host,threadId}},{submitted:()=>notificationDiagnostic(title+'：已提交给系统；是否弹出取决于系统通知设置'),failed:message=>notificationDiagnostic(title+'：'+message)});
    } catch(error){notificationDiagnostic(title+'：'+error.message);return false;}
  }
  notificationDiagnostic(title + '：正在提交给浏览器');
  let notification;
  return submitNotification(()=>{
    notification = new Notification(title,{body,tag});
    liveNotifications.add(notification);
    notification.onclose = () => { liveNotifications.delete(notification); notificationDiagnostic(title + '：通知已关闭'); };
    notification.onclick = () => { window.focus(); notification.close(); if(threadId)openNotificationThread({host,threadId}); };
    return notification;
  },{
    shown:()=>notificationDiagnostic(title + '：浏览器报告已显示；若系统未弹出，请检查系统的浏览器通知开关'),
    failed:message=>{liveNotifications.delete(notification);notificationDiagnostic(title + '：' + message);setText('notification-status',message+'。请检查浏览器和系统的通知设置。');},
  });
}
async function notifyTaskEvent(method, params, replayKey) {
  if (!taskNotificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const host=targetHost;
  const threadId = params.threadId || params.thread?.id || (params.request || params).params?.threadId;
  const thread = state.threads.find(t => t.id === threadId) || (state.selectedId === threadId ? currentThread() : null);
  const notice = taskNotice(method, params, {host, known:!!thread || state.status?.controlledThreads?.includes(threadId) || state.status?.subscribedThreads?.includes(threadId)});
  if (!notice) return;
  const body=(state.status?.host?.alias || host) + ' · ' + (thread ? threadName(thread) : '会话 ' + threadId.slice(0,8));
  try {
    const delivered = await navigator.locks.request('rcm.task-notifications', async () => {
      if (host!==targetHost || localStorage.getItem('rcm.taskNotifications.' + host) !== 'true') return false;
      return deliverNotice(localStorage,notice.key,()=>sendTaskNotification('Codex · ' + notice.label,body,notice.key,threadId,host));
    });
    if(delivered && host===targetHost)await api('/api/notices/ack',{method:'POST',body:{key:replayKey || notice.key}});
    return delivered;
  } catch (error) { notificationDiagnostic('通知处理失败：'+error.message);recordError(error,'notifications'); }
}

async function connectRemote() {
  const success = await action('connect',async () => {
    const data = await api('/api/connect',{method:'POST',body:{},timeout:150000});
    if (data.connection) { applyStatus(data); renderStatus(); } else await loadStatus();
    if(connected())toast('已连接目标机器。正在同步项目与会话。');return true;
  });
  if (success) { renderStatus(); if(connected())refreshWorkspace().catch(e => recordError(e,'sync')); }
}
async function disconnectRemote() {
  return action('disconnect',async () => { await api('/api/disconnect',{method:'POST'}); await loadStatus(); if (state.detail) state.detail.controlled = false; renderThread(); toast('已断开本机连接。目标机器任务的状态请在重连后核对。'); });
}
async function takeoverThread() {
  if (!state.selectedId || !usable()) return;
  const id = state.selectedId;
  await action('takeover',async () => {
    try { const d = await api('/api/threads/' + encodeURIComponent(id) + '/takeover',{method:'POST'}); if (id === state.selectedId) applyDetail(d,true); await loadStatus(); toast('已取得原会话的控制权。'); }
    catch (e) {
      if (e.code==='WRITER_CONFLICT'&&id === state.selectedId && state.detail) { state.detail.controlled = false; state.detail.controlState = 'conflict'; renderThread(); }
      recordError(e,'takeover'); toast(messageOf(e),true,17000);
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
async function releaseService() {
  if(!confirm('将停止目标机器的专用服务，影响所有入口。请确认任务已结束，且其他入口已断开。停止后需在目标机执行 maintenance resume 才能重连。'))return;
  await action('release',async () => {
    try { await api('/api/service/release',{method:'POST',body:{allEntrancesDisconnected:true}}); if (state.detail) state.detail.controlled = false; await loadStatus(); renderThread(); toast('已释放专用服务。可以在目标机器打开 Codex 桌面应用。',false,10000); }
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
    renderRequests();if(returnFocus&&state.selectedId===requestThread(r))$('message-input').focus();await loadStatus(); toast('已提交处理结果。');
  });
}
function updateNewProjects(projectRoot) {
  const preferred=(typeof projectRoot==='string'?projectRoot:null)||newDraft.cwd||state.projects.find(p=>p.id===state.projectId)?.roots?.[0]||currentThread()?.cwd;
  const select=clear($('new-cwd'));
  const options=state.projects.flatMap(p=>(p.roots||[]).map(root=>({root,name:p.name||baseName(root)})));
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
  $('new-composer-slot').append(document.querySelector('.composer-region'));
  $('message-input').value=state.drafts.get(newDraftId)||'';
  $('new-chat-error').hidden=true;toggleInspector(false);if(compactLayout())toggleSidebar(false,false);
  renderModels();renderControls();resizeInput();mobileUI?.syncDrawers();$('message-input').focus();
}
async function createThreadFromDraft(){
  if(state.busy.has('create')||newDraft.phase!=='editing')return;
  const cwd=newDraft.cwd,model=state.model,effort=state.effort,text=$('message-input').value;
  if(!cwd||(!text.trim()&&!attachments.has())||attachments.pending())return;
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
async function sendMessage(e) {
  e?.preventDefault();
  if ($('send-message').disabled) return;
  if(newChatOpen){await createThreadFromDraft();return;}
  if(state.desktopMode){await sendDesktopMessage();return;}
  const text = $('message-input').value.trim(), id = state.selectedId;
  if ((!text&&!attachments?.has()) || attachments?.pending() || !id || !usable() || !controlled() || state.busy.has('message')) return;
  const active = running(), selection = state.selectionVersion;
  const sent = state.drafts.capture(id,$('message-input').value), pictures=attachments.capture();
  await action('message',async () => {
    const images=pictures.items.map(i=>({url:i.url}));
    const payload = active ? {text,images} : {text,images,model:state.model,effort:state.effort,...composer.options()};
    const d = await api('/api/threads/' + encodeURIComponent(id) + (active ? '/steer' : '/message'),{method:'POST',body:payload});
    attachments.acknowledge(pictures);
    const cleared = state.drafts.acknowledge(sent);
    if (id === state.selectedId && cleared && $('message-input').value === sent.text) { $('message-input').value = ''; resizeInput(); }
    if (id === state.selectedId && selection === state.selectionVersion) { if (d.turn) { upsertTurn(d.turn); const t = ensureTurn(d.turn.id); const content=[...(text?[{type:'text',text}]:[]),...images.map(i=>({type:'image',url:i.url}))]; if (!t.items.some(item => item.type === 'userMessage' && userContentKey(item.content) === userContentKey(content))) t.items.unshift({id:'accepted-'+d.turn.id,type:'userMessage',content,localAccepted:true}); } renderThread(); }
    if (active) toast('补充要求已发送到当前轮次。');
    try { if (id === state.selectedId && selection === state.selectionVersion) await refreshSelected(); } catch (err) { recordError(err,'thread'); }
  });
}
async function sendDesktopMessage(){
  const id=state.selectedId,selection=state.selectionVersion,text=$('message-input').value.trim();
  if(!text||state.busy.has('message')||!state.detail?.desktop?.canSend)return;
  if(desktopSends[id])return;
  const sent=state.drafts.capture(id,$('message-input').value),messageId=crypto.randomUUID();
  desktopSends[id]={messageId,text:sent.text};saveDesktopSends();
  await action('message',async()=>{
    try{
      await api('/api/automations/message',{method:'POST',body:{threadId:id,messageId,text}});
      delete desktopSends[id];saveDesktopSends();
      const cleared=state.drafts.acknowledge(sent);
      if(id===state.selectedId&&selection===state.selectionVersion&&cleared&&$('message-input').value===sent.text){$('message-input').value='';resizeInput();}
    }finally{
      if(id===state.selectedId&&selection===state.selectionVersion)await refreshSelected();
    }
  });
}
async function interruptThread() {
  if(state.desktopMode){
    const threadId=state.selectedId,turnId=[...turns()].reverse().find(t=>['inProgress','in_progress','running'].includes(typeOf(t.status)))?.id;
    if(!turnId)return;
    await action('interrupt',async()=>{await api('/api/automations/interrupt',{method:'POST',body:{threadId,turnId}});toast('停止请求已交给桌面，等待状态确认。');if(threadId===state.selectedId)await refreshSelected();});return;
  }
  if (!state.selectedId || !controlled()) return;
  const id = state.selectedId;
  await action('interrupt',async () => { await api('/api/threads/' + encodeURIComponent(id) + '/interrupt',{method:'POST'}); toast('已请求停止。等待目标机器确认。'); await refreshSelected(); });
}
async function moreHistory() {
  if (!state.historyCursor || !state.selectedId || !state.detail || state.loadingDetail || state.busy.has('history')) return;
  const id = state.selectedId, version = state.selectionVersion;
  $('messages-scroller').setAttribute('aria-busy','true');
  try { await action('history',async () => {
    let d;
    try{d=await api((state.desktopMode?'/api/automations/history':'/api/threads/'+encodeURIComponent(id)+'/history')+'?cursor='+encodeURIComponent(state.historyCursor)+(state.desktopMode?'&threadId='+encodeURIComponent(id):''));}
    catch(error){if(error.code==='HISTORY_CURSOR_CHANGED')throw new Error('历史记录已更新。请刷新会话后再向上滚动。');throw error;}
    if (id !== state.selectedId || version !== state.selectionVersion) return;
    const old = new Map(turns().map(t => [t.id,t])); const all = [...[...(d.data || [])].reverse(),...turns()]; const seen = new Set(); state.detail.turns = all.filter(t => !seen.has(t.id) && seen.add(t.id)).map(t => old.get(t.id) || t);
    state.historyCursor = d.nextCursor || null; state.loadedOlderHistory = true; if (d.historySource === 'snapshot') state.detail.historySource = 'snapshot'; renderThread();
  }); } finally { $('messages-scroller').setAttribute('aria-busy','false'); }
}
function resizeInput() {
  const t = $('message-input');
  if (!t.clientWidth) return;
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
function scheduleStreamRender() {
  if (state.streamRender) return; state.streamRender = true;
  setTimeout(() => { state.streamRender = false; renderRequests(); renderMessages(); renderSession(); renderFiles(); renderControls(); },80);
}
let detailRefreshTimer, listRefreshTimer;
function scheduleDetailRefresh() { if(detailRefreshTimer)return; detailRefreshTimer = setTimeout(() => { detailRefreshTimer=null; if (usable() && state.selectedId) refreshSelected().catch(e => recordError(e,'thread')); },650); }
function scheduleListRefresh() { clearTimeout(listRefreshTimer); listRefreshTimer = setTimeout(() => { if (usable()) loadThreads(); },1000); }
function handleEvent(event) {
  let data; try { data = JSON.parse(event.data); } catch { return; }
  const method = data.method || event.type, p = data.params || {};
  if (method==='manager/sidebarChanged'||/thread\/(section|readState)\//.test(method)||method.startsWith('threadSection/'))scheduleListRefresh();
  if(method==='manager/taskNotice'){
    notifyTaskEvent(p.event.method,p.event.params,p.key);return;
  }
  notifyTaskEvent(method,p);
  if (method === 'manager/status') {
    const was = connected(); applyStatus(p.status || p); renderStatus(); renderRequests(); renderThread();
    for(const request of state.status.pendingRequests||[])notifyTaskEvent('manager/request',request);
    if (!was && connected()) refreshWorkspace().catch(e => recordError(e,'sync'));
    return;
  }
  if (method === 'manager/error') { recordError(p.message || p.error || p,p.stage || 'remote'); if(notifyManagerError(p))toast(messageOf(p.message || p.error || p),true,11000); return; }
  if (method === 'manager/request') {
    const r = p.request || p; if (r.id != null) state.localRequests = [...state.localRequests.filter(x => requestKey(x) !== requestKey(r)),r];
    renderRequests(); if (requests().some(r=>requestThread(r)!==state.selectedId)) { $('pending-requests').closest('details').open = true; }
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
    if (!item) { item = {id:p.itemId,type:method.includes('/plan/') ? 'plan' : 'agentMessage',text:''}; t.items.push(item); } item.text = (item.text || '') + (p.delta || ''); scheduleStreamRender(); return;
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
    const i = p.summaryIndex || 0; item.summary[i] = (item.summary[i] || '') + (p.delta || ''); scheduleStreamRender(); return;
  }
  if (method === 'error') {
    const t = ensureTurn(p.turnId || turns().at(-1)?.id); if (t) t.error = p.error || p; recordError(p.error || p,'remote'); scheduleStreamRender(); return;
  }
  if (/updated|completed|changed/.test(method)) scheduleDetailRefresh();
}
function setupEvents() {
  const es = new EventSource(targetUrl('/api/events')); state.eventSource = es;
  es.onopen = () => {
    const restored = !state.transport; state.transport = true; renderStatus();
    if (restored) resumeWorkspace().catch(e => { recordError(e,'sync'); renderStatus(); });
  };
  es.onmessage = handleEvent;
  ['manager/status','manager/error','manager/request','manager/requestResolved'].forEach(name => es.addEventListener(name,handleEvent));
  es.onerror = () => { state.transport = false; renderStatus(); };
}
function saveLayout(key, value) { try { localStorage.setItem('rcm.layout.'+key, JSON.stringify(value)); } catch {} }
function readLayout(key, fallback) { try { const raw = localStorage.getItem('rcm.layout.'+key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } }
function setupResizableLayout() {
  const shell = $('app-shell'), panes = $('sidebar-sections');
  const widthHandle = $('sidebar-resizer');
  const savedWidth = readLayout('sidebarWidth',266), savedRatio = readLayout('threadsRatio',0.3);
  let width = typeof savedWidth === 'number' && Number.isFinite(savedWidth) ? savedWidth : 266;
  let ratio = typeof savedRatio === 'number' && Number.isFinite(savedRatio) ? savedRatio : 0.3;
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  function apply() {
    const inspectorWidth = window.innerWidth > 1050 && !shell.classList.contains('inspector-hidden') ? $('inspector').getBoundingClientRect().width : 0;
    const maxWidth = Math.max(220,Math.min(520,window.innerWidth - inspectorWidth - 380));
    const actualWidth = clamp(width,220,maxWidth);
    shell.style.setProperty('--sidebar',actualWidth+'px');
    widthHandle.setAttribute('aria-valuemin','220'); widthHandle.setAttribute('aria-valuemax',String(Math.round(maxWidth)));
    widthHandle.setAttribute('aria-valuenow',String(Math.round(actualWidth)));

  }
  function bind(handle,vertical) {
    let drag = null;
    handle.addEventListener('pointerdown',event => {
      if (event.button !== 0) return;
      event.preventDefault(); handle.setPointerCapture(event.pointerId);
      drag = {id:event.pointerId,x:event.clientX,y:event.clientY,width:$('sidebar').getBoundingClientRect().width,height:0};
      document.body.classList.add('resizing-layout'); document.body.classList.toggle('resizing-sections',vertical);
    });
    handle.addEventListener('pointermove',event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (vertical) ratio = clamp((drag.height + drag.y - event.clientY) / Math.max(1,panes.clientHeight - 12),0,1);
      else width = clamp(drag.width + event.clientX - drag.x,220,Number(widthHandle.getAttribute('aria-valuemax')));
      apply();
    });
    const finish = () => {
      if (!drag) return;
      drag = null; document.body.classList.remove('resizing-layout','resizing-sections');
      saveLayout('sidebarWidth',width); saveLayout('threadsRatio',ratio);
    };
    handle.addEventListener('pointerup',finish); handle.addEventListener('pointercancel',finish); handle.addEventListener('lostpointercapture',finish);
    handle.addEventListener('keydown',event => {
      const keys = vertical ? ['ArrowUp','ArrowDown'] : ['ArrowLeft','ArrowRight'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (vertical) ratio = clamp(ratio + (event.key === 'ArrowUp' ? 0.05 : -0.05),0,1);
      else width = clamp(width + (event.key === 'ArrowRight' ? 16 : -16),220,Number(widthHandle.getAttribute('aria-valuemax')));
      apply(); saveLayout('sidebarWidth',width); saveLayout('threadsRatio',ratio);
    });
    handle.addEventListener('dblclick',() => { if (vertical) ratio = 0.3; else width = 266; apply(); saveLayout('sidebarWidth',width); saveLayout('threadsRatio',ratio); });
  }
  bind(widthHandle,false);
  new ResizeObserver(apply).observe(panes);
  new MutationObserver(apply).observe(shell,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',apply); apply();
}
function toggleSidebar(open, persist = true) {
  const shell = $('app-shell'); const mobile = compactLayout();
  const show = open ?? (mobile ? !shell.classList.contains('sidebar-open') : shell.classList.contains('sidebar-hidden'));
  shell.classList.toggle('sidebar-open', mobile && show);
  shell.classList.toggle('sidebar-hidden', !mobile && !show);
  $('open-sidebar').setAttribute('aria-expanded', String(show));
  if (mobile && show) toggleInspector(false);
  if (persist && !mobile) saveLayout('sidebar', show);
}
function toggleInspector(open) {
  const shell = $('app-shell'); const show = open ?? shell.classList.contains('inspector-hidden');
  shell.classList.toggle('inspector-hidden', !show); $('toggle-inspector').setAttribute('aria-expanded',String(show));
  if (show && compactLayout()) toggleSidebar(false, false);
}
function wireEvents() {
  automations=installAutomations({api,onOpen:()=>{flushDrafts();closeNewChat();state.selectionVersion++;toggleInspector(false);if(compactLayout())toggleSidebar(false,false);queueMicrotask(renderControls);},
    openSession:async(id,prompt)=>{await selectThread(id,{desktop:true});if(prompt&&state.selectedId===id){const previous=$('message-input').value;if(previous&&previous!==prompt){toast('管理会话已有未发送草稿，请先处理草稿，再返回定时任务继续。');$('message-input').focus();return;}$('message-input').value=prompt;state.drafts.set(id,$('message-input').value);resizeInput();renderControls();}$('message-input').focus();},
    openThread:id=>selectThread(id),notify:toast});
  const scheduleNav=el('button','automations-nav');scheduleNav.id='open-automations';scheduleNav.type='button';scheduleNav.textContent='定时任务';scheduleNav.onclick=()=>automations.open();document.querySelector('.inspector-nav').append(scheduleNav);
  const review=el('button','text-button','已核对会话记录，解锁发送');review.id='desktop-review';review.type='button';review.hidden=true;
  review.onclick=()=>action('desktop-review',async()=>{const threadId=state.selectedId;await api('/api/automations/acknowledge',{method:'POST',body:{threadId,messageId:state.detail?.desktop?.unconfirmed||desktopSends[threadId]?.messageId}});delete desktopSends[threadId];saveDesktopSends();await refreshSelected();});
  $('composer-availability').after(review);
  document.querySelector('.main-panel').classList.toggle('desktop-chat',state.desktopMode);
  setInterval(()=>{if(automations.opened&&!document.hidden)void automations.refresh();},15000);

  scrollFollow=installScrollFollow($('messages-scroller'),$('messages'));
  attachments=installAttachments({host:targetHost,context:()=>({id:inputId(),ready:inputReady(),busy:state.busy.has('message')||state.busy.has('create')}),changed:renderControls,notify:toast});
  handoffControls??=createHandoffControls({endUse:endThreadUse});
  composer=installComposer({host:targetHost,api,context:()=>({id:inputId(),cwd:newChatOpen?newDraft.cwd:currentThread()?.cwd,ready:inputReady(),busy:state.busy.size>0,active:!newChatOpen&&running(),draft:newChatOpen,goal:newChatOpen?null:state.detail?.goal,goalError:newChatOpen?null:state.detail?.goalError}),refresh:refreshSelected,notify:toast});
  const settings = $('composer-settings');
  document.addEventListener('click',event => { if (!settings.contains(event.target)) settings.open = false; });
  settings.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); settings.open = false; settings.querySelector('summary').focus(); } });
  setupResizableLayout();
  try { taskNotificationsEnabled = localStorage.getItem('rcm.taskNotifications.' + targetHost) === 'true'; } catch {}
  renderTaskNotifications();
  $('task-notifications').onchange = event => setTaskNotifications(event.target.checked);
  $('test-notification').onclick = () => { if (taskNotificationsEnabled && Notification.permission === 'granted') sendTaskNotification('Codex · 测试通知','浏览器通知已接入。请检查设备通知中心。','codex-test'); };
  window.addEventListener('focus',renderTaskNotifications);

  let autoRefresh = false;
  try { autoRefresh = localStorage.getItem('rcm.autoRefresh.' + targetHost) === 'true'; } catch {}
  setAutoRefresh(autoRefresh);
  $('auto-refresh').onchange = event => setAutoRefresh(event.target.checked);
  window.addEventListener('pagehide', () => { flushDrafts(); clearInterval(autoRefreshTimer); autoRefreshTimer = null; });
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
  $('connect-button').onclick = () => connected()||connectionPending() ? disconnectRemote() : connectRemote();
  $('welcome-connect').onclick = () => connected() ? openNewDialog() : connectRemote();
  $('new-thread').onclick = openNewDialog; $('takeover').onclick = takeoverThread; $('release-service').onclick = releaseService;
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
  $('message-form').onsubmit = sendMessage; $('interrupt').onclick = interruptThread;
  $('message-input').oninput = () => { if (inputId() && !draftWritesSuspended) state.drafts.set(inputId(),$('message-input').value); resizeInput(); renderControls(); };
  let composing = false, compositionEnded = -Infinity;
  $('message-input').addEventListener('compositionstart',() => { composing = true; });
  $('message-input').addEventListener('compositionend',() => { composing = false; compositionEnded = performance.now(); });
  $('message-input').onkeydown = e => { if (shouldSendOnEnter(e,{touch:touchInput(),composing,compositionEnded})) { e.preventDefault(); if (!$('send-message').disabled) sendMessage(); } };
  $('model-select').onchange = e => { state.model = e.target.value; state.effort = defaultEffort(state.model); fillEfforts($('effort-select'),state.model,state.effort); renderControls(); };
  $('effort-select').onchange = e => { state.effort = e.target.value; renderControls(); };
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
  window.addEventListener('offline',() => {  flushDrafts(); state.transport=false; renderStatus(); renderControls(); });
}
async function init() {
  setInterval(()=>{renderControls();if(!sidebar.menu&&!sidebar.dialog&&!sidebar.drag)renderThreads();},5000);
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
  const category=group=>group.id==='mobile-access'?'mobile':group.id==='browser-backup'||group.classList.contains('connection-section')||group.id==='diagnostics'||group.querySelector('#task-notifications')?'settings':'session';
  const views=[['session','会话'],['mobile','手机访问'],['settings','设置']];
  function showInspectorView(view){
    groups.forEach(group=>{group.hidden=category(group)!==view;if(!group.hidden&&group.id!=='diagnostics')group.open=true;});
    navigation.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
    inspector.scrollTop = 0;
  }
  for(const [view,title] of views){const button=el('button','',title);button.type='button';button.dataset.view=view;button.onclick=()=>showInspectorView(view);navigation.append(button);}
  showInspectorView('session');
  installMobile(api).catch(e=>{$('mobile-access-body').textContent=messageOf(e);});
  wireEvents(); renderStatus(); renderThread(); renderThreads(); setupEvents();
  notificationNavigationReady=true;
  const linkedThread=new URL(location.href).searchParams.get('thread');
  const notification=pendingNotification || (linkedThread && requestedHost===targetHost?{host:targetHost,threadId:linkedThread}:null);
  pendingNotification=null;
  if(notification)openNotificationThread(notification);
  else if(state.selectedId)restoreDetail(state.selectedId,state.selectionVersion);
  try { const c = await api('/api/csrf'); state.csrf = c.token; await loadStatus(); if (connected()) await refreshWorkspace(); else if (!connectionPending()) await connectRemote(); }
  catch (e) { recordError(e,'init'); const n = $('connection-banner'); n.hidden = false; n.className = 'connection-banner error'; n.textContent = messageOf(e); }
}
if(state.selectedId)$('message-input').value=state.drafts.get(state.selectedId)||'';
init();

$('connection-select').value=targetHost;
$('connection-select').onchange=()=>{if(state.busy.has('create'))return;rememberHost($('connection-select').value);if(inputId())state.drafts.set(inputId(),$('message-input').value);try{sessionStorage.setItem('rcm.drafts.'+targetHost,JSON.stringify([...state.drafts]));}catch{}const url=new URL(location.href);url.searchParams.set('host',$('connection-select').value);url.searchParams.delete('thread');location.assign(url);};

const clearRecovery=el('button','text-button','清除日志缓存并重新加载');
clearRecovery.type='button';
clearRecovery.onclick=async()=>{flushDrafts();clearRecovery.disabled=true;clearTimeout(cacheSaveTimer);try{await clearDetailCache();location.reload();}catch(e){clearRecovery.disabled=false;toast('无法清除日志缓存：'+messageOf(e),true);}};
$('diagnostics').append(clearRecovery);
