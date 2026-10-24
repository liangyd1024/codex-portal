import type {Manager} from '../../../lib/manager.mjs';
import {AppError} from '../../../lib/manager.mjs';
import type {WebUpdate} from '../../../lib/web-update.mjs';
import {deploymentStatus} from '../../../lib/deployment-status.mjs';
import {publicHost} from '../../../lib/config.mjs';
import type {Config,ApplicationOptions} from '../types';

export interface SystemServices {
 config:Config;managers:Map<string,Manager>;updater:WebUpdate;buildVersion:string;
 providedManagers:ApplicationOptions['managers'];
}
export function createSystemService({config,managers,updater,buildVersion,providedManagers}:SystemServices) {
 return {
  connections:()=>({machineId:config.machineId,defaultConnection:config.defaultConnection,data:[...managers].map(([id,m])=>({id,host:publicHost(m.host),connection:m.connection}))}),
  version:()=>({version:buildVersion,machineId:config.machineId}),
  async updateStatus(check:boolean){if(check)void updater.checkLatest?.().catch(()=>{});return await updater.status();},
  async startUpdate(data:object,port:number|undefined){
   if(port!==4317&&!providedManagers)throw new AppError('开发预览不能更新正式服务。',409);
   if(Object.keys(data).length)throw new AppError('更新接口不接受仓库、版本或会话参数。');
   return await updater.start();
  },
  deployment:(manager:Manager)=>deploymentStatus(manager),
 };
}
