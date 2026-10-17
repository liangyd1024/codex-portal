import {installBrowserBackup} from './browser-backup.js';
import {installVoice} from './voice.js';
import {installMobile} from './mobile.js';
let voice;
import {readDetailCache, writeDetailCache, clearDetailCache, outputBases, hydrateOutputs, decodeOutputs} from './detail-cache.js';
import {outputWindow, OUTPUT_WINDOW_SIZE} from './output-window.js';
import {selectConnectionStatus, mergeLiveTurns, taskNotice, claimNotice} from './connection-state.js';
function savedHost() { try { return localStorage.getItem('rcm.connection'); } catch { return null; } }
const requestedHost = new URL(location.href).searchParams.get('host');
const response=await fetch('/api/connections');
if(!response.ok)throw new Error('无法读取连接配置。');
const connectionConfig=await response.json();
const connectionIds=connectionConfig.data.map(c=>c.id);
const targetHost=connectionIds.includes(requestedHost)?requestedHost:connectionIds.includes(savedHost())?savedHost():connectionConfig.defaultConnection;
document.getElementById('connection-select').replaceChildren(...connectionConfig.data.map(c=>new Option(c.host.alias,c.id)));
function savedView() { try { return JSON.parse(sessionStorage.getItem('rcm.view.'+targetHost)||'{}'); } catch { return {}; } }
function saveView() { try { sessionStorage.setItem('rcm.view.'+targetHost,JSON.stringify({selectedId:state.selectedId,projectId:state.projectId})); } catch {} }
function rememberHost(host) { try { localStorage.setItem('rcm.connection',host); } catch {} }
rememberHost(targetHost);
const targetUrl=path=>path+(path.includes('?')?'&':'?')+'host='+targetHost;
const retiredStatusInstances=new Set();
function applyStatus(status){
  const next=selectConnectionStatus(state.status,status,retiredStatusInstances);
  if(state.status?.instanceId&&next.instanceId!==state.status.instanceId){
    state.csrf='';state.localRequests=[];
    if(state.detail){state.detail.controlled=false;state.detail.controlState='viewing';state.detail.pendingRequests=[];}
  }
  state.status=next;
}

const $ = id => document.getElementById(id);
const state = {
  status: null, models: [], projects: [], threads: [], selectedId: savedView().selectedId || null, detail: null,
  projectId: savedView().projectId || null, search: '', threadCursor: null, historyCursor: null, loadedOlderHistory: false,
  model: '', effort: '', csrf: '', transport: false, busy: new Set(), loadingThreads: false, loadingModels: false, loadingProjects: false, threadListSource: null,
  runtimeNotices: new Map(), loadingDetail: false, errors: [], localRequests: [], drafts: new Map(), selectionVersion: 0,
  listVersion: 0, threadPageError: false, historyError: '', eventSource: null, lastSync: null, refreshScope: '', refreshMessage: '', refreshing: false, streamRender: false, requestSignature: '',
};
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
  if(value?.code==='RPC_TIMEOUT'||/timed out after \d+ ms/.test(message)) return '目标机器响应超时，操作结果尚未确认。请先刷新会话列表，避免重复创建或发送。';
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
  return Boolean(state.detail.controlled || state.status?.controlledThreads?.includes(state.selectedId));
}
function snapshotHistory() { return state.detail?.historySource === 'snapshot' || currentThread()?.historySource === 'snapshot'; }
function uncertainHistory() { return snapshotHistory() && !controlled(); }
function running() {
  if (uncertainHistory()) return false;
  return turns().some(t => ['inProgress','in_progress','running'].includes(typeOf(t.status))) || typeOf(currentThread()?.status) === 'active';
}
function backgroundRunning(){return controlled()&&((state.detail?.backgroundTerminals?.data||[]).length>0||turns().some(t=>(t.items||[]).some(i=>i.type==='commandExecution'&&['inProgress','running'].includes(i.status))));}
function requestThread(r) { return r.threadId || r.params?.threadId; }
function requests() {
  const all = [...(state.status?.pendingRequests || []), ...(state.detail?.pendingRequests || []), ...state.localRequests];
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
  n.hidden = state.refreshing || !state.refreshMessage;
  n.classList.toggle('error', !state.refreshing && state.refreshMessage.includes('失败'));
  n.setAttribute('aria-busy', String(state.refreshing));
  setText('refresh-message', state.refreshMessage);
  setText('refresh-time', state.lastSync ? state.refreshScope + '最后更新：' + dateTime(state.lastSync) + '（北京时间）' : '尚未成功刷新');
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
      if(response.status===401&&data.error?.code==='PAIRING_REQUIRED')location.reload();
      const e = new Error(data.error?.message || data.message || '请求失败，HTTP ' + response.status);
      e.status = response.status; e.code = data.error?.code; e.details = data.error?.details; throw e;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时。请刷新状态，确认目标机器结果后再操作。');
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
  const banner = $('connection-banner');
  const error = c.error ? messageOf(c.error) : '';
  if (error) { banner.hidden = false; banner.className = 'connection-banner error'; banner.textContent = error; }
  else if (connected() && !state.transport) { banner.hidden = false; banner.className = 'connection-banner'; banner.textContent = '实时通道已中断。发送与审批已停用。恢复连接后，先核对目标机器状态。'; }
  else if (['connecting','reconnecting'].includes(conn)) { banner.hidden = false; banner.className = 'connection-banner'; banner.textContent = '正在连接目标机器。' + (c.stage ? (stages[c.stage] || c.stage) + '…' : '正在核验连接状态…'); }
  else if(connected()&&service.protocolValidation?.status==='limited'){const names={create:'新建会话',takeover:'接管会话',message:'发送消息',steer:'补充要求',stop:'停止',queue:'排队输入',release:'释放控制'};const disabled=Object.entries(service.protocolValidation.features||{}).filter(([,v])=>!v.supported).map(([name])=>names[name]||name);banner.hidden=false;banner.className='connection-banner';banner.textContent='已连接。当前引擎暂不支持：'+(disabled.join('、')||'部分协议读取')+'。其他已核验功能仍可使用。详见连接诊断。';}
  else banner.hidden = true;
  const connect = $('connect-button'); clear(connect); connect.append(icon(connected()||connectionPending() ? 'close' : 'link'),el('span','',state.busy.has('disconnect') ? '正在断开…' : connectionPending()?'取消连接':connected() ? '断开本机连接' : '连接目标机器'));
  const welcome = $('welcome-connect'); clear(welcome); welcome.append(icon(connected() ? 'plus' : 'link'),el('span','',connectionPending() ? '正在连接…' : connected() ? '新建目标机器会话' : '连接 ' + (h.alias || '目标机器')));
  setText('welcome-footnote',connected() ? '已连接。选择左侧会话，或新建目标机器会话。' : '等待连接。此页面不包含演示会话。');
  renderControlOverview();
  renderControls(); renderDiagnostics();
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
function renderControls() {
  const ready = usable(), own = controlled(), active = running();
  const posting = state.busy.has('message'), switching = state.busy.has('takeover'), creating = state.busy.has('create');
  $('new-thread').disabled = !ready || !featureReady('create') || creating || !state.models.length || state.loadingModels;
  $('connect-button').disabled = state.busy.has('connect') || state.busy.has('disconnect') || state.busy.has('release');
  $('welcome-connect').disabled = connectionPending() || state.busy.has('connect') || state.busy.has('disconnect') || (connected() && (!ready || !state.models.length||!featureReady('create')));
  $('release-service').disabled = !ready || !featureReady('release') || !state.status?.service?.running || state.busy.has('release');
  $('release-service').textContent = state.busy.has('release') ? '正在检查并释放…' : '停止目标服务（影响所有入口）';
  $('refresh-projects').disabled = !ready || state.refreshing; $('refresh-all').disabled = state.refreshing || state.busy.has('refresh');
  $('thread-search').disabled = !connected();
  $('model-select').disabled = !ready || !state.models.length || state.loadingModels;
  $('effort-select').disabled = !ready || !state.model || !effortsFor(state.model).length || state.loadingModels;
  const input = $('message-input'); input.disabled = !ready || !own || posting;
  input.placeholder = !ready ? '连接目标机器后继续…' : !own ? '先接管会话，再发送消息…' : active ? '补充要求，发送到当前轮次…' : '给目标机器 Codex 发送消息…';
  const hasModel = Boolean(state.model && state.models.some(m => modelId(m) === state.model));
  const hasEffort = effortsFor(state.model).some(e => e.value === state.effort);
  $('send-message').disabled = !ready || !own || !featureReady(active?'steer':'message') || posting || !input.value.trim() || (!active && (!hasModel || !hasEffort));
  $('send-message').setAttribute('aria-label',active ? '补充当前轮次' : '发送消息');
  $('interrupt').hidden = !active&&!backgroundRunning(); $('interrupt').disabled = !ready || !own || !featureReady('stop') || state.busy.has('interrupt');
  $('takeover').hidden = own || !state.selectedId; $('takeover').disabled = !ready || !featureReady('takeover') || switching || !state.selectedId;
  $('takeover').querySelector('span').textContent = switching ? '正在接管…' : '接管会话';
  $('running-indicator').hidden = !active&&!backgroundRunning();
  $('running-indicator').lastElementChild.textContent=active?'正在执行':'后台命令仍在运行';
  $('create-thread').disabled = !ready || !featureReady('create') || creating || !$('new-model').value || !$('new-effort').value;
  const draft = own ? active ? '发送补充要求不会更改当前模型。模型与档位在下一轮生效。' : '模型与档位来自目标机器。更改在下一轮生效。' : '查看模式。接管后可在原会话继续工作。';
  setText('composer-hint',state.loadingModels && !state.models.length ? '正在读取目标机器模型目录…' : draft);
  setText('model-selection-note',currentThread()?.model ? '下一轮模型与思考档位' : '下一轮模型与思考档位 · 目标机器未提供当前模型');
  document.querySelectorAll('.request-card button,.request-card input,.request-card textarea').forEach(n => { n.disabled = !ready || state.busy.has('request:' + n.closest('.request-card').dataset.requestId); });
}
const collapsedProjects = new Set(readLayout('collapsedProjects.'+targetHost,[]));
function projectForThread(thread) {
  const cwd = String(thread.cwd || '').replace(/\/$/,'');
  return state.projects.flatMap(project => (project.roots || []).map(root => ({project,root:root.replace(/\/$/,'')})))
    .filter(({root}) => cwd === root || cwd.startsWith(root + '/'))
    .sort((a,b) => b.root.length - a.root.length)[0]?.project;
}
function renderProjects() { renderThreads(); }
function renderThreads() {
  const scroller = $('project-list'), scrollTop = scroller.scrollTop;
  const n = clear($('thread-list'));
  setText('projects-heading',state.loadingProjects || state.loadingThreads ? '项目 · 同步中' : state.threadListSource === 'snapshot' ? '项目 · 历史快照' : '项目');
  const groups = state.projects.map(p => ({...p,threads:[]}));
  const extra = new Map();
  for (const t of state.threads) {
    const project = projectForThread(t);
    if (project) groups.find(p => p.id === project.id).threads.push(t);
    else {
      const key = t.cwd || '';
      if (!extra.has(key)) extra.set(key,{id:'cwd:'+key,name:key ? baseName(key) : '未关联项目',roots:key ? [key] : [],threads:[]});
      extra.get(key).threads.push(t);
    }
  }
  for (const p of [...groups,...extra.values()]) {
    if (state.search && !p.threads.length) continue;
    const group = el('div','project-group');
    const expanded = Boolean(state.search) || !collapsedProjects.has(p.id);
    const b = el('button','project-button' + (state.projectId === p.id ? ' selected' : ''));
    b.setAttribute('aria-expanded',String(expanded)); b.title = (p.roots || []).join('\n');
    b.append(icon('chevron','project-chevron'),icon('folder'),el('span','project-name',p.name || baseName(p.roots?.[0])));
    const children = el('div','project-threads'); children.hidden = !expanded;
    children.id = 'project-children-'+n.childElementCount; b.setAttribute('aria-controls',children.id);
    b.onclick = () => {
      if (expanded) collapsedProjects.add(p.id); else collapsedProjects.delete(p.id);
      state.projectId = state.projects.some(item => item.id === p.id) ? p.id : null;
      saveLayout('collapsedProjects.'+targetHost,[...collapsedProjects]); saveView(); renderThreads();
      requestAnimationFrame(loadVisibleThreads);
    };
    for (const t of p.threads) appendThread(children,t,state.projects.some(item => item.id === p.id) ? p.id : null);
    if (!p.threads.length) children.append(el('p','project-empty',state.loadingThreads || state.threadCursor ? '正在读取会话…' : state.threadPageError ? '会话读取失败，请刷新重试' : '暂无会话'));
    group.append(b,children); n.append(group);
  }
  if (!n.childElementCount) n.append(el('p','sidebar-empty',state.loadingThreads || state.loadingProjects ? '正在读取项目与会话…' : state.search ? '没有匹配的会话' : '连接后读取项目与会话'));
  const project = state.projects.find(p => p.id === state.projectId);
  setText('breadcrumb-project',project?.name || '工作区');
  $('more-threads').hidden = !state.loadingThreads && !state.threadPageError && !state.threadCursor;
  $('more-threads').textContent = state.threadPageError ? '加载失败，点击重试' : state.loadingThreads ? '正在加载会话…' : '加载更多会话';
  $('more-threads').disabled = state.loadingThreads;
  $('more-threads').onclick = () => loadThreads(Boolean(state.threadCursor));
  scroller.scrollTop = scrollTop;
}
function appendThread(n,t,projectId) {
    const b = el('button','thread-row' + (state.selectedId === t.id ? ' selected' : '')); b.dataset.threadId = t.id; b.title = threadName(t); if (state.selectedId === t.id) b.setAttribute('aria-current','true');
    const title = el('div','thread-name'); title.append(el('span','',threadName(t)));
    const session=state.status?.controlledSessions?.find(item=>item.id===t.id);
    const badge=el('span','thread-runtime',session?sessionLabel(session):'查看模式');badge.dataset.threadId=t.id;
    if (typeOf(t.status) === 'active' && t.historySource !== 'snapshot' && state.threadListSource !== 'snapshot') title.append(el('span','thread-running'));
    const meta = el('div','thread-meta'); meta.append(el('span','thread-preview',''),el('span','thread-time',relativeTime(t.recencyAt || t.updatedAt || t.createdAt)));
    if (session) meta.append(badge); b.append(title,meta); b.onclick = () => { state.projectId = projectId; saveView(); selectThread(t.id); }; n.append(b);

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
  select.value = selected || modelId(state.models.find(m => m.isDefault) || state.models[0]);
}
function fillEfforts(select, model, effort) {
  clear(select); const opts = effortsFor(model);
  if (!opts.length) { const o = el('option','','无可用档位'); o.value = ''; select.append(o); return; }
  opts.forEach(e => { const o = el('option','',e.label); o.value = e.value; o.title = e.description; select.append(o); });
  select.value = opts.some(e => e.value === effort) ? effort : defaultEffort(model);
}
function renderModels(preferThread = false) {
  const t = currentThread();
  if (preferThread && t?.model) state.model = modelFor(t.model) ? modelId(modelFor(t.model)) : t.model;
  if (preferThread && t?.reasoningEffort) state.effort = t.reasoningEffort;
  // Preserve restored preferences until the model catalog arrives.
  if (!state.models.length) {
    fillModels($('model-select'),state.model); fillEfforts($('effort-select'),state.model,state.effort);
    renderControls(); return;
  }
  if (!modelFor(state.model)) state.model = state.models.length ? modelId(state.models.find(m => m.isDefault) || state.models[0]) : '';
  if (preferThread && t?.reasoningEffort) state.effort = t.reasoningEffort;
  if (!effortsFor(state.model).some(e => e.value === state.effort)) state.effort = defaultEffort(state.model);
  fillModels($('model-select'),state.model); fillEfforts($('effort-select'),state.model,state.effort);
  renderControls();
}

function appendInline(n, text) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g; let last = 0;
  for (const m of String(text).matchAll(pattern)) {
    if (m.index > last) n.append(document.createTextNode(text.slice(last,m.index)));
    const t = m[0];
    if (t[0] === '`') n.append(el('code','',t.slice(1,-1)));
    else if (t.startsWith('**')) n.append(el('strong','',t.slice(2,-2)));
    else {
      const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      let safe = false;
      try { const u = new URL(match[2]); safe = ['https:','http:'].includes(u.protocol); } catch {}
      if (safe) { const a = el('a','',match[1]); a.href = match[2]; a.target = '_blank'; a.rel = 'noopener noreferrer'; n.append(a); }
      else n.append(document.createTextNode(match[1] + ' (' + match[2] + ')'));
    }
    last = m.index + t.length;
  }
  if (last < text.length) n.append(document.createTextNode(text.slice(last)));
}
function markdown(text) {
  const n = el('div','message-body'); const lines = String(text || '').split('\n');
  let code = null, paragraph = [], list = null;
  const flush = () => { if (paragraph.length) { const p = el('p'); appendInline(p,paragraph.join('\n')); n.append(p); paragraph = []; } list = null; };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.trimStart().startsWith('```')) {
      if (code) { const pre = el('pre'); pre.append(el('code','',code.join('\n'))); n.append(pre); code = null; }
      else { flush(); code = []; } continue;
    }
    if (code) { code.push(line); continue; }
    const tableCells = value => value.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
    if (line.includes('|') && lines[lineIndex + 1] && tableCells(lines[lineIndex + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      flush(); const wrap = el('div','table-scroll'), table = el('table'), head = el('thead'), row = el('tr');
      const headings = tableCells(line);
      headings.forEach(value => { const cell = el('th'); cell.scope = 'col'; appendInline(cell,value); row.append(cell); });
      head.append(row); table.append(head); const body = el('tbody'); lineIndex++;
      while (lineIndex + 1 < lines.length && lines[lineIndex + 1].trim() && lines[lineIndex + 1].includes('|')) {
        const values = tableCells(lines[++lineIndex]), tr = el('tr');
        headings.forEach((_,i) => { const cell = el('td'); appendInline(cell, values[i] || ''); tr.append(cell); }); body.append(tr);
      }
      table.append(body); wrap.append(table); n.append(wrap); continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { flush(); const h = el('h' + Math.min(4,heading[1].length + 1)); appendInline(h,heading[2]); n.append(h); continue; }
    const bullet = /^(?:[-*+]\s+|\d+\.\s+)(.+)$/.exec(line);
    if (bullet) {
      if (paragraph.length) flush();
      const ordered = /^\d/.test(line); if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) { list = el(ordered ? 'ol' : 'ul'); n.append(list); }
      const li = el('li'); appendInline(li,bullet[1]); list.append(li); continue;
    }
    if (line.startsWith('> ')) { flush(); const b = el('blockquote'); appendInline(b,line.slice(2)); n.append(b); continue; }
    list = null; paragraph.push(line);
  }
  flush(); if (code) { const pre = el('pre'); pre.append(el('code','',code.join('\n'))); n.append(pre); } return n;
}
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content?.text || '';
  return content.map(c => c.text || (c.type === 'image' || c.type === 'localImage' ? '[图片附件]' : c.type === 'skill' ? '[技能：' + (c.name || c.path || '') + ']' : c.type === 'mention' ? '[引用：' + (c.name || c.path || '') + ']' : '')).filter(Boolean).join('\n');
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
  if (item.type === 'userMessage') { const m = el('div','message user'); m.append(el('div','user-bubble',contentText(item.content))); return m; }
  if (['agentMessage','plan'].includes(item.type)) {
    const m = el('article','message agent'); m.setAttribute('aria-label',item.type === 'plan' ? '计划' : 'Codex 回复'); const label = el('div','agent-label' + (item.type === 'agentMessage' ? ' message-author' : '')); label.append(icon('mark'),el('span','',item.type === 'plan' ? '计划' : 'Codex')); m.append(label);
    const text=String(item.text||''), heartbeat=text.match(/<heartbeat>\s*<automation_id>([^<]+)<\/automation_id>\s*<decision>([^<]+)<\/decision>\s*<message>([\s\S]*?)<\/message>\s*<\/heartbeat>/);
    if(heartbeat){
      m.append(markdown(text.slice(0,heartbeat.index)));
      const card=el('section','decision-notice');card.append(el('strong','','自动任务通知 · '+heartbeat[1]),el('p','',heartbeat[3].trim()));
      const reply=el('button','secondary-button',controlled()?'回复决策':'接管并回复决策');
      reply.onclick=async()=>{if(!controlled())await takeoverThread();if(!controlled())return;$('message-input').focus();$('message-input').placeholder='输入你的决定，确认后发送…';};
      card.append(reply,el('small','','此通知是历史记录。填写并发送后，才会提交你的决定。'));m.append(card,markdown(text.slice(heartbeat.index+heartbeat[0].length)));
    }else m.append(markdown(text)); return m;
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
    const {d,body}=toolDetails(item,'生成图片','file');
    if(item.revisedPrompt)body.append(el('p','tool-meta',item.revisedPrompt));
    if(item.imageRef){
      const ref=item.imageRef;
      const url='/api/threads/'+encodeURIComponent(ref.threadId)+'/items/'+encodeURIComponent(ref.itemId)+'/image';
      const button=el('button','secondary-button','加载图片预览');button.type='button';
      const image=el('img','generated-image');image.alt='目标机器生成图片的预览';image.hidden=true;
      button.onclick=()=>{button.disabled=true;button.textContent='正在加载预览…';image.hidden=false;image.src=targetUrl(url+'?preview=1');};
      image.onload=()=>{button.hidden=true;};image.onerror=()=>{button.disabled=false;button.textContent='重试图片预览';image.hidden=true;};
      const download=el('a','image-download','下载原图');download.href=targetUrl(url+'?download=1');download.download=ref.itemId+'.png';
      body.append(button,download,image);
    }else if(item.result){const image=el('img','generated-image');image.alt='目标机器生成图片';image.src='data:image/png;base64,'+item.result;body.append(image);}
    else body.append(el('p','tool-meta',item.failure?messageOf(item.failure):'该记录没有图片内容。'));
    if(item.savedPath)body.append(el('p','tool-meta','目标机器文件：'+item.savedPath));return d;
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
  const scroller = $('messages-scroller'), nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  const shape=JSON.stringify([state.selectedId,state.loadingDetail,state.historyError,uncertainHistory(),state.detail?.recovering,[...(state.runtimeNotices.get(state.selectedId)?.values()||[])],turns()],(key,value)=>['aggregatedOutput','outputToken'].includes(key)?undefined:value);
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
  const n = clear($('messages'));
  if (state.loadingDetail) { n.append(el('div','empty-history loading','正在读取会话历史…')); return; }
  if (state.historyError) { n.append(el('div','turn-error',state.historyError)); if(!turns().length)return; }
  if(state.detail?.recovering)n.append(el('div','history-notice','已恢复本机保存的输出，正在同步最新内容…')); 
  for (const notice of state.runtimeNotices.get(state.selectedId)?.values() || []) n.append(el('div','turn-error',notice));
  if (!turns().length) { const empty = el('div','empty-history'); empty.append(icon('chat'),el('p','','此会话暂无消息。'),el('p','',controlled() ? '输入要求，开始目标机器工作。' : '接管后，可以在此会话开始工作。')); n.append(empty); }
  turns().forEach(t => {
    const turn = el('section','message-turn'); turn.dataset.turnId = t.id;
    const meta = el('div','turn-meta'); meta.classList.toggle('needs-attention',['failed','declined','systemError','interrupted'].includes(typeOf(t.status))); meta.append(el('span','',dateTime(t.startedAt || t.createdAt,true)));
    const actualModel = t.model || t.modelInfo?.model, actualEffort = t.effort || t.reasoningEffort || t.modelInfo?.reasoningEffort;
    if (actualModel || actualEffort) meta.append(el('span','turn-model',[actualModel,actualEffort && '思考：' + (effortNames[actualEffort] || actualEffort)].filter(Boolean).join(' · ')));
    const turnStatus = uncertainHistory() && ['inProgress','in_progress','running'].includes(typeOf(t.status)) ? '状态未确认' : statusNames[typeOf(t.status)] || typeOf(t.status);
    meta.append(el('span','turn-status',turnStatus)); turn.append(meta);
    const items = t.items || [];
    let processGroup = null, processBody = null;
    const processItems = items.filter(item => !['userMessage','agentMessage','plan','error'].includes(item.type));
    for (const item of items) {
      if (['userMessage','agentMessage','plan','error'].includes(item.type)) {
        turn.append(renderItem(item));
        continue;
      }
      if (!processGroup) {
        processGroup = el('details','activity-group process-group');
        processGroup.dataset.itemId = 'process-' + t.id;
        const summary = el('summary');
        summary.append(icon('chevron','chevron'),el('span','','查看过程'));
        const failed = processItems.some(value => ['failed','declined','systemError'].includes(typeOf(value.status)) || (value.exitCode != null && value.exitCode !== 0));
        const active = processItems.some(value => ['inProgress','in_progress','running'].includes(typeOf(value.status)));
        if (failed) summary.append(el('span','process-status error','有失败记录'));
        else if (active) summary.append(el('span','process-status',uncertainHistory() ? '状态未确认' : '执行中'));
        processBody = el('div','activity-items');
        processGroup.append(summary,processBody); turn.append(processGroup);
      }
      processBody.append(renderItem(item));
    }
    if (t.error) turn.append(el('div','turn-error',messageOf(t.error)));
    n.append(turn);
  });
  if(state.detail?.outputPreview&&!opened.size){
    const latest=turns().flatMap(t=>(t.items||[]).filter(i=>i.type==='commandExecution'&&i.aggregatedOutput).map(i=>[t.id,i.id])).at(-1);
    if(latest){opened.add('process-'+latest[0]);opened.add(latest[1]);}
  }
  n.querySelectorAll('details[data-item-id]').forEach(d => { if (opened.has(d.dataset.itemId)) d.open = true; });
  n.querySelectorAll('.tool-output[data-follow-tail="true"]').forEach(pre=>{pre.scrollTop=pre.scrollHeight;});
  if (nearBottom && !state.busy.has('history')) scroller.scrollTop = scroller.scrollHeight;
  else if (state.busy.has('history')) {
    const restored = [...n.querySelectorAll('.message-turn')].find(node => node.dataset.turnId === anchorId);
    const targetTop = restored ? oldTop + restored.getBoundingClientRect().top - viewportTop - anchorOffset : oldTop + (scroller.scrollHeight - oldHeight);
    // A short initial page can leave blank space below the last message.
    // Retain that space so the browser does not clamp the restored position.
    const missingSpace = targetTop - (scroller.scrollHeight - scroller.clientHeight);
    if (missingSpace > 0) n.style.paddingBottom = (parseFloat(n.style.paddingBottom) || 0) + Math.ceil(missingSpace) + 'px';
    scroller.scrollTop = targetTop;
  }
  else scroller.scrollTop = oldTop;
}
function renderThread() {
  const t = currentThread(); $('welcome').hidden = Boolean(state.selectedId); $('conversation').hidden = !state.selectedId;
  $('thread-title').hidden = !state.selectedId;
  $('breadcrumb-project').hidden = Boolean(state.selectedId);
  $('toggle-message-details').hidden = !state.selectedId;
  if (!state.selectedId) { renderSession(); renderFiles(); renderControls(); return; }
  setText('thread-title',t ? threadName(t) : '正在读取会话…'); $('thread-title').title = $('thread-title').textContent; setText('thread-path',t?.cwd ? '目标机器 · ' + t.cwd : '');
  const own = controlled(), control = typeOf(state.detail?.controlState), busy = ['busy','occupied','active_writer','conflict'].includes(control);
  const badge = $('control-badge'); badge.className = 'control-badge' + (own ? ' controlled' : busy ? ' busy' : ''); badge.textContent = own ? '已取得控制' : busy ? '已被占用' : '查看模式';
  const note = $('control-note');
  note.className = 'control-note' + (busy ? ' error' : '');
  note.textContent = own ? '此会话由当前工作台控制。发送消息会在目标机器执行。' : busy ? '原会话已有控制端。请先结束目标机器桌面的任务，再手动退出桌面应用。然后重试接管。' : '当前只读取历史。点击“接管会话”后，可以继续原会话。';
  if (snapshotHistory()) note.textContent = (own ? '历史来自快照。实时状态由目标机器控制连接确认。' : '历史快照，运行状态需接管后确认。') + (busy ? ' ' + note.textContent : '');
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
  if (c.stage) { const d = el('div','diagnostic-entry'); d.append(el('time','','当前阶段'),el('p','',stages[c.stage] || c.stage)); n.append(d); }
  if (s.service?.pid) { const d = el('div','diagnostic-entry'); d.append(el('time','','目标机器服务'),el('p','','PID ' + s.service.pid + (s.service.running ? ' · 运行中' : ' · 未运行'))); n.append(d); }
  if(s.service?.protocolValidation){const v=s.service.protocolValidation,d=el('div','diagnostic-entry');d.append(el('time','','协议兼容性'),el('p','',`${v.version} · 已核验 ${v.methods} 项接口${v.cached?' · 使用已核验缓存':''}`));Object.entries(v.features||{}).filter(([,feature])=>!feature.supported).forEach(([,feature])=>d.append(el('p','',feature.reason)));n.append(d);}
  if(s.service?.installedVersion&&s.service.installedVersion!==s.service.version){const d=el('div','diagnostic-entry');d.append(el('time','','引擎更新'),el('p','',`已安装 ${s.service.installedVersion}，当前运行 ${s.service.version}。任务结束后释放并重新连接，即可使用新引擎。`));n.append(d);}
  const all = [...(s.errors || []),...state.errors].sort((a,b) => (timestamp(b.time)?.getTime() || 0) - (timestamp(a.time)?.getTime() || 0)).slice(0,10);
  all.forEach(e => { const d = el('div','diagnostic-entry error'); d.append(el('time','',dateTime(e.time) + (e.stage ? ' · ' + (stages[e.stage] || e.stage) : '')),el('p','',e.message || messageOf(e))); n.append(d); });
  if (!n.childNodes.length) n.append(el('p','subtle','暂无错误记录。连接后显示服务状态。'));
}
function renderRequests() {
  const list = requests(), signature = JSON.stringify([state.selectedId,list]);
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
    card.append(el('h4','',title));
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
      const form = el('form');
      p.questions.forEach((q,qi) => {
        const group = el('fieldset','question-group'); group.append(el('legend','question-label',q.question || q.header || q.id));
        (q.options || []).forEach((opt,oi) => {
          const label = el('label','question-option'); const input = el('input'); input.type = 'radio'; input.name = 'q-' + qi; input.value = opt.label || opt.value || String(oi);
          const copy = el('span','',opt.label || opt.value); if (opt.description) copy.append(el('small','',opt.description)); label.append(input,copy); group.append(label);
        });
        const other = el('textarea','question-other'); other.name = 'other-' + qi; other.placeholder = '输入补充回答'; other.rows = 2; group.append(other); form.append(group);
      });
      const actions = el('div','request-actions'); const submit = el('button','accept','提交回答'); submit.type = 'submit'; actions.append(submit);
      form.onsubmit = e => { e.preventDefault(); const answers = {}; const fd = new FormData(form); let valid = true; p.questions.forEach((q,qi) => { const own = String(fd.get('other-' + qi) || '').trim(), chosen = fd.get('q-' + qi); const values = own ? [own] : chosen ? [String(chosen)] : []; if (!values.length) valid = false; answers[q.id] = {answers:values}; }); if (!valid) { toast('请回答所有问题。',true); return; } respondRequest(r,{answers}); };
      form.append(actions); card.append(form);
    } else {
      if (!knownApproval) card.append(el('p','','此工具需要专用实现。请查看请求详情。可以取消请求，避免会话一直等待。'));
      const detail = el('details','request-detail'); detail.append(el('summary','','请求详情'),el('pre','',pretty({method,params:p}))); card.append(detail);
      const actions = el('div','request-actions');
      if (knownApproval) { const available = p.availableDecisions; const accepts = !Array.isArray(available) || !available.length || available.includes('accept'); const declines = !Array.isArray(available) || !available.length || available.includes('decline'); const accept = el('button','accept','允许一次'); accept.onclick = () => respondRequest(r,{decision:'accept'}); if (accepts) actions.append(accept); const decline = el('button','','拒绝'); decline.onclick = () => respondRequest(r,{decision:'decline'}); if (declines) actions.append(decline); }
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
async function loadThreads(append = false, reportFailure = false) {
  if (!connected() || (append && (state.loadingThreads || !state.threadCursor))) return;
  // Restore project metadata before grouping the cross-project thread list.
  if (state.projectId && !state.projects.length) await loadProjects();
  const seq = ++state.listVersion; state.loadingThreads = true; state.threadPageError = false;
  if (!append) { state.threads = []; state.threadCursor = null; $('project-list').scrollTop = 0; }
  renderThreads();
  const q = new URLSearchParams(); if (state.search) q.set('search',state.search);
  if (append && state.threadCursor) q.set('cursor',state.threadCursor);
  try {
    const d = await api('/api/threads?' + q); if (seq !== state.listVersion) return;
    state.threadListSource = d.historySource || null;
    const all = append ? [...state.threads,...(d.data || [])] : d.data || [];
    const seen = new Set(); state.threads = all.filter(t => !seen.has(t.id) && seen.add(t.id)); state.threadCursor = d.nextCursor || null;
  } catch (e) { if (seq === state.listVersion) { state.threadPageError = true; recordError(e,'threads'); toast(messageOf(e),true); } if (reportFailure) throw e; }
  finally { if (seq === state.listVersion) { state.loadingThreads = false; renderThreads(); if (!state.threadPageError) requestAnimationFrame(loadVisibleThreads); } }
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
  const cached=await readDetailCache(targetHost,id);
  if(!cached||id!==state.selectedId||seq!==state.selectionVersion||state.detail)return;
  state.loadingDetail=false;applyDetail(cached,true);
}
function applyDetail(data, resetModels = false) {
  state.detail = {...data, turns:data.turns || data.thread?.turns || []};
  state.historyCursor = data.nextCursor || data.historyCursor || null; state.historyError = '';
  if (resetModels) renderModels(true); renderThread(); renderRequests(); if(!data.recovering)saveDetailSoon();
}
async function selectThread(id) {
  voice?.interrupt();
  toggleInspector(false);
  $('messages').style.paddingBottom = '';
  if (state.selectedId) state.drafts.set(state.selectedId,$('message-input').value);
  const seq = ++state.selectionVersion; state.selectedId = id; state.detail = null; state.historyCursor = null; state.loadedOlderHistory = false; state.loadingDetail = true; state.historyError = ''; saveView();
  $('message-input').value = state.drafts.get(id) || ''; resizeInput(); renderThread(); renderThreads(); if (window.innerWidth <= 700) toggleSidebar(false, false);
  await restoreDetail(id,seq);
  try { const data = await readSelectedDetail(id); if (seq !== state.selectionVersion) return; state.loadingDetail = false; data.turns=mergeLiveTurns(turns(),data.turns||[]);applyDetail(data,true); $('messages-scroller').scrollTop = $('messages-scroller').scrollHeight; }
  catch (e) { if (seq !== state.selectionVersion) return; state.loadingDetail = false; state.historyError = messageOf(e); recordError(e,'thread'); renderThread(); }
}
async function readSelectedDetail(id){
  const cold=!state.detail,started=performance.now();let firstMs=null;
  if(!state.detail){
    const seq=state.selectionVersion;
    const preview=await api('/api/threads/'+encodeURIComponent(id)+'?preview=1');
    if(id!==state.selectedId||seq!==state.selectionVersion)return preview;
    state.loadingDetail=false;applyDetail(preview,true);firstMs=performance.now()-started;
  }
  const bases=outputBases(turns());
  const versions=Object.fromEntries([...bases].slice(-50).map(([id,b])=>[id,b.token]));
  const encoding=(typeof DecompressionStream==='function'?'?outputEncoding=gzip-base64':'?outputEncoding=plain')+(cold?'&fast=1':'');
  const response=await api('/api/threads/' + encodeURIComponent(id)+encoding,{headers:{'X-Output-Versions':JSON.stringify(versions)}}),received=performance.now();
  const result=hydrateOutputs(await decodeOutputs(response),bases);
  if(cold&&id===state.selectedId)document.body.dataset.logRecovery=JSON.stringify({host:targetHost,id,firstMs:Math.round(firstMs),networkMs:Math.round(received-started-firstMs),decodeMs:Math.round(performance.now()-received),completeMs:Math.round(performance.now()-started)});
  if(cold)setTimeout(()=>{if(id===state.selectedId)scheduleDetailRefresh();},1000);
  return result;
}
const detailReads = new Map();
async function refreshSelected() {
  if (!state.selectedId) return;
  const id = state.selectedId, seq = state.selectionVersion;
  if(detailReads.has(id)) return detailReads.get(id);
  const read=(async()=>{
  if(!state.detail)await restoreDetail(id,seq);
  const data = await readSelectedDetail(id); if (id !== state.selectedId || seq !== state.selectionVersion) return;
  data.turns = mergeLiveTurns(turns(), data.turns || data.thread?.turns || []);
  if (state.loadedOlderHistory) data.nextCursor = state.historyCursor;
  applyDetail(data,!state.detail);
  })();
  detailReads.set(id,read);
  try { await read; } finally { if(detailReads.get(id)===read)detailReads.delete(id); }
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
  const supported = 'Notification' in window && window.isSecureContext;
  $('task-notifications').disabled = !supported;
  $('task-notifications').checked = taskNotificationsEnabled && supported && Notification.permission === 'granted';
  $('test-notification').disabled = !$('task-notifications').checked;
  setText('notification-status', !supported ? '当前浏览器不支持系统通知' : Notification.permission === 'denied' ? '通知已被阻止。请在浏览器网站设置中允许通知。' : $('task-notifications').checked ? '已开启：仅提醒整个任务完成、执行失败或需要你处理；普通轮次结束不提醒；多个页面只提醒一次。页面关闭期间的提醒会在重新打开后补发。' : '通知未开启');
}
async function setTaskNotifications(enabled) {
  try {
    if (enabled && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    taskNotificationsEnabled = enabled && 'Notification' in window && Notification.permission === 'granted';
    localStorage.setItem('rcm.taskNotifications.' + targetHost, String(taskNotificationsEnabled));
  } catch (error) { taskNotificationsEnabled = false; recordError(error,'notifications'); }
  renderTaskNotifications();
}
const liveNotifications = new Set();
function notificationDiagnostic(message) {
  let list = $('notification-history');
  if (!list) { list = el('div','notification-history'); list.id = 'notification-history'; list.setAttribute('role','log'); document.querySelector('.notification-controls').append(list); }
  list.prepend(el('p','',dateTime(new Date()) + ' · ' + message));
  while (list.children.length > 8) list.lastElementChild.remove();
}
function sendTaskNotification(title, body, tag, threadId) {
  notificationDiagnostic(title + '：正在提交给浏览器');
  try {
    const notification = new Notification(title,{body,tag});
    liveNotifications.add(notification);
    notification.onshow = () => notificationDiagnostic(title + '：浏览器报告已显示');
    notification.onclose = () => { liveNotifications.delete(notification); notificationDiagnostic(title + '：通知已关闭'); };
    notification.onclick = () => { window.focus(); notification.close(); if (threadId) selectThread(threadId); };
    notification.onerror = () => { liveNotifications.delete(notification); notificationDiagnostic(title + '：浏览器报告发送失败'); setText('notification-status','通知发送失败。请检查浏览器和 Mac 的通知设置。'); };
  } catch (error) { notificationDiagnostic(title + '：' + error.message); setText('notification-status','通知发送失败：' + error.message); }
}
async function notifyTaskEvent(method, params) {
  if (!taskNotificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const threadId = params.threadId || params.thread?.id || (params.request || params).params?.threadId;
  const thread = state.threads.find(t => t.id === threadId) || (state.selectedId === threadId ? currentThread() : null);
  const notice = taskNotice(method, params, {host:targetHost, known:!!thread || state.status?.controlledThreads?.includes(threadId) || state.status?.subscribedThreads?.includes(threadId)});
  if (!notice) return;
  const focused = !notice.urgent && document.visibilityState === 'visible' && document.hasFocus() && state.selectedId === threadId;
  // Let a foreground viewer claim the event before background tabs try to display it.
  if (!focused) await new Promise(resolve => setTimeout(resolve,200));
  try {
    const delivered = await navigator.locks.request('rcm.task-notifications', () => {
      if (localStorage.getItem('rcm.taskNotifications.' + targetHost) !== 'true') return;
      if (!claimNotice(localStorage,notice.key)) return true;
      if (focused) return true;
      sendTaskNotification('Codex · ' + notice.label, (state.status?.host?.alias || targetHost) + ' · ' + (thread ? threadName(thread) : '会话 ' + threadId.slice(0,8)), notice.key, threadId);
      return true;
    });
    if(delivered)await api('/api/notices/ack',{method:'POST',body:{key:notice.key}});
    return delivered;
  } catch (error) { recordError(error,'notifications'); }
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
async function releaseService() {
  if(!confirm('将停止目标机器的专用服务，影响所有入口。请确认任务已结束，且其他入口已断开。停止后需在目标机执行 maintenance resume 才能重连。'))return;
  await action('release',async () => {
    try { await api('/api/service/release',{method:'POST',body:{allEntrancesDisconnected:true}}); if (state.detail) state.detail.controlled = false; await loadStatus(); renderThread(); toast('已释放专用服务。可以在目标机器打开 Codex 桌面应用。',false,10000); }
    catch (e) { if (e.status === 409) { const blockers = Array.isArray(e.details) ? e.details.map(b => (state.threads.find(t=>t.id===b.threadId)?.name || b.threadId) + '：' + b.reason).join('\n') : e.details ? pretty(e.details) : ''; throw new Error(messageOf(e) + (blockers ? '\n' + blockers : '') + '\n请先结束相关任务，再释放控制。'); } throw e; }
  });
}
async function respondRequest(r, answer) {
  await action('request:' + requestPath(r), async () => {
    await api('/api/requests/' + encodeURIComponent(requestPath(r)) + '/respond',{method:'POST',body:answer});
    const remove = list => (list || []).filter(x => requestKey(x) !== requestKey(r));
    state.localRequests = remove(state.localRequests); if (state.status) state.status.pendingRequests = remove(state.status.pendingRequests); if (state.detail) state.detail.pendingRequests = remove(state.detail.pendingRequests);
    renderRequests(); await loadStatus(); toast('已提交处理结果。');
  });
}
function openNewDialog() {
  voice?.interrupt();
  if (!usable() || !state.models.length) { toast('连接目标机器并读取模型目录后，再新建会话。',true); return; }
  const project = state.projects.find(p => p.id === state.projectId);
  const select=clear($('new-cwd'));
  const options=state.projects.flatMap(p=>(p.roots||[]).map(root=>({root,name:p.name||baseName(root)})));
  options.forEach(p=>{const option=el('option','',p.name);option.value=p.root;select.append(option);});
  const preferred=project?.roots?.[0]||currentThread()?.cwd;
  if(options.some(p=>p.root===preferred))select.value=preferred;
  select.onchange=()=>setText('new-project-path',select.value||'此连接暂无项目。请先在 Codex 中添加项目。');select.onchange();
  $('new-thread-error').hidden = true;
  fillModels($('new-model'),state.model); fillEfforts($('new-effort'),$('new-model').value,state.effort);
  $('new-thread-dialog').showModal(); renderControls(); setTimeout(() => $('new-cwd').focus(),0);
}
async function createThread(e) {
  e.preventDefault(); const cwd = $('new-cwd').value.trim();
  if (!cwd.startsWith('/')) { $('new-thread-error').textContent = '请选择一个项目。'; $('new-thread-error').hidden = false; return; }
  await action('create',async () => {
    try {
      const d = await api('/api/threads',{method:'POST',body:{cwd,model:$('new-model').value,effort:$('new-effort').value}});
      $('new-thread-dialog').close(); if (window.innerWidth <= 700) toggleSidebar(false, false); state.model = $('new-model').value; state.effort = $('new-effort').value;
      const id = d.thread?.id || d.id; if (!id) throw new Error('服务未返回新会话 ID。请刷新列表核对结果。');
      state.selectedId = id; toggleInspector(false); saveView(); state.loadingDetail = false; state.drafts.set(id,''); $('message-input').value = ''; applyDetail({...d,thread:{...d.thread,name:d.thread?.name || '新会话'},controlled:true},true);
      await Promise.allSettled([loadThreads(),loadStatus()]); toast('目标机器会话已创建。'); $('message-input').focus();
    } catch (err) { $('new-thread-error').textContent = messageOf(err); $('new-thread-error').hidden = false; recordError(err,'create'); }
  });
}
async function sendMessage(e) {
  voice?.interrupt();
  e?.preventDefault(); const text = $('message-input').value.trim(), id = state.selectedId;
  if (!text || !id || !usable() || !controlled() || state.busy.has('message')) return;
  const active = running();
  await action('message',async () => {
    const payload = active ? {text} : {text,model:state.model,effort:state.effort};
    const d = await api('/api/threads/' + encodeURIComponent(id) + (active ? '/steer' : '/message'),{method:'POST',body:payload});
    state.drafts.delete(id); if (id === state.selectedId) { $('message-input').value = ''; resizeInput(); if (d.turn) { upsertTurn(d.turn); const t = ensureTurn(d.turn.id); if (!t.items.some(item => item.type === 'userMessage' && contentText(item.content) === text)) t.items.unshift({id:'accepted-'+d.turn.id,type:'userMessage',content:[{type:'text',text}],localAccepted:true}); } renderThread(); }
    if (active) toast('补充要求已发送到当前轮次。');
    try { await refreshSelected(); } catch (err) { recordError(err,'thread'); }
  });
}
async function interruptThread() {
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
    try{d=await api('/api/threads/' + encodeURIComponent(id) + '/history?cursor=' + encodeURIComponent(state.historyCursor));}
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
function upsertItem(turnId,item) { const t = ensureTurn(turnId); if (!t) return; if (item.type === 'userMessage') t.items = t.items.filter(old => !old.localAccepted || contentText(old.content) !== contentText(item.content)); const i = t.items.findIndex(x => x.id === item.id); if (i >= 0) t.items[i] = mergeLiveTurns([{id:turnId,items:[t.items[i]]}],[{id:turnId,items:[item]}])[0].items[0]; else t.items.push(item); }
function scheduleStreamRender() {
  if (state.streamRender) return; state.streamRender = true;
  setTimeout(() => { state.streamRender = false; renderMessages(); renderSession(); renderFiles(); renderControls(); },80);
}
let detailRefreshTimer, listRefreshTimer;
function scheduleDetailRefresh() { if(detailRefreshTimer)return; detailRefreshTimer = setTimeout(() => { detailRefreshTimer=null; if (usable() && state.selectedId) refreshSelected().catch(e => recordError(e,'thread')); },650); }
function scheduleListRefresh() { clearTimeout(listRefreshTimer); listRefreshTimer = setTimeout(() => { if (usable()) loadThreads(); },1000); }
function handleEvent(event) {
  let data; try { data = JSON.parse(event.data); } catch { return; }
  const method = data.method || event.type, p = data.params || {};
  if(method==='manager/taskNotice'){
    notifyTaskEvent(p.event.method,p.event.params);return;
  }
  notifyTaskEvent(method,p);
  if (method === 'manager/status') {
    const was = connected(); applyStatus(p.status || p); renderStatus(); renderRequests(); renderThread();
    for(const request of state.status.pendingRequests||[])notifyTaskEvent('manager/request',request);
    if (!was && connected()) refreshWorkspace().catch(e => recordError(e,'sync'));
    return;
  }
  if (method === 'manager/error') { recordError(p.message || p.error || p,p.stage || 'remote'); toast(messageOf(p.message || p.error || p),true,11000); return; }
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
  if (threadId !== state.selectedId || !state.detail) return;
  if (method === 'mcpServer/startupStatus/updated') {
    const notices = state.runtimeNotices.get(threadId) || new Map();
    if (p.status === 'failed') notices.set(p.name, '扩展 ' + p.name + ' 启动失败：' + messageOf(p.error || '未知原因'));
    else if (p.status === 'ready') notices.delete(p.name);
    else if (p.status === 'starting') notices.set(p.name, '正在启动扩展：' + p.name);
    state.runtimeNotices.set(threadId,notices); scheduleStreamRender(); return;
  }
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
    if (restored) refreshWorkspace().catch(e => { recordError(e,'sync'); renderStatus(); });
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
  const shell = $('app-shell'); const mobile = window.innerWidth <= 700;
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
  if (show && window.innerWidth <= 700) toggleSidebar(false, false);
}
function toggleMessageDetails(show) {
  const scroller = $('messages-scroller');
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  $('conversation').classList.toggle('show-message-details',show);
  $('toggle-message-details').setAttribute('aria-pressed',String(show));
  $('toggle-message-details').textContent = show ? '收起消息信息' : '显示消息信息';
  $('toggle-message-details').setAttribute('aria-label',$('toggle-message-details').textContent);
  saveLayout('messageDetails',show);
  if (atBottom) scroller.scrollTop = scroller.scrollHeight;
}
function wireEvents() {
  const fitKeyboard=()=>{document.documentElement.style.setProperty('--visual-height',(window.visualViewport?.height||window.innerHeight)+'px');};
  window.visualViewport?.addEventListener('resize',fitKeyboard);fitKeyboard();
  voice=installVoice({input:$('message-input'),context:()=>targetHost+':'+state.selectedId,send:()=>sendMessage(),render:()=>renderControls()});
  setupResizableLayout();
  try { taskNotificationsEnabled = localStorage.getItem('rcm.taskNotifications.' + targetHost) === 'true'; } catch {}
  renderTaskNotifications();
  $('task-notifications').onchange = event => setTaskNotifications(event.target.checked);
  $('test-notification').onclick = () => { if (taskNotificationsEnabled && Notification.permission === 'granted') sendTaskNotification('Codex · 测试通知','浏览器通知已接入。请检查 Mac 通知中心。','codex-test'); };
  window.addEventListener('focus',renderTaskNotifications);
  let autoRefresh = false;
  try { autoRefresh = localStorage.getItem('rcm.autoRefresh.' + targetHost) === 'true'; } catch {}
  setAutoRefresh(autoRefresh);
  $('auto-refresh').onchange = event => setAutoRefresh(event.target.checked);
  window.addEventListener('pagehide', () => { clearInterval(autoRefreshTimer); autoRefreshTimer = null; });
  window.addEventListener('pageshow', event => { toggleInspector(false); if (event.persisted) setAutoRefresh($('auto-refresh').checked); });
  let composerWidth = 0;
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== composerWidth) { composerWidth = width; resizeInput(); }
  }).observe($('message-input'));
  toggleMessageDetails(readLayout('messageDetails',false));
  $('toggle-message-details').onclick = () => toggleMessageDetails(!$('conversation').classList.contains('show-message-details'));
  $('connect-button').onclick = () => connected()||connectionPending() ? disconnectRemote() : connectRemote();
  $('welcome-connect').onclick = () => connected() ? openNewDialog() : connectRemote();
  $('new-thread').onclick = openNewDialog; $('takeover').onclick = takeoverThread; $('release-service').onclick = releaseService;
  $('refresh-all').onclick = () => action('refresh',() => refreshWorkspace(true)); $('refresh-projects').onclick = () => action('projects',() => showRefresh('项目列表',loadProjects));
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
  $('message-input').oninput = () => { if (state.selectedId) state.drafts.set(state.selectedId,$('message-input').value); resizeInput(); renderControls(); };
  $('message-input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!$('send-message').disabled) sendMessage(); } };
  $('model-select').onchange = e => { state.model = e.target.value; state.effort = defaultEffort(state.model); fillEfforts($('effort-select'),state.model,state.effort); renderControls(); };
  $('effort-select').onchange = e => { state.effort = e.target.value; renderControls(); };
  $('new-model').onchange = e => { fillEfforts($('new-effort'),e.target.value); renderControls(); };
  $('new-thread-form').onsubmit = createThread;
  ['close-new-dialog','cancel-new-dialog'].forEach(id => $(id).onclick = () => $('new-thread-dialog').close());
  $('new-thread-dialog').addEventListener('click',e => { if (e.target === $('new-thread-dialog')) { const b = e.target.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) e.target.close(); } });
  $('toggle-inspector').onclick = () => toggleInspector(); $('close-inspector').onclick = () => toggleInspector(false);
  $('open-sidebar').onclick = () => toggleSidebar();
  $('close-sidebar').onclick = () => { toggleSidebar(false); $('open-sidebar').focus(); };
  $('sidebar-backdrop').onclick = () => { if (window.innerWidth <= 700) toggleSidebar(false); toggleInspector(false); };
  $('toggle-projects').onclick = () => { const show = $('project-list').hidden; $('project-list').hidden = !show; $('toggle-projects').setAttribute('aria-expanded',String(show)); saveLayout('projects',show); };
  document.addEventListener('keydown',e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleSidebar(true); $('thread-search').focus(); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openNewDialog(); } if (e.key === 'Escape') { if (window.innerWidth <= 700) toggleSidebar(false); if (window.innerWidth <= 1050) toggleInspector(false); } });
  toggleSidebar(window.innerWidth > 700 && readLayout('sidebar',true), false);
  toggleInspector(false);
  $('project-list').hidden = !readLayout('projects',true);
  $('toggle-projects').setAttribute('aria-expanded',String(!$('project-list').hidden));
  let narrow = window.innerWidth <= 700;
  window.addEventListener('resize', () => { const next = window.innerWidth <= 700; if (next !== narrow) { narrow = next; toggleSidebar(!next && readLayout('sidebar',true), false); } });
  window.addEventListener('online',() => refreshWorkspace().catch(e => recordError(e,'sync')));
}
async function init() {
  $('messages').addEventListener('click',e=>{
    const summary=e.target.closest('summary');if(!summary)return;
    const detail=summary.closest('details[data-item-id]');if(!detail)return;
    const ids=new Set([...$('messages').querySelectorAll('details[open][data-item-id]')].map(n=>n.dataset.itemId));
    if(detail.open)ids.delete(detail.dataset.itemId);else ids.add(detail.dataset.itemId);
    try{sessionStorage.setItem('rcm.openDetails.'+targetHost+'.'+state.selectedId,JSON.stringify([...ids]));}catch{}
  });
  installBrowserBackup(connectionConfig,()=>{saveView();saveOutputPositions();if(state.selectedId)state.drafts.set(state.selectedId,$('message-input').value);sessionStorage.setItem('rcm.drafts.'+targetHost,JSON.stringify([...state.drafts]));});
  const inspector=$('inspector');
  const navigation=el('nav','inspector-nav');navigation.setAttribute('aria-label','工作区详情分类');
  inspector.querySelector('.inspector-heading').after(navigation);
  const groups=[...inspector.querySelectorAll(':scope > details')];
  const category=group=>group.id==='mobile-access'?'mobile':group.id==='browser-backup'||group.classList.contains('connection-section')||group.id==='diagnostics'||group.querySelector('#task-notifications')?'settings':'session';
  const views=[['session','会话'],['mobile','手机访问'],['settings','设置']];
  function showInspectorView(view){
    groups.forEach(group=>{group.hidden=category(group)!==view;if(!group.hidden&&group.id!=='diagnostics')group.open=true;});
    navigation.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
  }
  for(const [view,title] of views){const button=el('button','',title);button.type='button';button.dataset.view=view;button.onclick=()=>showInspectorView(view);navigation.append(button);}
  showInspectorView('session');
  installMobile(api).catch(e=>{$('mobile-access-body').textContent=messageOf(e);});
  wireEvents(); renderStatus(); renderThread(); renderThreads(); setupEvents();
  if(state.selectedId)restoreDetail(state.selectedId,state.selectionVersion);
  try { const c = await api('/api/csrf'); state.csrf = c.token; await loadStatus(); if (connected()) await refreshWorkspace(); else if (!connectionPending()) await connectRemote(); }
  catch (e) { recordError(e,'init'); const n = $('connection-banner'); n.hidden = false; n.className = 'connection-banner error'; n.textContent = messageOf(e); }
}
try{state.drafts=new Map(JSON.parse(sessionStorage.getItem('rcm.drafts.'+targetHost)||'[]'));}catch{}
init();

$('connection-select').value=targetHost;
$('connection-select').onchange=()=>{voice?.interrupt();rememberHost($('connection-select').value);if(state.selectedId)state.drafts.set(state.selectedId,$('message-input').value);try{sessionStorage.setItem('rcm.drafts.'+targetHost,JSON.stringify([...state.drafts]));}catch{}const url=new URL(location.href);url.searchParams.set('host',$('connection-select').value);location.assign(url);};

const clearRecovery=el('button','text-button','清除日志缓存并重新加载');
clearRecovery.type='button';
clearRecovery.onclick=async()=>{clearRecovery.disabled=true;clearTimeout(cacheSaveTimer);try{await clearDetailCache();location.reload();}catch(e){clearRecovery.disabled=false;toast('无法清除日志缓存：'+messageOf(e),true);}};
$('diagnostics').append(clearRecovery);
