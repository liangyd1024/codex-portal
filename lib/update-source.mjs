import path from 'node:path';
// Build checkouts may be detached. Future browser updates need the repository's master worktree.
export function resolveUpdateSource({root,run}){
 const output=run('git',['-C',root,'worktree','list','--porcelain','-z']);
 const records=output.split('\0\0').filter(Boolean).map(record=>record.split('\0'));
 const master=records.find(fields=>fields.includes('branch refs/heads/master'));
 const source=master?.find(field=>field.startsWith('worktree '))?.slice(9);
 if(!source||!path.isAbsolute(source))throw Error('未找到同一仓库的 master 工作区，无法记录网页更新来源。请先检出 master 后部署。');
 const remote=run('git',['-C',source,'remote','get-url','origin']);
 if(remote!==run('git',['-C',root,'remote','get-url','origin']))throw Error('master 工作区的远端地址与部署仓库不一致。');
 return {sourceRoot:source,sourceRemote:remote};
}
