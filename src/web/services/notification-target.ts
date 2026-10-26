export interface NotificationTarget {host?:string;threadId:string;clickId?:string}
const key='rcm.notification-target';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export function notificationLink(href:string):NotificationTarget|null {
 const url=new URL(href),fragment=new URLSearchParams(url.hash.slice(1));
 const threadId=fragment.get('notification-thread')||url.searchParams.get('thread');
 return threadId?{host:url.searchParams.get('host')||undefined,threadId,...(url.searchParams.get('notification-click')?{clickId:url.searchParams.get('notification-click')!}:{})}:null;
}
export function saveNotificationTarget(storage:Storage,target:NotificationTarget){try{storage.setItem(key,JSON.stringify(target));}catch{}}
export function pendingNotificationTarget(storage:Storage,href:string):NotificationTarget|null {
 const linked=notificationLink(href);if(linked){
  // A URL without a click receipt must not erase the receipt already delivered by the worker.
  try{const saved=JSON.parse(storage.getItem(key)||'null');if(!linked.clickId&&saved?.host===linked.host&&saved?.threadId===linked.threadId)linked.clickId=saved.clickId;}catch{}
  saveNotificationTarget(storage,linked);return linked;
 }
 try{const saved=JSON.parse(storage.getItem(key)||'null');return typeof saved?.threadId==='string'&&saved.threadId?saved:null;}catch{return null;}
}
export function consumeNotificationTarget(storage:Storage,target:NotificationTarget,href:string){
 try{const saved=JSON.parse(storage.getItem(key)||'null');if(saved?.host===target.host&&saved?.threadId===target.threadId&&saved?.clickId===target.clickId)storage.removeItem(key);}catch{}
 const url=new URL(href),linked=notificationLink(href);
 if(!linked&&target.clickId&&url.searchParams.get('notification-click')===target.clickId)url.searchParams.delete('notification-click');
 if(linked?.threadId===target.threadId&&linked.host===target.host){url.searchParams.delete('thread');url.searchParams.delete('notification-click');const hash=new URLSearchParams(url.hash.slice(1));hash.delete('notification-thread');url.hash=hash.toString();}
 return url.href;
}

export function notificationTargetUrl(href:string,target:NotificationTarget){
 const url=new URL(href);url.searchParams.delete('notification-click');
 url.searchParams.set('host',target.host!);url.searchParams.set('thread',target.threadId);
 const hash=new URLSearchParams(url.hash.slice(1));hash.delete('notification-thread');url.hash=hash.toString();
 if(target.clickId)url.searchParams.set('notification-click',target.clickId);
 return url.href;
}
