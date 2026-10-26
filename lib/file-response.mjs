import {pipeline} from 'node:stream/promises';

export async function fileResponse(manager,req,res,threadId,itemId,url) {
  const mode=url.searchParams.get('mode')||'content';
  if(!['meta','content','text','download'].includes(mode))throw Object.assign(new Error('文件操作无效。'),{status:400});
  const controller=new AbortController();
  const abort=()=>controller.abort();res.once('close',abort);
  let transfer;
  try {
    transfer=await manager.openFile(threadId,itemId,{reference:url.searchParams.get('reference'),mode,range:req.headers.range,ifRange:req.headers['if-range'],head:req.method==='HEAD'},{signal:controller.signal});
    if(res.destroyed){transfer.cancel();return;}
    const {meta,body}=transfer;
    if(meta.error){
      transfer.cancel();body.destroy();
      if(meta.status===416)res.setHeader('Content-Range',`bytes */${meta.size}`);
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.writeHead(meta.status||502);
      res.end(req.method==='HEAD'?undefined:JSON.stringify({error:{message:meta.error,retryable:meta.retryable??(meta.status>=500)}}));return;
    }
    if(!Number.isSafeInteger(meta.size)||meta.size<0||!Number.isSafeInteger(meta.length)||meta.length<0)throw new Error('文件响应无效。');
    res.setHeader('Cache-Control','no-store');
    if(mode==='meta'){
      body.resume();res.setHeader('Content-Type','application/json; charset=utf-8');res.end(req.method==='HEAD'?undefined:JSON.stringify(meta));return;
    }
    const download=mode==='download'||meta.kind==='download';
    res.setHeader('Content-Type',download?'application/octet-stream':meta.mime);
    res.setHeader('Content-Disposition',`${download?'attachment':'inline'}; filename="file"; filename*=UTF-8''${encodeURIComponent(meta.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`);
    // Only passive PDF content may be framed. HTML/SVG are text/plain, never a
    // same-origin document with scripts. No weakening of the application CSP.
    res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox; frame-ancestors 'self'");
    res.setHeader('Content-Length',meta.length);
    if(mode!=='text'){
      res.setHeader('Accept-Ranges','bytes');res.setHeader('ETag',meta.etag);
      if(meta.status===206)res.setHeader('Content-Range',`bytes ${meta.start}-${meta.end}/${meta.size}`);
    }
    res.writeHead(meta.status);
    if(req.method==='HEAD'){body.resume();res.end();return;}
    await pipeline(body,res);
  } finally {
    res.off('close',abort);transfer?.cancel();
  }
}
