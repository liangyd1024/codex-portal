import type {Manager} from '../../../lib/manager.mjs';

// Keep native validation, resolution and publication in the existing adapter.
export function respondToRequest(manager:Manager,key:Parameters<Manager['respond']>[0],data:Parameters<Manager['respond']>[1]) {
 return manager.respond(key,data);
}
