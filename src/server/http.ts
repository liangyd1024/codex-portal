import Fastify, {type FastifyInstance} from 'fastify';
import type {IncomingMessage, RequestListener, Server, ServerResponse} from 'node:http';
import type {ServerOptions as TLSOptions, Server as SecureServer} from 'node:https';
export interface HttpFramework<S=Server|SecureServer> {server:S;ready():Promise<void>;close():Promise<void>}
function install<S extends Server|SecureServer>(app:FastifyInstance<S>,handler:RequestListener):HttpFramework<S>{
  app.addHook('onRequest',(request,reply,_done)=>{
    reply.hijack();
    // Both HTTP/1 listeners use Node IncomingMessage / ServerResponse; HTTP/2 is disabled.
    const rawRequest=request.raw as IncomingMessage,rawReply=reply.raw as ServerResponse;
    Promise.resolve(handler(rawRequest,rawReply)).catch(error=>{
      if(rawReply.headersSent){rawReply.destroy(error instanceof Error?error:undefined);return;}
      rawReply.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});
      rawReply.end(JSON.stringify({error:{message:'网页服务处理失败。',code:'INTERNAL_ERROR'}}));
    });
  });
  app.all('/*',(_request,reply)=>reply.code(404).send());
  return {server:app.server,async ready(){await app.ready();},async close(){await app.close();}};
}
export function createHttpFramework(handler:RequestListener):HttpFramework<Server>;
export function createHttpFramework(handler:RequestListener,tls:TLSOptions):HttpFramework<SecureServer>;
export function createHttpFramework(handler:RequestListener,tls?:TLSOptions):HttpFramework{
  const options={logger:false as const,exposeHeadRoutes:false,
    ajv:{customOptions:{coerceTypes:false,useDefaults:false,removeAdditional:false}},
    routerOptions:{maxParamLength:16384,onBadUrl:(_url:string,req:IncomingMessage,res:ServerResponse)=>handler(req,res)}};
  return tls?install(Fastify({...options,https:tls}),handler):install(Fastify(options),handler);
}
