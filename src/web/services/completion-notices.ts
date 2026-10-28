interface Turn {id:string;status:string}
interface Entry {turn:Turn;unseen:boolean}
interface Storage {getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void}
/** Portal display receipts only. Never changes Codex read state or history. */
export function createCompletionNotices(storage:Storage,host:string){
 let scope='',entries=new Map<string,Entry>();
 const key=()=> 'rcm.completionNotices.'+JSON.stringify([host,scope]);
 const save=()=>{try{storage.setItem(key(),JSON.stringify([...entries]));}catch{}};
 return {
  scope(account:string){
   if(scope===account)return;scope=account;entries=new Map();
   try{const saved=JSON.parse(storage.getItem(key())||'[]');if(Array.isArray(saved))for(const row of saved)if(Array.isArray(row)&&typeof row[0]==='string'&&typeof row[1]?.turn?.id==='string'&&typeof row[1]?.turn?.status==='string'&&typeof row[1]?.unseen==='boolean')entries.set(row[0],row[1]);}catch{}
  },
  update(threads:{id:string;latestTurn?:unknown}[],viewed?:{id:string;turnId:string}){
   let changed=false;
   for(const thread of threads){
    const turn=thread.latestTurn as Turn|undefined;if(!turn?.id||typeof turn.status!=='string')continue;
    const old=entries.get(thread.id);
    let unseen=old?.unseen||false;
    if(!old)unseen=false; // First encounter establishes a baseline, not historical alerts.
    else if(old.turn.id!==turn.id||old.turn.status!==turn.status)unseen=turn.status==='completed';
    if(viewed?.id===thread.id&&viewed.turnId===turn.id)unseen=false;
    if(!old||old.turn.id!==turn.id||old.turn.status!==turn.status||old.unseen!==unseen){entries.delete(thread.id);entries.set(thread.id,{turn:{id:turn.id,status:turn.status},unseen});changed=true;}
   }
   // Bound browser storage; old evicted rows establish a fresh baseline on return.
   while(entries.size>3000){entries.delete(entries.keys().next().value!);changed=true;}
   if(changed)save();
  },
  has(id:string){return entries.get(id)?.unseen===true;},
 };
}
