import type {Manager} from '../../../lib/manager.mjs';
import {readAccountUsage} from '../../../lib/account-usage.mjs';

/** Application operations retain the native adapter's data and execution semantics. */
export function createConnectionService(manager:Manager) {
 return {
  status:()=>manager.status(),
  accountUsage:()=>readAccountUsage(manager),
  async models(refresh:boolean) {
   manager.requireConnected();
   return {data:refresh||!manager.models.length?await manager.refreshCatalog('models'):manager.models,nextCursor:null};
  },
  async projects(){return {data:await manager.refreshCatalog('projects')};},
  connect(){Promise.resolve(manager.connect()).catch(()=>{});return manager.status();},
  disconnect:()=>manager.disconnect(),
  acknowledgeNotice:(key:Parameters<Manager['acknowledgeNotice']>[0])=>manager.acknowledgeNotice(key),
  clearDiagnostics:()=>manager.clearDiagnosticHistory(),
  reloadLogin:(data:Parameters<Manager['reloadLogin']>[0])=>manager.reloadLogin(data),
  release:(data:Parameters<Manager['release']>[0])=>manager.release(data),
 };
}
