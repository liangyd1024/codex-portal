export {PreviewMobileAccess} from './preview-access';
import {createApp} from './core';
import {createHttpFramework, type HttpFramework} from './http';
import type {RequestListener} from 'node:http';
import type {ServerOptions as TLSOptions} from 'node:https';
export type ApplicationOptions = NonNullable<Parameters<typeof createApp>[0]>;

/** A single set of target adapters is shared by all three entrance listeners. */
export async function createFrameworkApp(options: ApplicationOptions = {}) {
  const frameworks: HttpFramework[]=[];
  const factory=(handler:RequestListener)=>{
    const framework=createHttpFramework(handler);frameworks.push(framework);return framework.server;
  };
  const core=createApp({...options,serverFactory:factory,proxyFactory:factory,
    secureFactory:(tls:TLSOptions,handler:RequestListener)=>{
      const framework=createHttpFramework(handler,tls);frameworks.push(framework);return framework.server;
    }});
  await Promise.all(frameworks.map(framework=>framework.ready()));
  return {...core,ready:()=>Promise.all(frameworks.map(framework=>framework.ready())),
    async close(){core.closeStreams();await Promise.all(frameworks.map(framework=>framework.close()));}};
}
