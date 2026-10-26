import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';

const compress = promisify(gzip);
export function acceptsGzip(header = '') {
  const entries = String(header).split(',').map(part => part.trim().split(';'));
  const entry = entries.find(([name]) => name.toLowerCase() === 'gzip') || entries.find(([name]) => name === '*');
  if (!entry) return false;
  const quality = entry.slice(1).find(value => /^\s*q=/i.test(value));
  return !quality || Number(quality.split('=')[1]) > 0;
}

// Only explicitly mapped assets reach this helper, after authentication checks.
// A per-application cache also notices edits in the development preview.
export function createStaticResponse() {
  const assets = new Map();
  return async (req, res, file) => {
    const info = await stat(file), stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    let cached = assets.get(file);
    if (!cached || cached.stamp !== stamp) {
      const promise = readFile(file).then(async plain => ({plain, packed:plain.length >= 1024 ? await compress(plain) : null,
        tag:createHash('sha256').update(plain).digest('hex')}));
      cached = {stamp, promise}; assets.set(file, cached);
      promise.catch(() => { if (assets.get(file) === cached) assets.delete(file); });
    }
    const asset = await cached.promise;
    const packed = acceptsGzip(req.headers['accept-encoding']) && asset.packed;
    const body = packed || asset.plain;
    const tag = `"${asset.tag}${packed ? '-gzip' : ''}"`;
    const headers = {'Content-Type':file.endsWith('.png') ? 'image/png' : file.endsWith('.webmanifest') ? 'application/manifest+json' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control':'private, no-cache', 'Vary':'Accept-Encoding', 'ETag':tag,
      ...(packed ? {'Content-Encoding':'gzip'} : {})};
    const tags = String(req.headers['if-none-match'] || '').split(',').map(value => value.trim().replace(/^W\//, ''));
    if (tags.includes(tag) || tags.includes('*')) { res.writeHead(304, headers); res.end(); return; }
    res.writeHead(200, {...headers, 'Content-Length':body.length});
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
