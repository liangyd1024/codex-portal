import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sidebar_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class SidebarModelTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-sidebar-model-'))
        store.STORE = self.root
        self.db = sqlite3.connect(self.root / 'state_5.sqlite')
        self.db.execute('CREATE TABLE threads (' + ','.join(c+' '+('INTEGER' if c in ['archived','created_at','updated_at'] else 'TEXT') for c in store.THREAD_COLUMNS) + ',recency_at INTEGER,is_pinned INTEGER,section_position INTEGER,section_entered_at_ms INTEGER)')
        self.db.executescript('CREATE TABLE projects (id TEXT,name TEXT,position INTEGER); CREATE TABLE project_roots (project_id TEXT,path TEXT,position INTEGER); CREATE TABLE thread_sections (id TEXT,name TEXT); CREATE TABLE thread_read_receipts (thread_id TEXT,first_unread_turn TEXT,revision TEXT);')
        self.db.executemany('INSERT INTO projects VALUES (?,?,?)',[('p1','First',0),('p2','Second',1)])
        self.db.executemany('INSERT INTO thread_sections VALUES (?,?)',[(store.PINNED_SECTION,'Pinned'),('s1','Current'),('s2','Other account')])
        self.state={'electron-persisted-atom-state':{'sidebar-custom-sections-v3':{
            'account1':{'sections':[{'id':'legacy-section','name':'Old name','hostSectionIds':{'local':'s1'},'itemKeys':['codex:project:legacy-project']}],'sectionOrder':['pinned','custom:legacy-section','threads','chats']},
            'account2':{'sections':[{'id':'other-section','name':'Other account','hostSectionIds':{'local':'s2'},'itemKeys':[]}]}
        },'flat-project-sidebar-preferences-v1':{'chatSortMode':'updated_at','projectSortMode':'updated_at'}},
            'app-server-project-id-by-legacy-project-id-by-host':{'local:'+str(self.root):{'legacy-project':'p1'}}}
        self.save()

    def tearDown(self):
        self.db.close()

    def save(self):
        (self.root/'.codex-global-state.json').write_text(json.dumps(self.state))
        self.db.commit()

    def add(self,id,**kw):
        row={'id':id,'title':id,'name':id,'source':'vscode','updated_at':100,'created_at':1,'archived':0,'cwd':'/unknown'}
        row.update(kw)
        self.db.execute('INSERT INTO threads ('+','.join(row)+') VALUES ('+','.join('?' for _ in row)+')',list(row.values()));self.db.commit()

    def read(self,**kw):return store.read_sidebar({'accountId':'account1',**kw})

    def test_null_project_root_does_not_break_sidebar_or_membership(self):
        self.db.executemany('INSERT INTO project_roots VALUES (?,?,?)', [('p1', None, 0), ('p1', '', 1), ('p2', '/valid', 2)])
        self.add('valid-chat', cwd='/valid/sub')
        self.add('no-cwd', cwd=None)
        result=self.read()
        self.assertEqual(next(p for p in result['projects'] if p['id']=='p1')['roots'], [])
        self.assertEqual(next(t for t in result['data'] if t['id']=='valid-chat')['projectId'], 'p2')
        self.assertIsNone(next(t for t in result['data'] if t['id']=='no-cwd')['projectId'])

    def test_account_layout_and_section_are_independent_of_membership(self):
        self.add('chat',project_id='p1',thread_section_id='s1')
        a=self.read();self.assertEqual([s['id'] for s in a['sections']],['s1'])
        self.assertEqual(a['sections'][0]['projectIds'],['p1'])
        self.assertEqual(a['sections'][0]['name'],'Current')
        self.assertEqual(a['data'][0]['projectId'],'p1')
        self.assertEqual(a['sections'][0]['threadIds'],['chat'])
        self.assertEqual(a['projects'][0]['threadIds'],[])
        self.assertNotEqual(a['accountScope'],self.read(accountId='account2')['accountScope'])
        self.assertEqual(self.read(accountId=None)['sections'],[])

    def test_pin_older_than_first_page_and_complete_project_recency(self):
        for i in range(70):self.add('t'+str(i),updated_at=1000+i,project_id='p2')
        self.add('old-pin',updated_at=1,thread_section_id=store.PINNED_SECTION,section_position=0)
        self.add('recent',updated_at=2,recency_at=2000,project_id='p1')
        a=self.read();self.assertEqual(len(a['data']),72)
        self.assertEqual(a['pinnedThreadIds'],['old-pin']);self.assertEqual(a['projects'][0]['id'],'p1')
        search=self.read(search='old-pin');self.assertEqual(search['projects'][0]['recencyAt'],2000)

    def test_archive_pagination_filtering_and_no_deleted_records(self):
        for i in range(61):self.add('archived-%02d'%i,archived=1)
        self.add('guardian',source='{"subagent":{"other":"guardian"}}',archived=1)
        first=self.read(archived=True);second=self.read(archived=True,cursor=first['nextCursor'])
        self.assertEqual(len(first['data']),50);self.assertEqual(len(second['data']),11)
        self.assertEqual(len({t['id'] for t in first['data']+second['data']}),61)
        self.assertEqual(self.db.execute('select count(*) from threads').fetchone()[0],62)

    def test_manual_order_read_revision_and_stale_legacy_pin(self):
        self.state['pinned-thread-ids']=['t1'];self.state['app-server-migrated-pinned-thread-ids-by-host']={'local:'+str(self.root):['t1']}
        self.state['electron-persisted-atom-state']['flat-project-sidebar-preferences-v1']['chatSortMode']='manual'
        self.state['sidebar-project-thread-orders']={'legacy-project':{'threadIds':['t2','t1']}}
        self.add('t1',project_id='p1');self.add('t2',project_id='p1')
        self.db.execute("INSERT INTO thread_read_receipts VALUES ('t1','turn','r1')");self.save()
        a=self.read();self.assertEqual(a['projects'][0]['threadIds'],['t2','t1']);self.assertEqual(a['pinnedThreadIds'],[])
        t=next(t for t in a['data'] if t['id']=='t1');self.assertTrue(t['isUnread']);self.assertEqual(t['readRevision'],'r1')
        self.db.execute("UPDATE threads SET name='renamed' WHERE id='t1'");self.db.commit()
        self.assertNotEqual(t['revision'],next(t for t in self.read()['data'] if t['id']=='t1')['revision'])
