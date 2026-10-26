from unittest.mock import patch
import importlib.util,io,json,os,pathlib,sqlite3,subprocess,tarfile,tempfile,threading,time,unittest
spec=importlib.util.spec_from_file_location('backup',pathlib.Path(__file__).resolve().parents[1]/'scripts/data-backup.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BackupTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.root=pathlib.Path(tempfile.mkdtemp(prefix='rcm-tests-'));cls.home=cls.root/'home';cls.support=cls.home/'Library/Application Support/RemoteCodexManager';cls.data=cls.home/'.codex/remote-codex-manager';cls.support.mkdir(parents=True);cls.data.mkdir(parents=True)
  (cls.support/'connections.json').write_text(json.dumps({'formatVersion':1,'machineId':'test','connections':[]}))
  (cls.data/'web-titles-local.json.archive-sync.json').write_text('{}')
  (cls.data/'web-titles-local.json').write_text('[]');(cls.data/'web-titles-local.json.connection.json').write_text('{"enabled":true}')
  (cls.data/'web-titles-local.json.desktop-00000000-0000-0000-0000-000000000001.json').write_text('{"submissions":{}}')
  (cls.data/'web-titles-local.json.native-automations.json').write_text('{"threadId":null,"submissions":{}}')
  (cls.data/'web-titles-local.json.handoffs.json').write_text('[["test-thread",{"state":"waiting","requestedAt":1}]]')
  for name in ['auth.json','state_5.sqlite','secret.key']:(cls.home/'.codex'/name).write_text('DO-NOT-BACKUP')
  (cls.data/'unrelated-secret.json').write_text('DO-NOT-BACKUP')
  cls.db=cls.data/'output-journal.sqlite'
  with sqlite3.connect(cls.db) as db:
   db.execute('PRAGMA journal_mode=WAL')
   for table in b.TABLES:db.execute('CREATE TABLE '+table+' (id INTEGER PRIMARY KEY,value TEXT)')
   db.executemany('INSERT INTO commands(value) VALUES(?)',[('x'*1024,)]*3000)
  cls.identity,cls.recipient=b.key_init(cls.home)
  cls.result=b.backup(cls.home,cls.root/'backups')
 @classmethod
 def tearDownClass(cls):print('测试数据保留在 '+str(cls.root))
 def test_online_backup_with_concurrent_writer(self):
  stop=threading.Event();writes=[]
  def writer():
   db=sqlite3.connect(self.db,timeout=30)
   while not stop.is_set():db.execute('INSERT INTO commands(value) VALUES(?)',('concurrent',));db.commit();writes.append(1);time.sleep(.002)
   db.close()
  t=threading.Thread(target=writer);t.start()
  try:
   content,tables=b.snapshot_db(self.db)
   self.assertTrue(b.TABLES<=set(tables));self.assertGreater(len(writes),0)
   p=self.root/'concurrent.sqlite';p.write_bytes(content);b.check_db(p)
  finally:stop.set();t.join()
 def test_complete_restore_and_scope(self):
  dest=self.root/'restored';r=b.prepare(self.result['index'],self.identity,'test',dest);self.assertFalse(r['liveDataChanged'])
  m=b.verify_tree(dest,'test');self.assertIn('data/web-titles-local.json.archive-sync.json',m['files']);self.assertIn('data/output-journal.sqlite',m['files']);self.assertIn('data/web-titles-local.json.connection.json',m['files']);self.assertEqual(m['browserSnapshots'],[]);self.assertIn('data/web-titles-local.json.native-automations.json',m['files']);self.assertIn('data/web-titles-local.json.desktop-00000000-0000-0000-0000-000000000001.json',m['files'])
  self.assertEqual(json.loads((dest/'data/web-titles-local.json.handoffs.json').read_text()),[['test-thread',{'state':'waiting','requestedAt':1}]])
  self.assertFalse(any(any(secret in n for secret in ['auth.json','state_5.sqlite','secret','-wal','-shm']) for n in m['files']))
 def test_wrong_key_rejected_before_extraction(self):
  key,_=b.key_init(self.root/'other-home');dest=self.root/'wrong-key'
  with self.assertRaises(subprocess.CalledProcessError):b.prepare(self.result['archive'],key,'test',dest)
  self.assertFalse(dest.exists())
 def test_wrong_machine_rejected_before_extraction(self):
  dest=self.root/'wrong-machine'
  with self.assertRaisesRegex(ValueError,'来源机器'):b.prepare(self.result['archive'],self.identity,'other',dest)
  self.assertFalse(dest.exists())
 def test_damaged_archive_rejected(self):
  p=self.root/'damaged.age';content=bytearray(pathlib.Path(self.result['archive']).read_bytes());content[len(content)//2]^=1;p.write_bytes(content);dest=self.root/'corrupt'
  with self.assertRaises(subprocess.CalledProcessError):b.prepare(p,self.identity,'test',dest)
  self.assertFalse(dest.exists())
 def fake(self,name,entries):
  buf=io.BytesIO()
  with tarfile.open(fileobj=buf,mode='w:gz') as t:
   for n,data in entries:
    info=tarfile.TarInfo(n);info.size=len(data);t.addfile(info,io.BytesIO(data))
  p=self.root/(name+'.age');b.run([b.executable('age'),'-r',self.recipient,'-o',p],input=buf.getvalue());return p
 def test_incompatible_version_rejected(self):
  p=self.fake('future',[('manifest.json',b.jbytes({'format':'rcm-backup','formatVersion':99,'machineId':'test'}))]);dest=self.root/'future'
  with self.assertRaisesRegex(ValueError,'版本'):b.prepare(p,self.identity,'test',dest)
  self.assertFalse(dest.exists())
 def test_path_escape_rejected(self):
  p=self.fake('escape',[('../auth.json',b'bad')]);dest=self.root/'escape'
  with self.assertRaisesRegex(ValueError,'路径'):b.prepare(p,self.identity,'test',dest)
  self.assertFalse(dest.exists())
 def test_unknown_data_rejected(self):
  self.assertFalse(b.allowed('data/auth.json'));self.assertFalse(b.allowed('mobile/other.key'));self.assertFalse(b.allowed('/data/output-journal.sqlite'));self.assertFalse(b.allowed('data/output-journal.sqlite-wal'))
 def test_checksum_rejected(self):
  p=self.fake('bad-hash',[('manifest.json',b.jbytes({'format':'rcm-backup','formatVersion':1,'machineId':'test','files':{'config/connections.json':{'sha256':'bad','size':2}}})),('config/connections.json',b'{}')]);dest=self.root/'bad-hash'
  with self.assertRaisesRegex(ValueError,'校验'):b.prepare(p,self.identity,'test',dest)
  self.assertFalse(dest.exists())
 def test_staging_does_not_overwrite(self):
  with self.assertRaisesRegex(ValueError,'必须不存在'):b.prepare(self.result['archive'],self.identity,'test',self.root)
 def test_missing_database_tables_rejected(self):
  p=self.root/'invalid.sqlite'
  with sqlite3.connect(p) as db:db.execute('CREATE TABLE other(id)')
  with self.assertRaisesRegex(ValueError,'必需表'):b.check_db(p)
 def test_custom_config_and_state_keep_native_journal_separate(self):
  root=pathlib.Path(tempfile.mkdtemp(prefix='rcm-custom-backup-'));config=root/'custom-config.json';state=root/'web-state';state.mkdir()
  config.write_text(json.dumps({'formatVersion':1,'machineId':'custom','connections':[]}));(state/'web-titles-custom.json.archive-sync.json').write_text('{}')
  with patch.dict(os.environ,{'RCM_CONFIG':str(config),'RCM_STATE_DIR':str(state)}):
   self.assertEqual(b.read_config(self.home)['machineId'],'custom')
   files,missing,tables,browsers=b.collect(self.home)
  self.assertIn('data/output-journal.sqlite',files);self.assertIn('data/web-titles-custom.json.archive-sync.json',files)
  self.assertNotIn('data/web-titles-local.json',files);self.assertEqual(json.loads(files['config/connections.json'])['machineId'],'custom')
 def test_relative_custom_paths_rejected(self):
  with self.assertRaisesRegex(ValueError,'绝对路径'):b.collect(self.home,config_path='relative.json')
 def test_backup_records_installed_and_tool_versions_separately(self):
  file=self.support/'installed.json';file.write_text(json.dumps({'commit':'a'*40}))
  result=b.backup(self.home,self.root/'version-backup');dest=self.root/'version-restored';b.prepare(result['archive'],self.identity,'test',dest)
  manifest=json.loads((dest/'manifest.json').read_text());self.assertEqual(manifest['installedVersion'],'a'*40);self.assertEqual(manifest['codeVersion'],'a'*40);self.assertIn('toolVersion',manifest)
 def test_remote_publish_commands_are_removed(self):
  result=subprocess.run(['python3',str(b.ROOT/'scripts/data-backup.py'),'publish','unused'],capture_output=True,text=True)
  self.assertNotEqual(result.returncode,0);self.assertIn('invalid choice',result.stderr)
if __name__=='__main__':unittest.main()
