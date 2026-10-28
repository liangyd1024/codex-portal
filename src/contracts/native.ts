/** Known fields consumed by the workspace. Unknown native fields are retained. */
export type NativeStatus = string | {type?: string;[field:string]:unknown} | null;
export interface NativeItem {id?:string;type:string;status?:NativeStatus;text?:string;aggregatedOutput?:string;summary?:string[];content?:unknown;localAccepted?:boolean;name?:string;tool?:string;durationMs?:number;changes?:{path?:string;kind?:string|{type?:string};diff?:string}[];[field:string]:unknown}
export interface NativeTurn {id?:string;collaborationMode?:{mode:'default'|'plan'};status?:NativeStatus;items:NativeItem[];error?:unknown;startedAt?:number;createdAt?:number;model?:string;effort?:string;reasoningEffort?:string;modelInfo?:{model?:string;reasoningEffort?:string};[field:string]:unknown}
export interface NativeThread {id:string;name?:string;title?:string;preview?:string;cwd?:string;status?:NativeStatus;turns?:NativeTurn[];pendingRequests?:unknown;lastTurnStatus?:string;historySource?:string;model?:string;effort?:string;projectId?:string|null;archived?:boolean;[field:string]:unknown}
export interface NativeProject {id:string;name?:string;roots:string[];[field:string]:unknown}
export interface NativeRequest {id?:unknown;key?:string;kind?:string;threadId?:string;method?:string;params?:{threadId?:string;turnId?:unknown;itemId?:unknown;questions?:{id:string;header?:string;question?:string;options?:{label?:string;value?:string;description?:string}[];isOther?:boolean;isSecret?:boolean}[];[field:string]:unknown};[field:string]:unknown}
export interface NativeHandoff {threadId?:string;state?:string;[field:string]:unknown}
export interface NativeGoal {createdAt?:number;updatedAt?:number;timeUsedSeconds?:number;objective:string;status?:string;[field:string]:unknown}
export interface NativeDetail {
 resumeWarning?:string|null;thread?:NativeThread;turns?:NativeTurn[];pendingRequests?:NativeRequest[];controlled?:boolean;recovering?:boolean;historySource?:string;handoff?:NativeHandoff|null;
 queue?:{data?:{id:string;input?:{type:string;text?:string;[field:string]:unknown}[];[field:string]:unknown}[];[field:string]:unknown};goal?:NativeGoal|null;goalError?:unknown;controlState?:string;nextCursor?:string|null;historyCursor?:string|null;totalTurns?:number;
 desktop?:{settings?:{model:string;reasoningEffort?:string|null;[field:string]:unknown}|null;available?:boolean;canSend?:boolean;threadReferencesSupported?:boolean;error?:string;receipts?:Record<string,{status?:string;[field:string]:unknown}>;[field:string]:unknown};
 backgroundTerminals?:{data?:unknown[];error?:string;[field:string]:unknown};[field:string]:unknown;
}
export interface NativeConnectionStatus {
 instanceId?:string;revision?:number;loginRecovery?:string;subscribedThreads?:string[];recoveryFailures?:{threadId?:string;message?:string}[];errors?:{time?:number|string;stage?:string;message?:string}[];
 connection?:{state?:string;stage?:string;error?:unknown;connectedAt?:string;[field:string]:unknown};
 host?:{alias?:string;hostname?:string;user?:string;version?:string;[field:string]:unknown};
 service?:{version?:string;running?:boolean;releasing?:boolean;protocolValidation?:{status?:string;features?:Record<string,{supported?:boolean;reason?:string;[field:string]:unknown}>;[field:string]:unknown};[field:string]:unknown};
 controlledThreads?:string[];controlledSessions?:NativeThread[];handoffs?:NativeHandoff[];pendingRequests?:NativeRequest[];[field:string]:unknown;
}

export type NativeTurnGroup = {type:'message';item:NativeItem}|{type:'process';key:string|number;items:NativeItem[];durationLabel?:string}|{type:'duration';label:string};
