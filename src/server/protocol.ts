import {gzip} from 'node:zlib';
import type {IncomingMessage} from 'node:http';
import type {Response} from './types';
import {AppError} from '../../lib/manager.mjs';
export function json(res:Response,status:number,data:unknown){
    const text=JSON.stringify(data),headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding'};
    if(res.allowGzip&&text.length>65536){gzip(text,{level:1},(error,packed)=>{if(res.destroyed)return;if(error){res.writeHead(status,headers);res.end(text);}else{res.writeHead(status,{...headers,'Content-Encoding':'gzip'});res.end(packed);}});return;}
    res.writeHead(status,headers);res.end(text);
  }
export async function body(req:IncomingMessage,limit=1024*1024){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AppError('请求过大。',413);chunks.push(chunk);}const text=Buffer.concat(chunks).toString('utf8');try{return text?JSON.parse(text):{};}catch{throw new AppError('请求不是有效的 JSON。');}}
