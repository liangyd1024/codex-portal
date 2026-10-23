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
  // Compatibility routes parse and serialize through the baseline protocol layer.
  // Fail closed if a future route accidentally requests schema compilation, instead
  // of loading unused compilers or silently changing coercion/response semantics.
  const unsupportedSchema=()=>{throw new Error('兼容路由不支持 Schema 编译，请使用原协议校验。');};
  const options={logger:false as const,exposeHeadRoutes:false,
    schemaController:{compilersFactory:{buildValidator:unsupportedSchema,buildSerializer:unsupportedSchema}},
    ajv:{customOptions:{coerceTypes:false,useDefaults:false,removeAdditional:false}},
    routerOptions:{maxParamLength:16384,onBadUrl:(_url:string,req:IncomingMessage,res:ServerResponse)=>handler(req,res)}};
  return tls?install(Fastify({...options,https:tls}),handler):install(Fastify(options),handler);
}
