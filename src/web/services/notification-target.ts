export interface NotificationTarget {host?:string;threadId:string;clickId?:string}
const key='rcm.notification-target';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export function notificationLink(href:string):NotificationTarget|null {
 const url=new URL(href),fragment=new URLSearchParams(url.hash.slice(1));
 const threadId=fragment.get('notification-thread')||url.searchParams.get('thread');
 return threadId?{host:url.searchParams.get('host')||undefined,threadId}:null;
}
export function saveNotificationTarget(storage:Storage,target:NotificationTarget){try{storage.setItem(key,JSON.stringify(target));}catch{}}
export function pendingNotificationTarget(storage:Storage,href:string):NotificationTarget|null {
 const linked=notificationLink(href);if(linked){saveNotificationTarget(storage,linked);return linked;}
 try{const saved=JSON.parse(storage.getItem(key)||'null');return typeof saved?.threadId==='string'&&saved.threadId?saved:null;}catch{return null;}
}
export function consumeNotificationTarget(storage:Storage,target:NotificationTarget,href:string){
 try{const saved=JSON.parse(storage.getItem(key)||'null');if(saved?.host===target.host&&saved?.threadId===target.threadId&&saved?.clickId===target.clickId)storage.removeItem(key);}catch{}
 const url=new URL(href),linked=notificationLink(href);
 if(linked?.threadId===target.threadId&&linked.host===target.host){url.searchParams.delete('thread');const hash=new URLSearchParams(url.hash.slice(1));hash.delete('notification-thread');url.hash=hash.toString();}
 return url.href;
}
