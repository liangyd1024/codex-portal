import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtemp,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCredential,validatePassword} from './ssh-credentials.mjs';
let directoryPromise;
function authDirectory(){return directoryPromise??=(async()=>{const directory=await mkdtemp(path.join(tmpdir(),'cp-auth-'));await chmod(directory,0o700);return directory;})().catch(error=>{directoryPromise=null;throw error;});}
export async function prepareSshAuth(host){
 if(!host.password&&!host.credentialRef)return {env:process.env,close(){}};
 let password=host.password;if(password)validatePassword(password);
 // Short private pathname also fits Darwin's Unix socket length limit.
 const directory=await authDirectory();const socket=path.join(directory,randomBytes(8).toString('hex'));
 let used=false;
 let closed=false,failure;
 const server=net.createServer(async client=>{client.on('error',()=>{});if(used||closed){client.end();return;}used=true;try{password=password||await readCredential(host.credentialRef);validatePassword(password);if(!closed)client.end(JSON.stringify({password}));else client.end();}catch(error){failure=error;client.end();}finally{password='';}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});await chmod(socket,0o600);server.unref();
 return {get failure(){return failure;},env:{...process.env,SSH_ASKPASS:fileURLToPath(new URL('../scripts/ssh-askpass.py',import.meta.url)),SSH_ASKPASS_REQUIRE:'force',DISPLAY:'rcm:0',RCM_ASKPASS_SOCKET:socket},close(){if(closed)return;closed=true;password='';server.close();}};
}
