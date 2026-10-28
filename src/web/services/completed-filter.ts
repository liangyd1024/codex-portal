import type {SidebarSnapshot,SidebarThread} from './sidebar';
/** Same receipts as the row badge; filtering never marks a conversation viewed. */
export function completedThreads(snapshot:SidebarSnapshot,source:(t:SidebarThread)=>string|null,waiting:(t:SidebarThread)=>boolean):SidebarThread[]{
 if(snapshot.archived)return [];
 return snapshot.data.filter(t=>t.completionUnseen===true&&!t.archived&&!source(t)&&!waiting(t));
}
