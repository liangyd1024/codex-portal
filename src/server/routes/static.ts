import type {IncomingMessage} from 'node:http';
import type {Response} from '../types';
import type {RouteServices} from './dispatch';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {AppError} from '../../../lib/manager.mjs';

const assets:Record<string,string>={'/mermaid-view.js':'mermaid-view.js','/mermaid-frame.html':'mermaid-frame.html','/mermaid-frame.js':'mermaid-frame.js','/vendor/mermaid-12.2.0.js':'vendor/mermaid-12.2.0.js','/deferred-tool.js':'deferred-tool.js','/process-summary.js':'process-summary.js','/turn-files.js':'turn-files.js','/turn-files.css':'turn-files.css','/goal-toolbar.js':'goal-toolbar.js','/queued-inputs.js':'queued-inputs.js','/composer-clipboard.js':'composer-clipboard.js','/response-annotations.js':'response-annotations.js','/selection-tools.css':'selection-tools.css','/side-chat.js':'side-chat.js','/shared/side-chat-events.js':'../shared/side-chat-events.js','/turn-navigation.js':'turn-navigation.js','/turn-navigation.css':'turn-navigation.css','/shared/account-state.js':'../shared/account-state.js','/shared/questions.js':'../shared/questions.js','/shared/connection-state.js':'../shared/connection-state.js','/render-cache.js':'render-cache.js','/feedback.js':'feedback.js','/feedback.css':'feedback.css','/capacity-retry.js':'capacity-retry.js','/system-update.js':'system-update.js','/account-usage.js':'account-usage.js','/login.js':'login.js','/bootstrap.js':'bootstrap.js','/manifest.webmanifest':'manifest.webmanifest','/notification-platform.js':'notification-platform.js','/notification-worker.js':'notification-worker.js','/notification-delivery.js':'notification-delivery.js','/automations.js':'automations.js','/automations.css':'automations.css','/questions.js':'questions.js','/question-form.js':'question-form.js','/message-files.js':'message-files.js','/recovery-state.js':'recovery-state.js','/activity.js':'activity.js','/project-picker.js':'project-picker.js','/project-picker.css':'project-picker.css','/message-media.js':'message-media.js','/message-time.js':'message-time.js','/message-body.js':'message-body.js','/message-dom.js':'message-dom.js','/new-chat.js':'new-chat.js','/new-chat.css':'new-chat.css','/inline-mentions.js':'inline-mentions.js','/skill-suggestions.js':'skill-suggestions.js','/attachments.js':'attachments.js','/goal-submit.js':'goal-submit.js','/composer.js':'composer.js','/composer.css':'composer.css','/':'index.html','/index.html':'index.html','/app.js':'app.js','/mobile-ui.js':'mobile-ui.js','/mobile-ui.css':'mobile-ui.css','/input-state.js':'input-state.js','/thread-sync.js':'thread-sync.js','/thread-handoff.js':'thread-handoff.js','/handoff.css':'handoff.css','/sidebar.js':'sidebar.js','/sidebar.css':'sidebar.css','/browser-backup.js':'browser-backup.js','/connection-state.js':'connection-state.js','/output-window.js':'output-window.js','/detail-cache.js':'detail-cache.js','/styles.css':'styles.css','/voice.js':'voice.js','/mobile.js':'mobile.js'};
const loginAssets=['/','/index.html','/login.js','/styles.css','/mobile-ui.css'];

export function createStaticRoutes({staticRoot,extraAssets,staticResponse}:Pick<RouteServices,'staticRoot'|'extraAssets'|'staticResponse'>) {
 return {
  isLoginAsset:(pathname:string)=>loginAssets.includes(pathname),
  async login(pathname:string,res:Response){
   const file=pathname==='/login.js'?'login.js':pathname==='/styles.css'?'styles.css':pathname==='/mobile-ui.css'?'mobile-ui.css':'login.html';
   res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-store'});
   res.end(await readFile(path.join(staticRoot,file)));
  },
  async read(req:IncomingMessage,res:Response,pathname:string){
   if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('不支持此请求方法。',405);
   if(pathname==='/mermaid-frame.html')res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-scripts");
   const file=extraAssets[pathname]||assets[pathname];
   if(!file){res.writeHead(404);res.end('Not found');return;}
   await staticResponse(req,res,path.join(staticRoot,file));
  },
 };
}
