import {creationSource} from '../../../public/activity.js';
import type {Sidebar,SidebarThread,SidebarProject,SidebarSection} from './sidebar';
export type Thread=SidebarThread;
export type Project=SidebarProject;
export type Section=SidebarSection;
export interface MenuEntry {label:string;hidden?:boolean;disabled?:boolean;reason?:string;run?:()=>unknown}
export type Item={kind:'thread';value:Thread}|{kind:'project';value:Project;children:Item[]};
export interface Group {id:string;name:string;section?:Section;items:Item[]}
export type Controller=Sidebar;
export interface Badge {className:string;title:string;icon?:string;count?:number}
export function activitySummary(items:Item[],source:(thread:Thread)=>string|null,needsAnswer?:(id:string)=>boolean):Badge[]{
 const counts=new Map<string,number>();let waiting=0,completed=0;
 const visit=(item:Item)=>{if(item.kind==='project'){item.children.forEach(visit);return;}if(needsAnswer?.(item.value.id)){waiting++;return;}const value=source(item.value);if(value)counts.set(value,(counts.get(value)||0)+1);else if(item.value.completionUnseen)completed++;};
 items.forEach(visit);const badges:Badge[]=[];
 if(waiting)badges.push({className:'activity-icon activity-question',title:waiting+' 个会话需要你回答',icon:'question',count:waiting});
 if(counts.size){const total=[...counts.values()].reduce((sum,count)=>sum+count,0);badges.push({className:'activity-icon activity-running activity-summary',title:total+' 个会话运行中（'+[counts.has('web')?'网页端 '+counts.get('web'):'',counts.has('desktop')?'桌面端 '+counts.get('desktop'):'',counts.has('cli')?'CLI '+counts.get('cli'):''].filter(Boolean).join('，')+'）',count:total});}
 if(completed)badges.push({className:'activity-icon activity-completed',title:completed+' 个会话已完成，待查看',icon:'check',count:completed});
 return badges;
}
function threadBadge(thread:Thread,running:string|null,waiting:boolean):Badge{
 if(waiting)return {className:'activity-icon activity-question',title:'需要你回答',icon:'question'};
 if(!running&&thread.completionUnseen)return {className:'activity-icon activity-completed',title:'已完成，待查看',icon:'check'};
 const created=creationSource(thread),source=running||created;
 return {className:'activity-icon activity-'+source+(running?' activity-running':''),title:({web:'网页端创建',desktop:'桌面端创建',unknown:'创建来源未知'})[created]+(running?' · '+(running==='cli'?'CLI':running==='web'?'网页端':'桌面端')+'正在运行':''),icon:source==='cli'?'terminal':source==='desktop'?'monitor':source==='web'?'globe':'mark'};
}
export interface ThreadView {kind:'thread';raw:Thread;name:string;time:string;context?:string;selected:boolean;unread:boolean;badge:Badge;menu:boolean;draggable:boolean}
export interface ProjectView {kind:'project';raw:Project;expanded:boolean;badges:Badge[];children:ItemView[];createDisabled:boolean}
export type ItemView=ThreadView|ProjectView;
export interface GroupView {id:string;name:string;section?:Section;expanded:boolean;badges:Badge[];items:ItemView[];menu:boolean;menuLabel:string}
export function treePresentation(groups:Group[],c:Controller):GroupView[]{
 const waiting=(t:Thread)=>c.waiting?c.waiting(t):!!c.o.needsAnswer?.(t.id);
 const byId=new Map(c.snapshot?.data?.map(t=>[t.id,t])||[]);
 const summary=(items:Item[])=>activitySummary(items,t=>c.source(t),id=>byId.has(id)?waiting(byId.get(id)!):!!c.o.needsAnswer?.(id));
 const runningRows=new Map(c.runningView?.rows.map(r=>[r.thread.id,r])||[]);
 const projects=new Map(c.snapshot?.projects?.map(p=>[p.id,p.name])||[]);
 const itemView=(item:Item):ItemView=>{
  if(item.kind==='project')return {kind:'project',raw:item.value,expanded:c.isExpanded('project:'+item.value.id),badges:c.isExpanded('project:'+item.value.id)?[]:summary(item.children),children:item.children.map(itemView),createDisabled:!c.o.connected()||!item.value.roots[0]};
  const t=item.value;
  const row=runningRows.get(t.id);
  const context=c.completed?[projects.get(t.projectId||'')||'未关联项目','已完成，待查看'].join(' · '):c.running?[projects.get(t.projectId||'')||'未关联项目',row?.uncertain?'状态待确认':waiting(t)?'需要你回答':'正在运行'].join(' · '):undefined;
  return {kind:'thread',raw:t,name:c.o.threadName(t),context,time:c.o.relativeTime(t.recencyAt||t.updatedAt),selected:c.o.selectedId()===t.id,unread:!!t.isUnread,badge:threadBadge(t,c.source(t),waiting(t)),menu:c.threadMenu(t).some(e=>!e.hidden),draggable:!c.running&&!c.completed&&!!(t.isPinned&&c.snapshot!.preferences.pinned==='manual'&&c.snapshot!.capabilities.reorderThread.supported&&!c.snapshot!.archived)};
 };
 return groups.flatMap(group=>{const items=group.items.filter(i=>!c.view!.search||i.kind==='thread'||i.children.length);if(c.view!.search&&!items.length)return[];const badges=c.isExpanded('section:'+group.id)?[]:summary(group.items);return[{id:group.id,name:group.name,section:group.section,expanded:c.isExpanded('section:'+group.id),badges,items:items.map(itemView),menu:!!group.section&&c.sectionMenu(group.section).some(e=>!e.hidden),menuLabel:group.name+badges.map(b=>b.count??'').join('')}];});
}
