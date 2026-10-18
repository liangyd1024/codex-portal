import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('passive', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
passive = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(passive)


class SidebarTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-sidebar-'))
        self.previous = passive.STORE
        passive.STORE = self.root
        self.db = sqlite3.connect(self.root / 'state_5.sqlite')
        fields = ','.join(name + (' INTEGER' if name in ('archived', 'updated_at', 'created_at') else ' TEXT') for name in passive.THREAD_COLUMNS)
        self.db.execute('CREATE TABLE threads (' + fields + ')')
        self.db.execute('CREATE TABLE projects (id TEXT PRIMARY KEY)')
        self.db.executemany('INSERT INTO projects VALUES (?)', [('billing',), ('other',)])
        self.db.execute('CREATE TABLE project_roots (project_id TEXT, path TEXT)')
        self.db.commit()

    def tearDown(self):
        self.db.close()
        passive.STORE = self.previous
        # Retain test fixtures; no recursive deletion.

    def add(self, identifier, source='vscode', **values):
        row = dict(id=identifier, source=source, title='', archived=0, updated_at=100, cwd='/billing')
        row.update(values)
        self.db.execute('INSERT INTO threads (' + ','.join(row) + ') VALUES (' + ','.join('?' for _ in row) + ')', list(row.values()))
        self.db.commit()

    def state(self, **values):
        (self.root / '.codex-global-state.json').write_text(json.dumps(values))

    def test_sources_filter_before_pagination_and_search_without_deleting(self):
        for i in range(55):
            self.add('review-' + str(i), '{"subagent":{"other":"guardian"}}', title='Guardian review', updated_at=200)
            self.add('chat-' + str(i), title='normal')
        self.add('exec', 'exec', title='normal')
        self.add('ambient', thread_source='ambient_suggestions', title='normal')
        self.add('unnamed')
        self.add('user-named-guardian', title='Guardian review')
        self.add('archived', archived=1)
        before = self.db.execute('SELECT count(*) FROM threads').fetchone()[0]
        page = passive.read_threads({})
        self.assertEqual(len(page['data']), 50)
        second = passive.read_threads({'cursor': page['nextCursor']})
        ids = [t['id'] for t in page['data'] + second['data']]
        self.assertEqual(len(ids), 57)
        self.assertEqual(len(set(ids)), 57)
        self.assertIn('unnamed', ids)
        self.assertIn('user-named-guardian', ids)
        self.assertIsNone(second['nextCursor'])
        self.assertEqual([t['id'] for t in passive.read_threads({'search': 'Guardian'})['data']], ['user-named-guardian'])
        self.assertEqual([t['id'] for t in passive.read_threads({'archived': True})['data']], ['archived'])
        self.assertEqual(before, self.db.execute('SELECT count(*) FROM threads').fetchone()[0])
        self.assertEqual(passive.read_detail({'threadId': 'review-0'})['thread']['id'], 'review-0')

    def test_membership_uses_database_and_legacy_assignment_never_directory(self):
        self.state(**{
            'app-server-project-id-by-legacy-project-id-by-host': {'local:' + str(self.root): {'old-billing': 'billing'}},
            'thread-project-assignments': {key: {'projectKind': 'local', 'projectId': 'old-billing'} for key in ['legacy', 'explicit', 'projectless']},
            'projectless-thread-ids': ['projectless']})
        self.add('legacy')
        self.add('explicit', project_id='other')
        self.add('projectless')
        self.add('directory-only', cwd='/unregistered/hash')
        self.add('section', thread_section_id='custom')
        self.add('deleted-project', project_id='removed')
        expected = {'legacy': 'billing', 'explicit': 'other', 'projectless': None, 'directory-only': None, 'deleted-project': None, 'section': None}
        data = passive.read_threads({})['data']
        self.assertEqual({t['id']: t['projectId'] for t in data}, expected)
        metadata = passive.read_sidebar_metadata({'threadIds': list(expected)})['data']
        self.assertEqual({key: value['projectId'] for key, value in metadata.items()}, expected)
        self.assertEqual(passive.read_sidebar_metadata({'threadIds': []}), {'data': {}})

    def test_completed_migration_does_not_resurrect_old_membership(self):
        self.state(**{'app-server-projects-migration-by-host': {'local:' + str(self.root): {'threadAssignmentsMigrated': True}},
                      'thread-project-assignments': {'chat': {'projectKind': 'local', 'projectId': 'billing'}}})
        self.add('chat')
        self.assertIsNone(passive.read_threads({})['data'][0]['projectId'])

    def test_legacy_saved_root_does_not_create_phantom_projects(self):
        self.db.execute("INSERT INTO project_roots VALUES ('billing', '/billing')")
        self.db.commit()
        self.add('child', cwd='/billing/child')
        self.add('sibling', cwd='/billing-other')
        self.add('custom', thread_section_id='section')
        self.state(**{'projectless-thread-ids': ['detached']})
        self.add('detached')
        self.assertEqual({t['id']: t['projectId'] for t in passive.read_threads({})['data']},
                         {'child': 'billing', 'sibling': None, 'custom': None, 'detached': None})
