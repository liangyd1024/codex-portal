interface EventConnectionDependencies {
  lifecycle?: {window:Window;document:Document};
  state: {eventSource?: EventSource | null; transport: boolean; transportRecovering?:boolean};
  url: () => string;
  createSource: (url: string) => EventSource;
  resetThreadView: () => void;
  reconnectSideChat: () => void;
  renderStatus: () => void;
  reportThreadView: () => Promise<unknown>;
  resumeWorkspace: () => Promise<unknown>;
  recordError: (error: unknown, stage: string) => void;
  receiveConfiguration?:(data:unknown)=>void;
  receiveWebUpdate: (data: unknown) => void;
  handleEvent: (event: MessageEvent<string>) => void;
}

// Keep transport recovery separate from native manager/status recovery.
export function createEventConnection(deps: EventConnectionDependencies) {
  let installed=false, suspended=false, lastEvent=Date.now(), lastReconnect=0;
  let recoveryTimer:ReturnType<typeof setTimeout>|undefined;
  let errorTimer:ReturnType<typeof setTimeout>|undefined, failures=0;
  let watchdog:ReturnType<typeof setInterval>|undefined;
  const active=()=>!deps.lifecycle?.document.hidden&&deps.lifecycle?.window.navigator.onLine!==false;
  function reconnect(){
    if(!active()||Date.now()-lastReconnect<1000)return;
    lastReconnect=Date.now();suspended=false;
    deps.state.transport=false;deps.state.transportRecovering=true;clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>{deps.state.transportRecovering=false;deps.renderStatus();},8000);setupEvents();deps.renderStatus();
  }
  function setupEvents() {
    if(deps.lifecycle&&!installed){
      installed=true;const {window,document}=deps.lifecycle;
      const pause=()=>{suspended=true;clearInterval(watchdog);clearTimeout(errorTimer);errorTimer=undefined;};
      const resume=()=>{if(!active())return;if(suspended||!deps.state.transport||Date.now()-lastEvent>45000)reconnect();clearInterval(watchdog);watchdog=setInterval(()=>{if(active()&&Date.now()-lastEvent>45000)reconnect();},15000);};
      document.addEventListener('visibilitychange',()=>document.hidden?pause():resume());
      window.addEventListener('pagehide',pause);window.addEventListener('pageshow',resume);
      window.addEventListener('offline',()=>{pause();deps.state.transport=false;deps.renderStatus();});
      window.addEventListener('online',resume);window.addEventListener('focus',resume);
      watchdog=setInterval(()=>{if(active()&&Date.now()-lastEvent>45000)reconnect();},15000);
    }
    clearTimeout(errorTimer);errorTimer=undefined;
    const {state} = deps;
    state.eventSource?.close?.();
    lastEvent=Date.now();
    const es = deps.createSource(deps.url());
    state.eventSource = es;
    es.onopen = () => {
      if(state.eventSource!==es)return;
      lastEvent=Date.now();failures=0;clearTimeout(errorTimer);errorTimer=undefined;
      deps.resetThreadView();
      deps.reconnectSideChat();
      const restored = !state.transport;
      state.transport = true;state.transportRecovering=false;clearTimeout(recoveryTimer);
      deps.renderStatus();
      void deps.reportThreadView().catch(e => deps.recordError(e, 'thread'));
      if (restored) deps.resumeWorkspace().catch(e => {
        deps.recordError(e, 'sync');
        deps.renderStatus();
      });
    };
    es.addEventListener('system/update', event => {
      if (state.eventSource === es) deps.receiveWebUpdate(JSON.parse((event as MessageEvent<string>).data));
    });
    es.addEventListener('configuration/change',event=>{if(state.eventSource===es)deps.receiveConfiguration?.(JSON.parse((event as MessageEvent<string>).data));});
    es.addEventListener('heartbeat',()=>{if(state.eventSource===es)lastEvent=Date.now();});
    es.onmessage = event=>{if(state.eventSource===es){lastEvent=Date.now();deps.handleEvent(event);}};
    for (const name of ['manager/status', 'manager/error', 'manager/request', 'manager/requestResolved']) {
      es.addEventListener(name, es.onmessage as EventListener);
    }
    es.onerror = () => {
      if(state.eventSource!==es)return;
      state.transport=false;deps.renderStatus();
      // Native EventSource may remain CLOSED after an HTTP/proxy failure.
      // Give its own retry a chance, then replace only this failed stream.
      if(deps.lifecycle&&active()&&!errorTimer)errorTimer=setTimeout(()=>{
        errorTimer=undefined;if(state.eventSource===es&&!state.transport)reconnect();
      },Math.min(15000,3000*2**Math.min(failures++,3)));
    };
  }
  return setupEvents;
}
