import type {SidebarSnapshot,SidebarThread} from './sidebar';
export interface RunningRow {thread:SidebarThread;waiting:boolean;uncertain:boolean}
export interface RunningView {rows:RunningRow[];count:number;pending:boolean;uncertain:boolean}
// Keep arrival order within each priority, independent of recency changes.
export class RunningFilter {
 private order=new Map<string,number>();
 private previous=new Set<string>();
 private scope='';
 read(snapshot:SidebarSnapshot,{connected,source,waiting,failed=false}:{connected:boolean;source:(t:SidebarThread)=>string|null;waiting:(t:SidebarThread)=>boolean;failed?:boolean},now=Date.now()):RunningView {
  if(this.scope!==snapshot.accountScope){this.scope=snapshot.accountScope;this.order.clear();this.previous.clear();}
  const pending=connected&&!failed&&(snapshot.activityPhase==='loading'||snapshot.activityPhase===undefined);
  let uncertain=!connected||failed||snapshot.activityPhase==='error'||!!snapshot.nextCursor;
  const rows:RunningRow[]=[];
  for(const thread of snapshot.data){
   if(thread.archived)continue;
   const activity=thread.activity as {state?:string;observedAt?:number}|undefined;
   const question=connected&&waiting(thread),running=connected&&!!source(thread);
   const age=now-(activity?.observedAt??NaN);
   const stale=!!activity&&activity.state!=='unknown'&&(!Number.isFinite(age)||age<0||age>=30000);
   const unknown=!connected||failed||snapshot.activityPhase==='error'||(!running&&!question&&(activity?.state==='unknown'||stale));
   uncertain ||= unknown;
   if(!question&&!running&&!((unknown||pending)&&this.previous.has(thread.id)))continue;
   if(!this.order.has(thread.id))this.order.set(thread.id,this.order.size);
   rows.push({thread,waiting:question,uncertain:!question&&!running});
  }
  rows.sort((a,b)=>Number(b.waiting)-Number(a.waiting)||this.order.get(a.thread.id)!-this.order.get(b.thread.id)!);
  this.previous=new Set(rows.map(r=>r.thread.id));
  return {rows,count:rows.filter(r=>!r.uncertain).length,pending,uncertain};
 }
}
