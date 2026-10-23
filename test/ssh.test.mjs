import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {decodeRemoteResult,execute,sshArgs} from '../lib/ssh.mjs';

test('compressed transport preserves a large Unicode history record without truncation',()=>{
  const value={data:[{text:'完整记录🧪\n'.repeat(700000)}],historySource:'snapshot'};
  const raw=JSON.stringify(value),compressed=deflateSync(Buffer.from(raw));
  assert.ok(compressed.length<Buffer.byteLength(raw)/20);
  assert.deepEqual(decodeRemoteResult('shell notice\nRCM_ZJSON:'+compressed.toString('base64')+'\n'),value);
});
test('legacy structured SSH results still work and remote errors stay explicit',()=>{
  assert.deepEqual(decodeRemoteResult('RCM_JSON:{"ok":true}\n'),{ok:true});
  assert.throws(()=>decodeRemoteResult('unstructured'),/有效结果/);
  const compressed=deflateSync(Buffer.from('{"error":"字段已变化"}')).toString('base64');
  assert.throws(()=>decodeRemoteResult('RCM_ZJSON:'+compressed),/字段已变化/);
});
test('subprocess UTF-8 output waits for pipe close and survives split character bytes',async()=>{
  const result=await execute(process.execPath,['-e',"const b=Buffer.from('中文🧪');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.end(b.subarray(2)),10)"]);
  assert.equal(result.stdout,'中文🧪');
});
test('owned tunnel uses an independent SSH connection and enables compression',()=>{
  const args=sshArgs({port:22,identityFile:'/test/key',controlPath:'/test/socket'});assert.ok(args.includes('-C'));assert.deepEqual(args.slice(0,2),['-S','none']);assert.ok(args.includes('StrictHostKeyChecking=yes'));
});
