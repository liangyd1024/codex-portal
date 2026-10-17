import importlib.util,json,pathlib,sqlite3,subprocess,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('restore_apply',pathlib.Path(__file__).resolve().parents[1]/'scripts/restore-apply.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class ApplyTests(unittest.TestCase):
 def setUp(self):
  self.root=pathlib.Path(tempfile.mkdtemp(prefix='rcm-apply-test-')).resolve();self.home=self.root/'tester';self.support=self.home/'Library/Application Support/RemoteCodexManager';self.data=self.home/'.codex/remote-codex-manager';self.support.mkdir(parents=True);self.data.mkdir(parents=True)
  config={'formatVersion':1,'machineId':'test','connections':[{'id':'local','kind':'local','home':str(self.home),'user':'tester'}]};(self.support/'connections.json').write_text(json.dumps(config))
  self.db=self.data/'output-journal.sqlite'
  with sqlite3.connect(self.db) as db:
   for table in r.b.TABLES:db.execute('CREATE TABLE '+table+' (value TEXT)')
   db.execute("INSERT INTO commands VALUES ('snapshot')")
  (self.data/'web-titles-local.json.connection.json').write_text('{"enabled":true}')
  result=r.b.backup(self.home,self.root/'backups');identity,_=r.b.key_init(self.home);self.stage=self.root/'staging';r.b.prepare(result['archive'],identity,'test',self.stage)
  with sqlite3.connect(self.db) as db:db.execute("INSERT INTO commands VALUES ('current')")
  self.saved=self.db.read_bytes()
 def scope(self):
  return patch.multiple(r,HOME=self.home,SUPPORT=self.support,DATA=self.data,idle=lambda:None,local_disconnected=lambda:None,node=lambda:'/usr/bin/true',launch=lambda *a:subprocess.CompletedProcess([],1))
 def test_apply_requires_explicit_maintenance_confirmation(self):
  with self.assertRaisesRegex(ValueError,'必须先确认'):r.apply(self.stage,False)
  self.assertEqual(self.db.read_bytes(),self.saved)
 def test_apply_restores_data_and_revokes_pairing(self):
  with self.scope():result=r.apply(self.stage,True)
  self.assertTrue(result['restored']);self.assertTrue(pathlib.Path(result['rollback']).exists())
  with sqlite3.connect(self.db) as db:self.assertEqual(db.execute('SELECT value FROM commands').fetchall(),[('snapshot',)])
  self.assertEqual(json.loads((self.support/'mobile/sessions.json').read_text()),{})
  self.assertFalse(json.loads((self.data/'web-titles-local.json.connection.json').read_text())['enabled'])
 def test_apply_failure_rolls_back_displaced_files(self):
  original=r.b.check_db
  def fail_live(file):
   if pathlib.Path(file)==self.db:raise RuntimeError('simulated validation failure')
   return original(file)
  with self.scope(),patch.object(r.b,'check_db',side_effect=fail_live):
   with self.assertRaisesRegex(RuntimeError,'simulated'):r.apply(self.stage,True)
  self.assertEqual(self.db.read_bytes(),self.saved)
  self.assertTrue(json.loads((self.data/'web-titles-local.json.connection.json').read_text())['enabled'])
if __name__=='__main__':unittest.main()
