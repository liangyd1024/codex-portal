interface CacheDetail {
  recovering?: boolean;
  outputPreview?: boolean;
  thread?: unknown;
  turns?: unknown;
}
interface RecoveryState<D> {
  selectedId: string | null;
  selectionVersion: number;
  detailVersion: number;
  detail?: D | null;
  historyError?: string;
  loadingDetail: boolean;
}
interface RecoveryDependencies<D extends CacheDetail> {
  state: RecoveryState<D>;
  host: string;
  read: (host: string, id: string) => Promise<D | null | undefined>;
  write: (host: string, id: string | null, detail: D) => Promise<unknown>;
  apply: (detail: D, resetModels: boolean) => void;
  defer?: (run: () => Promise<void>, delay: number) => unknown;
  cancel?: (timer: unknown) => void;
}

/** Optional local snapshots must never displace a newer network or selection state. */
export function createDetailRecovery<D extends CacheDetail>({state,host,read,write,apply,
  defer=(run,delay)=>setTimeout(run,delay),
  cancel=timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
}: RecoveryDependencies<D>) {
  let timer: unknown, writing=false, lastStamp='';
  function saveSoon(): void {
    if(timer||writing)return;
    timer=defer(async()=>{
      timer=null;
      const detail=state.detail,id=state.selectedId;
      if(!detail||detail.recovering||detail.outputPreview)return;
      // Keep the baseline signature: large output bodies are not copied on every SSE refresh.
      const stamp=JSON.stringify([id,detail.thread,detail.turns],(key,value)=>['aggregatedOutput','outputCompressed'].includes(key)?undefined:value);
      if(stamp===lastStamp)return;
      writing=true;
      try{await write(host,id,detail);lastStamp=stamp;}
      finally{writing=false;}
    },5000);
  }
  async function restore(id: string,selection: number): Promise<void> {
    const version=state.detailVersion;
    const cached=await read(host,id);
    if(!cached||id!==state.selectedId||selection!==state.selectionVersion||version!==state.detailVersion||state.detail||state.historyError)return;
    state.loadingDetail=false;apply(cached,true);
  }
  // Baseline cancellation leaves the handle set; a failed clear must not resume writes.
  return {saveSoon,restore,cancelScheduled:()=>cancel(timer)};
}
