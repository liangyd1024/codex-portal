import { spawn } from 'node:child_process';
import net from 'node:net';
import { inflateSync } from 'node:zlib';

import {pythonPrefix} from './config.mjs';
export function sshArgs(host){return ['-S','none','-o','ControlMaster=no','-C','-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-p',String(host.port),'-i',host.identityFile];}
export function createSshTransport(host){return {remote:(code,opts)=>remotePython(host,code,opts),identity:()=>verifyIdentity(host),tunnelFactory:()=>startTunnel(host)};}
export function execute(file, args, { input = '', timeoutMs = 60000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '', size = 0, settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('SSH 操作超时。请检查目标机器和网络。')); }, timeoutMs);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) { child.kill(); finish(new Error('远端返回的数据过大。')); } else stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
    child.on('error', error => finish(error));
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => code === 0 ? finish(null, {stdout, stderr}) : finish(Object.assign(new Error(`SSH 执行失败（${code ?? signal}）。${stderr.trim().slice(-1400)}`), { code: 'SSH_FAILED' })));
    child.stdin.end(input);
  });
}

export function decodeRemoteResult(stdout) {
  const line = stdout.split('\n').findLast(value => value.startsWith('RCM_JSON:') || value.startsWith('RCM_ZJSON:'));
  if (!line) throw new Error('远端未返回有效结果。请查看 SSH 诊断。');
  const text = line.startsWith('RCM_ZJSON:') ? inflateSync(Buffer.from(line.slice(10),'base64'),{maxOutputLength:64*1024*1024}).toString('utf8') : line.slice(9);
  const result = JSON.parse(text);
  if (result.error) throw new Error(result.error);
  return result;
}

export async function remotePython(host,code, { timeoutMs = 60000 } = {}) {
  const script = `/usr/bin/python3 - <<'REMOTE_CODEX_PY'\n${pythonPrefix(host)}${code}\nREMOTE_CODEX_PY\n`;
  const {stdout} = await execute('/usr/bin/ssh', [...sshArgs(host), `${host.user}@${host.address}`, '/bin/bash --noprofile --norc -s'], {input: script, timeoutMs});
  return decodeRemoteResult(stdout);
}

export async function verifyIdentity(host) {
  return remotePython(host,`import os,pwd,socket,json\nu=pwd.getpwuid(os.getuid()).pw_name\nh=os.path.expanduser('~')\nif u!=SERVICE_USER or h!=SERVICE_HOME: raise RuntimeError('目标身份不符，已停止连接')\nprint('RCM_JSON:'+json.dumps({'user':u,'home':h,'hostname':socket.gethostname()}))`);
}

export async function availablePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer(); socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
  });
}

export async function startTunnel(host) {
  const port = await availablePort();
  const child = spawn('/usr/bin/ssh', [...sshArgs(host), '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:${host.dataDir}/output-relay-v2.sock`, `${host.user}@${host.address}`], {stdio: ['ignore', 'ignore', 'pipe']});
  let stderr = ''; child.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-3000);});
  // Wait for the local TCP listener, not an arbitrary sleep. No command or RPC is sent.
  await new Promise((resolve, reject) => {
    let done = false; const deadline = Date.now() + 25000;
    const finish = error => {if(done)return;done=true;clearTimeout(timer);child.off('error', onError);child.off('exit', onExit);error?reject(error):resolve();};
    const onError = error => finish(error);
    const onExit = code => finish(new Error(`SSH 隧道已退出（${code}）。${stderr}`));
    child.once('error', onError); child.once('exit', onExit);
    let timer;
    const check = () => {
      if (done) return;
      if (Date.now() > deadline) return finish(new Error('建立 SSH 隧道超时。'));
      const probe = net.connect({host: '127.0.0.1', port});
      probe.once('connect', () => {probe.destroy();finish();});
      probe.once('error', () => {probe.destroy(); if (!done) timer=setTimeout(check, 200);});
    }; check();
  }).catch(error => {child.kill();throw error;});
  return {child, url: `ws://127.0.0.1:${port}`, get stderr(){return stderr;}};
}
