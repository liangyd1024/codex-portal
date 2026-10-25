import {discoverEnvironment,initializeConfig} from '../lib/initialize.mjs';
const args=process.argv.slice(2),command=args.shift();
try{
 if(!['doctor','init'].includes(command))throw Error('用法：node scripts/configure.mjs doctor|init [--binary <绝对路径>]');
 let binary;
 if(args.length){if(args.length!==2||args[0]!=='--binary'||!args[1])throw Error('参数无效。');binary=args[1];}
 const result=await discoverEnvironment({binary});
 for(const item of result.checks)console.log(`${item.ok?'通过':'未通过'}：${item.name}${item.message?' — '+item.message:''}`);
 if(command==='init'){
  if(!result.checks.filter(item=>item.name!=='部署浏览器').every(item=>item.ok))throw Error('基础环境检查未通过，未写入配置。');
  const initialized=await initializeConfig({binary:result.paths.codex});
  console.log(initialized.created?'已创建本机连接配置。':'已保留现有配置，未覆盖连接及身份。');
 }else if(!result.ok)process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
