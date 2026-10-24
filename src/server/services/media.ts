import type {Manager} from '../../../lib/manager.mjs';

/** Preserve native transfer handles, cancellation signals and complete image results. */
export function createMediaService(manager:Manager) {
 return {
  openFile:(...args:Parameters<Manager['openFile']>)=>manager.openFile(...args),
  toolItem:(...args:Parameters<Manager['toolItem']>)=>manager.toolItem(...args),
  image:(...args:Parameters<Manager['image']>)=>manager.image(...args),
 };
}
