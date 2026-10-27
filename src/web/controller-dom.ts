/** Required shell nodes; dynamic feedback IDs remain nullable. No node cache. */
export interface ControllerElementTags {
 'app-shell':'div';
 'auto-refresh':'input';
 'breadcrumb-project':'span';
 'close-inspector':'button';
 'close-sidebar':'button';
 'composer-availability':'p';
 'composer-hint':'span';
 'composer-model-label':'span';
 'composer-settings':'details';
 'control-badge':'span';
 'control-note':'div';
 'control-overview':'p';
 'conversation':'section';
 'conversation-requests':'div';
 'effort-select':'select';
 'inspector':'aside';
 'message-form':'form';
 'message-input':'textarea';
 'messages':'div';
 'messages-scroller':'div';
 'model-select':'select';
 'model-selection-note':'div';
 'more-threads':'button';
 'new-chat-page':'section';
 'new-composer-slot':'div';
 'new-cwd':'select';
 'new-thread':'button';
 'open-sidebar':'button';
 'project-list':'nav';
 'refresh-all':'button';
 'running-indicator':'div';
 'send-message':'button';
 'sidebar-backdrop':'div';
 'takeover':'button';
 'thread-list':'div';
 'thread-path':'p';
 'thread-search':'input';
 'thread-title':'h1';
 'toasts':'div';
 'toggle-inspector':'button';
 'welcome':'section';
 'welcome-footnote':'span';
}
export type ControllerElements={[K in keyof ControllerElementTags]:HTMLElementTagNameMap[ControllerElementTags[K]]};
interface ControllerLookup {
 <K extends keyof ControllerElements>(id:K):ControllerElements[K];
 (id:string):HTMLElement|null;
}
// Required IDs are checked against the shell; dynamic IDs keep the nullable result.
export const controllerElement=((id:string)=>document.getElementById(id)) as ControllerLookup;
export function el<K extends keyof HTMLElementTagNameMap>(tag:K,className?:string,content?:unknown):HTMLElementTagNameMap[K]{
 const n=document.createElement(tag);if(className)n.className=className;if(content!=null)n.textContent=String(content);return n;
}
export function icon(name:string,extra=''):SVGSVGElement{
 const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class','icon'+(extra?' '+extra:''));s.setAttribute('aria-hidden','true');
 const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#i-'+name);s.append(u);return s;
}
export function clear<T extends Element>(node:T):T{node.replaceChildren();return node;}
export function setText(id:keyof ControllerElements,value:unknown):void{
 const node=controllerElement(id),text=value==null||value===''?'—':String(value);if(node.textContent!==text||node.childElementCount)node.textContent=text;
}
