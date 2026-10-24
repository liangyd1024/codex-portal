import type {Server, IncomingMessage, ServerResponse, RequestListener} from 'node:http';
import type {Server as SecureServer, ServerOptions} from 'node:https';
import type {Manager} from '../../lib/manager.mjs';
import type {MobileAccess} from '../../lib/mobile-access.mjs';
import type {WebUpdate} from '../../lib/web-update.mjs';
export interface Host {id:string;machineId:string;kind:'local'|'ssh';alias:string;user:string;home:string;binary:string;address:string;port?:number;identityFile?:string;dataDir?:string;threadUnloadDelaySecs?:number}
export interface Config {formatVersion:1;machineId:string;defaultConnection:string;connections:Host[]}
export interface MobileConfig {origins:string[];ca:string;[key:string]:unknown}
export interface ApplicationOptions {
 serverFactory?:(handler:RequestListener)=>Server;
 proxyFactory?:(handler:RequestListener)=>Server;
 secureFactory?:(options:ServerOptions,handler:RequestListener)=>SecureServer;
 staticRoot?:string; extraAssets?:Record<string,string>; buildVersion?:string;
 mobileConfig?:MobileConfig|null;setupMobile?:((mode:string)=>Promise<MobileConfig>)|null;
 access?:MobileAccess;config?:Config;stateDir?:string;
 managers?:Map<string,Manager>;updater?:WebUpdate;
}
export interface Response extends ServerResponse {allowGzip?:boolean;targetKey?:string;mobileRequest?:IncomingMessage|null;viewId?:string|null}
