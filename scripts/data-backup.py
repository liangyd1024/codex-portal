#!/usr/bin/env python3
"""Manager-only encrypted backups. Never reads native Codex databases or credentials."""
import argparse, datetime, hashlib, io, json, os, pathlib, re, shutil, sqlite3, subprocess, tarfile, tempfile, time, uuid

FORMAT = 1
TABLES = {'commands', 'output_chunks', 'startup_prefixes', 'notification_events', 'turn_owners'}
MOBILE = {'config.json','sessions.json','sessions.json.code','Codex-Local-CA.crt','ca.key','server.key','server.crt','Codex-Local-CA.srl','server.csr','server.ext','lan.png','tailscale.png'}
STATE = re.compile(r'web-titles-[A-Za-z0-9_-]+\.json(?:\.(?:subscriptions|handoffs|notices|connection)\.json)?$')
ROOT = pathlib.Path(__file__).resolve().parent.parent

def stamp(): return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
def digest(data): return hashlib.sha256(data).hexdigest()
def jbytes(value): return json.dumps(value, ensure_ascii=False, indent=2).encode()
def executable(name):
    found=shutil.which(name)
    if found:return found
    candidate=pathlib.Path.home()/'.local/bin'/name
    if candidate.is_file():return str(candidate)
    raise RuntimeError('缺少命令：'+name)
def run(args, **kw): return subprocess.run([str(a) for a in args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)
def read_config(home):
    f=home/'Library/Application Support/RemoteCodexManager/connections.json'
    c=json.loads(f.read_text())
    if c.get('formatVersion')!=1 or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',c.get('machineId','')):raise ValueError('配置版本或机器标识无效')
    return c

def allowed(name):
    p=pathlib.PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or len(p.parts)!=2:return False
    group,base=p.parts
    return ((group=='data' and (base=='output-journal.sqlite' or STATE.fullmatch(base))) or
            (group=='config' and base=='connections.json') or
            (group=='mobile' and base in MOBILE) or
            (group=='logs' and re.fullmatch(r'[A-Za-z0-9_.-]+\.log',base)) or
            (group=='browser' and re.fullmatch(r'[A-Za-z0-9_.-]+\.json',base)))

def check_db(file):
    with sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise ValueError('数据库完整性检查失败')
        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not TABLES<=tables:raise ValueError('数据库缺少必需表：'+str(TABLES-tables))
        return sorted(tables)

def snapshot_db(source):
    # One explicitly named temporary SQLite file; no directory cleanup or WAL copying.
    fd,name=tempfile.mkstemp(prefix='rcm-snapshot-',suffix='.sqlite');os.close(fd)
    target=pathlib.Path(name)
    try:
        with sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True,timeout=30) as src, sqlite3.connect(target) as dst:
            deadline=time.monotonic()+120
            def progress(status,remaining,total):
                if time.monotonic()>deadline:raise TimeoutError('数据库快照超过 120 秒，原数据未改动')
            src.backup(dst,pages=512,progress=progress,sleep=0.01)
            dst.execute('PRAGMA journal_mode=DELETE')
        src.close();dst.close()
        tables=check_db(target)
        return target.read_bytes(),tables
    finally:target.unlink(missing_ok=True)

def key_init(home):
    directory=home/'Library/Application Support/RemoteCodexManager/keys';directory.mkdir(parents=True,exist_ok=True,mode=0o700);directory.chmod(0o700)
    identity=directory/'backup-identity.txt'
    if not identity.exists():run([executable('age-keygen'),'-o',identity])
    identity.chmod(0o600)
    recipient=run([executable('age-keygen'),'-y',identity]).stdout.decode().strip()
    (directory/'backup-recipient.txt').write_text(recipient+'\n')
    return identity,recipient

def collect(home,browser_files=()):
    support=home/'Library/Application Support/RemoteCodexManager';data=home/'.codex/remote-codex-manager'
    files={};missing=[];tables=[]
    def add(name,p):
        if p.is_symlink():raise ValueError('拒绝备份符号链接：'+name)
        if p.is_file():files[name]=p.read_bytes()
        else:missing.append(name)
    db=data/'output-journal.sqlite'
    if db.exists():files['data/output-journal.sqlite'],tables=snapshot_db(db)
    else:missing.append('data/output-journal.sqlite')
    for p in sorted(data.glob('web-titles-*.json')):
        if STATE.fullmatch(p.name):add('data/'+p.name,p)
    add('config/connections.json',support/'connections.json')
    for name in sorted(MOBILE):add('mobile/'+name,support/'mobile'/name)
    for directory,prefix in [(data,'service-'),(support/'logs','web-')]:
        for p in sorted(directory.glob('*.log')):add('logs/'+prefix+p.name,p)
    browsers=[]
    for index,p in enumerate(browser_files):
        p=pathlib.Path(p);content=p.read_bytes();b=json.loads(content)
        if b.get('format')!='rcm-browser' or b.get('version')!=1:raise ValueError('浏览器导出格式无效')
        if b.get('machineId')!=read_config(home)['machineId']:raise ValueError('浏览器来源机器不符')
        name='browser/'+str(index)+'.json';files[name]=content
        browsers.append({'file':name,'capturedAt':b.get('capturedAt'),'coverage':b.get('coverage')})
    return files,missing,tables,browsers

def backup(home,out,browser_files=(),recipient=None):
    home=pathlib.Path(home);out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True,mode=0o700);out.chmod(0o700)
    config=read_config(home)
    if not recipient:_,recipient=key_init(home)
    files,missing,tables,browsers=collect(home,browser_files)
    try:commit=run(['git','-C',ROOT,'rev-parse','HEAD']).stdout.decode().strip()
    except subprocess.CalledProcessError:commit=(ROOT/'VERSION').read_text().strip() if (ROOT/'VERSION').exists() else 'unknown'
    manifest={'format':'rcm-backup','formatVersion':FORMAT,'machineId':config['machineId'],'createdAt':stamp(),'codeVersion':commit,'files':{n:{'sha256':digest(v),'size':len(v)} for n,v in files.items()},'databaseTables':tables,'missing':missing,'browserSnapshots':browsers,'browserCoverage':'仅包含显式提供的浏览器和标签页快照；其他浏览器、标签页未包含。','excluded':['Codex native databases and full history','Codex login files','SSH private keys','unrelated credentials','cookies','sockets','original WAL/SHM']}
    buf=io.BytesIO()
    with tarfile.open(fileobj=buf,mode='w:gz') as archive:
        for name,content in [('manifest.json',jbytes(manifest))]+list(files.items()):
            info=tarfile.TarInfo(name);info.size=len(content);info.mode=0o600;archive.addfile(info,io.BytesIO(content))
    dest=out/(config['machineId']+'-'+manifest['createdAt']+'.tar.gz.age')
    run([executable('age'),'-r',recipient,'-o',dest],input=buf.getvalue());dest.chmod(0o600)
    parts=[]
    if dest.stat().st_size>1024**3:
        with dest.open('rb') as stream:
            i=0
            while True:
                chunk=stream.read(1024**3)
                if not chunk:break
                p=dest.with_name(dest.name+'.part-'+str(i).zfill(4));p.write_bytes(chunk);p.chmod(0o600);parts.append({'name':p.name,'sha256':digest(chunk),'size':len(chunk)});i+=1
    else:parts=[{'name':dest.name,'sha256':digest(dest.read_bytes()),'size':dest.stat().st_size}]
    index=dest.with_name(dest.name+'.index.json');index.write_bytes(jbytes({'formatVersion':FORMAT,'machineId':config['machineId'],'parts':parts}));index.chmod(0o600)
    return {'archive':str(dest),'index':str(index),'machineId':config['machineId'],'fileCount':len(files),'browserSnapshots':len(browsers),'missing':missing}

def encrypted_input(file):
    file=pathlib.Path(file)
    if not file.name.endswith('.index.json'):return file.read_bytes()
    idx=json.loads(file.read_text())
    if idx.get('formatVersion')!=FORMAT or not isinstance(idx.get('parts'),list) or not idx['parts']:raise ValueError('分卷索引无效')
    chunks=[]
    for part in idx['parts']:
        if pathlib.Path(part['name']).name!=part['name']:raise ValueError('分卷路径无效')
        p=file.parent/part['name']
        if p.is_symlink():raise ValueError('不允许分卷符号链接')
        b=p.read_bytes()
        if digest(b)!=part['sha256'] or len(b)!=part['size']:raise ValueError('分卷校验失败')
        chunks.append(b)
    return b''.join(chunks)

def verify_tree(folder,machine):
    folder=pathlib.Path(folder).resolve();manifest=json.loads((folder/'manifest.json').read_text())
    if manifest.get('format')!='rcm-backup' or manifest.get('formatVersion')!=FORMAT:raise ValueError('备份版本不兼容')
    if manifest.get('machineId')!=machine:raise ValueError('来源机器不符，拒绝覆盖')
    for name,meta in manifest['files'].items():
        if not allowed(name):raise ValueError('备份包含范围外文件：'+name)
        p=folder/name
        if p.is_symlink() or any(q.is_symlink() for q in p.parents if q!=folder and folder in q.parents):raise ValueError('恢复目录不允许符号链接')
        b=p.read_bytes()
        if digest(b)!=meta['sha256'] or len(b)!=meta['size']:raise ValueError('文件校验失败：'+name)
        if name.endswith('.json') or name.endswith('.json.code'):json.loads(b)
    cfg=json.loads((folder/'config/connections.json').read_text())
    if cfg.get('machineId')!=machine or cfg.get('formatVersion')!=1:raise ValueError('备份中的连接配置身份不符')
    db=folder/'data/output-journal.sqlite'
    if db.exists():check_db(db)
    return manifest

def prepare(file,identity,machine,destination):
    dest=pathlib.Path(destination)
    if dest.exists():raise ValueError('恢复验证目录必须不存在，避免覆盖已有文件')
    plain=run([executable('age'),'-d','-i',identity],input=encrypted_input(file)).stdout
    contents={}
    with tarfile.open(fileobj=io.BytesIO(plain),mode='r:gz') as archive:
        total=0
        for entry in archive:
            if not entry.isfile() or entry.name in contents or not (entry.name=='manifest.json' or allowed(entry.name)):raise ValueError('不安全或重复的归档路径')
            total+=entry.size
            if total>8*1024**3:raise ValueError('解包数据超过 8 GiB 限制')
            contents[entry.name]=archive.extractfile(entry).read()
    manifest=json.loads(contents.get('manifest.json',b'{}'))
    if manifest.get('formatVersion')!=FORMAT or manifest.get('format')!='rcm-backup':raise ValueError('备份版本不兼容')
    if manifest.get('machineId')!=machine:raise ValueError('来源机器不符，拒绝恢复')
    if set(contents)!={'manifest.json',*manifest['files']}:raise ValueError('备份清单与归档不一致')
    for name,meta in manifest['files'].items():
        if digest(contents[name])!=meta['sha256'] or len(contents[name])!=meta['size']:raise ValueError('备份校验失败：'+name)
    dest.mkdir(parents=True,mode=0o700)
    for name,content in contents.items():
        p=dest/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);p.write_bytes(content);p.chmod(0o600)
    verify_tree(dest,machine)
    return {'staging':str(dest),'machineId':machine,'verifiedFiles':len(manifest['files']),'liveDataChanged':False}

def publish(index,repo,tag):
    gh=executable('gh')
    info=json.loads(run([gh,'repo','view',repo,'--json','isPrivate,nameWithOwner']).stdout)
    if not info['isPrivate']:raise ValueError('仓库不是私有，拒绝上传')
    idx=json.loads(pathlib.Path(index).read_text());assets=[pathlib.Path(index).parent/x['name'] for x in idx['parts']]+[pathlib.Path(index)]
    encrypted_input(index)
    existing=subprocess.run([gh,'release','view',tag,'-R',repo],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if existing.returncode:run([gh,'release','create',tag,'-R',repo,'--title',tag,'--notes','管理器数据加密备份。按来源机器恢复；恢复私钥不在仓库中。','--target','main'])
    run([gh,'release','upload',tag,'-R',repo,*assets])
    return {'release':'https://github.com/'+repo+'/releases/tag/'+tag}

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    b=sub.add_parser('backup');b.add_argument('--home',type=pathlib.Path,default=pathlib.Path.home());b.add_argument('--out',type=pathlib.Path);b.add_argument('--browser',action='append',default=[]);b.add_argument('--recipient')
    k=sub.add_parser('key-init');k.add_argument('--home',type=pathlib.Path,default=pathlib.Path.home())
    r=sub.add_parser('restore');r.add_argument('archive');r.add_argument('--identity',required=True);r.add_argument('--machine',required=True);r.add_argument('--destination',required=True)
    p=sub.add_parser('publish');p.add_argument('index');p.add_argument('--repo',required=True);p.add_argument('--tag',required=True)
    d=sub.add_parser('download');d.add_argument('--repo',required=True);d.add_argument('--tag',required=True);d.add_argument('--destination',required=True)
    args=parser.parse_args()
    if args.command=='backup':result=backup(args.home,args.out or args.home/'Library/Application Support/RemoteCodexManager/backups',args.browser,args.recipient)
    elif args.command=='key-init':
        identity,recipient=key_init(args.home);result={'identity':str(identity),'recipient':recipient,'instruction':'将 identity 文件另存到离线介质；不要提交到 Git 或上传。'}
    elif args.command=='restore':result=prepare(args.archive,args.identity,args.machine,args.destination)
    elif args.command=='publish':result=publish(args.index,args.repo,args.tag)
    else:
        dest=pathlib.Path(args.destination)
        if dest.exists():raise ValueError('下载目录必须不存在')
        dest.mkdir(parents=True,mode=0o700);run([executable('gh'),'release','download',args.tag,'-R',args.repo,'-D',dest]);result={'downloadedTo':str(dest)}
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
