// Keep full command output in the local log; show only a bounded diagnostic in the UI.
export function updateTestFailure(error){
 const output=String(error.stdout||'')+'\n'+String(error.stderr||'')+'\n'+String(error.message||'');
 if(/Unable to deserialize cloned data/.test(output)&&/test_runner/.test(output))return '测试运行器内部通信异常（Node 输出解析失败），未重启服务。详情见更新日志。';
 if(error.code==='ENOENT'||/无法启动测试命令/.test(output))return '测试未能启动：运行环境缺少测试命令，未重启服务。详情见更新日志。';
 if(error.killed||error.code==='ETIMEDOUT')return '更新前测试超时，未重启服务。详情见更新日志。';
 const files=[...new Set([...output.matchAll(/(?:^|[\s(/])(test\/[A-Za-z0-9_.-]+\.(?:test\.mjs|py))(?=[:\s)])/gm)].map(match=>match[1]))].slice(-3);
 return '更新前测试未通过'+(files.length?'（'+files.join('、')+'）':'')+'，未重启服务。详情见更新日志。';
}
