import type {Manager} from '../../../lib/manager.mjs';
import type {Response} from '../types';
import {body,json} from '../protocol';
import {respondToRequest} from '../services/requests';

export function matchRequestRoute(path:string) {
 return path.match(/^\/api\/requests\/([^/]+)\/respond$/);
}

// Dispatch only after the original authentication and body reader have run.
export function respondRequest(manager:Manager,match:RegExpMatchArray,data:Awaited<ReturnType<typeof body>>,res:Response) {
 return json(res,200,respondToRequest(manager,decodeURIComponent(match[1]!),data));
}
