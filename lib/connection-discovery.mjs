import path from 'node:path';
import {execute,decodeRemoteResult,sshArgs} from './ssh.mjs';
import {shellWord} from './config.mjs';
const invalid=message=>Object.assign(Error(message),{status:400,code:'CONNECTION_DISCOVERY'});
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&!/[\r\n\0]/.test(value);
// Read-only discovery. SSH configuration and native installation are never changed.
export async function discoverConnection(input,{run=execute}={}){
 const address=String(input.address||'').trim(),user=String(input.user||'').trim();
 if(!/^[a-zA-Z0-9_:][a-zA-Z0-9_.:-]*$/.test(address))throw invalid('请输入机器地址或 SSH 别名。');
 if(user&&!/^\w[\w.-]*$/.test(user))throw invalid('用户名格式无效。');
 const port=input.port===''||input.port==null?undefined:Number(input.port);
 if(port!==undefined&&(!Number.isInteger(port)||port<1||port>65535))throw invalid('SSH 端口必须为 1 到 65535。');
 for(const key of ['binary','identityFile'])if(input[key]&&!absolute(input[key]))throw invalid('高级设置中的路径必须是绝对路径。');
 const overrides=[...(port?['-p',String(port)]:[]),...(user?['-l',user]:[])];
 const resolved=await run('/usr/bin/ssh',['-G',...overrides,address],{timeoutMs:5000,maxBytes:131072});
 const option=name=>resolved.stdout.split('\n').find(line=>line.startsWith(name+' '))?.slice(name.length+1).trim();
 const resolvedUser=user||option('user'),resolvedPort=port||Number(option('port'));
 if(!/^\w[\w.-]*$/.test(resolvedUser||'')||!Number.isInteger(resolvedPort)||resolvedPort<1||resolvedPort>65535)throw invalid('无法读取 SSH 用户或端口，请在表单中填写。');
 const host={address,user:resolvedUser,port:resolvedPort,...input.identityFile?{identityFile:input.identityFile}:{}};
 const code=`import os,pwd,socket,shutil,sys,json
user=pwd.getpwuid(os.getuid()).pw_name
home=os.path.expanduser('~')
if user!=${JSON.stringify(resolvedUser)}: raise RuntimeError('目标用户名不匹配')
explicit=${JSON.stringify(input.binary||'')}
candidates=[explicit] if explicit else [shutil.which('codex'),'/Applications/Codex.app/Contents/Resources/codex','/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',os.path.join(home,'.local/bin/codex'),'/opt/homebrew/bin/codex','/usr/local/bin/codex']
binary=next((p for p in candidates if p and os.path.isfile(p) and os.access(p,os.X_OK)),None)
print('RCM_JSON:'+json.dumps({'user':user,'home':home,'alias':socket.gethostname().removesuffix('.local') if sys.version_info>=(3,9) else socket.gethostname(),'binary':binary,'python':sys.executable}))
`;
 let result;
 try{const response=await run('/usr/bin/ssh',[...sshArgs(host),`${host.user}@${address}`,'/bin/sh -s'],{input:`${shellWord('/usr/bin/python3')} - <<'RCM_DISCOVERY'\n${code}\nRCM_DISCOVERY\n`,timeoutMs:15000,maxBytes:65536});result=decodeRemoteResult(response.stdout);}
 catch(error){
  const message=String(error.message);
  if(/host key verification|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(message))throw invalid('SSH 主机身份尚未核验或已变化。请在网页服务所在机器上核验主机公钥后重试。');
  if(/permission denied|authentication/i.test(message))throw invalid('SSH 登录失败。请确认用户名，并在网页服务所在机器上配置 SSH 密钥，或在高级设置中指定私钥。');
  throw invalid('无法读取目标机器环境。请检查地址、SSH 连接和目标 Mac 的 Python 3，再重试。');
 }
 if(result.user!==resolvedUser||!absolute(result.home)||!absolute(result.python))throw invalid('目标机器返回的身份信息无效。');
 if(!result.binary)throw invalid('已连接，但未找到 Codex。请在目标 Mac 安装 Codex，或在高级设置中指定 Codex 路径。');
 if(!absolute(result.binary))throw invalid('目标机器返回的 Codex 路径无效。');
 return {connection:{...host,kind:'ssh',home:result.home,binary:result.binary,python:result.python,alias:typeof result.alias==='string'&&result.alias.trim()?result.alias.trim().slice(0,80):address}};
}
