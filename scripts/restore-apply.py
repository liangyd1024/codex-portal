#!/usr/bin/env python3
"""Explicit maintenance only. All displaced files are retained for rollback."""
import argparse,importlib.util,json,os,pathlib,shutil,subprocess,time,urllib.request
spec=importlib.util.spec_from_file_location('backup',pathlib.Path(__file__).with_name('data-backup.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
HOME=pathlib.Path.home();SUPPORT=HOME/'Library/Application Support/RemoteCodexManager';DATA=HOME/'.codex/remote-codex-manager'
DOMAIN='gui/'+str(os.getuid())
LABELS=['local.remote-codex-manager.app-server','local.remote-codex-manager.output-relay','local.remote-codex-manager.output-relay-v2','local.remote-codex-manager.web']
def launch(action,label):return subprocess.run(['/bin/launchctl',action,DOMAIN+'/'+label],capture_output=True,text=True)
def start(label):
    deadline=time.monotonic()+15
    while True:
        result=subprocess.run(['/bin/launchctl','bootstrap',DOMAIN,str(HOME/'Library/LaunchAgents'/(label+'.plist'))],capture_output=True,text=True)
        if result.returncode==0:return
        if time.monotonic()>=deadline:raise RuntimeError('服务重新注册失败：'+label+' '+result.stderr)
        time.sleep(.25)
def node():
    path=os.environ.get('RCM_NODE') or shutil.which('node')
    if not path:
        candidate=HOME/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
        if candidate.is_file():path=str(candidate)
    if not path:raise RuntimeError('需要 Node.js 22+；设置 RCM_NODE')
    return path

def idle():b.run([node(),pathlib.Path(__file__).with_name('check-idle.mjs')])
def local_disconnected():
    if launch('print',LABELS[-1]).returncode:return
    def get(url):
        with urllib.request.urlopen('http://127.0.0.1:4317'+url,timeout=5) as response:return json.load(response)
    for c in get('/api/connections')['data']:
        state=get('/api/status?host='+c['id'])['connection']['state']
        if state not in ('disconnected','error'):raise ValueError('请先断开本机网页的全部连接，再恢复')

def apply(staging,confirmed):
    if not confirmed:raise ValueError('必须先确认两台网页都已断开，且任务已结束：--entrances-disconnected')
    config=b.read_config(HOME);manifest=b.verify_tree(staging,config['machineId'])
    restored=json.loads((staging/'config/connections.json').read_text())
    local=[h for h in restored['connections'] if h['kind']=='local']
    if len(local)!=1 or local[0]['home']!=str(HOME) or local[0]['user']!=HOME.name:raise ValueError('恢复配置的本机身份不符')
    if 'data/output-journal.sqlite' not in manifest['files']:raise ValueError('备份缺少数据库，不进行原地恢复')
    local_disconnected();idle()
    before=b.backup(HOME,SUPPORT/'backups')
    marker=DATA/'maintenance.json'
    if marker.exists():raise ValueError('已有维护标记，请先核对之前的维护状态')
    marker.write_text(json.dumps({'reason':'restore','createdAt':b.stamp()}));marker.chmod(0o600)
    # Recheck after setting the marker so compatible entrances cannot restart services.
    try:idle();local_disconnected()
    except Exception:
        marker.rename(DATA/('maintenance.cancelled-'+b.stamp()+'.json'));raise
    rollback=SUPPORT/'restore-history'/b.stamp();rollback.mkdir(parents=True,mode=0o700)
    running=[label for label in LABELS if launch('print',label).returncode==0]
    stopped=[];saved=[];written=[]
    try:
        for label in reversed(running):
            result=launch('bootout',label)
            if result.returncode:raise RuntimeError('无法停止专用服务：'+label)
            stopped.append(label)
        for label in stopped:
            for _ in range(50):
                if launch('print',label).returncode:break
                time.sleep(.1)
            else:raise RuntimeError('服务尚未停止：'+label)
        replacements={}
        for name in manifest['files']:
            group,base=name.split('/')
            if group=='data':target=DATA/base
            elif group=='config':target=SUPPORT/base
            elif group=='mobile':target=SUPPORT/'mobile'/base
            else:continue
            replacements[target]=(staging/name).read_bytes()
        # Never restore authentication sessions or auto-connect to old work.
        replacements[SUPPORT/'mobile/sessions.json']=b'{}'
        replacements[SUPPORT/'mobile/sessions.json.code']=b'null'
        for target in replacements:
            if target.name.endswith('.connection.json'):replacements[target]=b'{"enabled":false}'
        preserved=set(replacements)
        preserved.update(p for p in DATA.glob('web-titles-*.json') if b.STATE.fullmatch(p.name))
        preserved.update([DATA/'output-journal.sqlite-wal',DATA/'output-journal.sqlite-shm'])
        for index,target in enumerate(sorted(preserved)):
            if target.is_symlink():raise ValueError('实时数据不允许符号链接')
            if target.exists():
                old=rollback/'old'/str(index);old.parent.mkdir(parents=True,exist_ok=True,mode=0o700);target.rename(old);saved.append((target,old))
        for target,content in replacements.items():
            target.parent.mkdir(parents=True,exist_ok=True,mode=0o700);target.write_bytes(content);target.chmod(0o600);written.append(target)
        b.check_db(DATA/'output-journal.sqlite')
        b.run([node(),'--input-type=module','-e',"import {loadConfig} from './lib/config.mjs';loadConfig();"],cwd=b.ROOT)
        marker.rename(rollback/'maintenance.completed.json')
        for label in running:start(label)
        # Launch registration and a valid HTTP response are required for success.
        for label in running:
            if launch('print',label).returncode:raise RuntimeError('服务未恢复：'+label)
        if LABELS[-1] in running:
            for _ in range(60):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:4317/api/connections',timeout=1) as response:json.load(response)
                    break
                except Exception:time.sleep(.5)
            else:raise RuntimeError('网页未通过健康检查')
        (rollback/'receipt.json').write_bytes(b.jbytes({'source':str(staging),'preRestoreBackup':before,'restoredFiles':[str(p) for p in written],'savedFiles':[[str(a),str(c)] for a,c in saved],'services':running}))
        return {'restored':True,'rollback':str(rollback),'preRestoreBackup':before['archive'],'browserImport':'从验证目录 browser/ 手动导入，手机必须重新配对'}
    except Exception:
        for label in reversed(running):launch('bootout',label)
        for index,target in enumerate(written):
            if target.exists():
                failed=rollback/'failed'/str(index);failed.parent.mkdir(parents=True,exist_ok=True,mode=0o700);target.rename(failed)
        for target,old in saved:
            if old.exists():target.parent.mkdir(parents=True,exist_ok=True);old.rename(target)
        if marker.exists():marker.rename(rollback/'maintenance.failed.json')
        for label in running:start(label)
        raise

def main():
    os.umask(0o077);p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='action',required=True)
    a=s.add_parser('apply');a.add_argument('staging',type=pathlib.Path);a.add_argument('--entrances-disconnected',action='store_true')
    s.add_parser('resume');args=p.parse_args()
    if args.action=='apply':result=apply(args.staging,args.entrances_disconnected)
    else:
        marker=DATA/'maintenance.json'
        if marker.exists():marker.rename(DATA/('maintenance.resumed-'+b.stamp()+'.json'))
        result={'maintenance':False,'message':'维护标记已归档，可在网页中手动连接。'}
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
