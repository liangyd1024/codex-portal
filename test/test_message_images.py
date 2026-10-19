import base64
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('media_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=')

class MessageImagesTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-message-images-'))
        store.STORE = self.root
        self.image = self.root / '附件 (一).png'
        self.image.write_bytes(PNG)
        self.db = sqlite3.connect(self.root / 'thread_history_1.sqlite')
        self.db.execute('CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,item_json TEXT)')
        self.add('user', {'type':'userMessage','content':[{'type':'text','text':'正文'},{'type':'localImage','path':str(self.image)}]})
        self.add('reply', {'type':'agentMessage','text':'![说明](<' + str(self.image) + '>)'})

    def tearDown(self):
        self.db.close()

    def add(self, item, value):
        self.db.execute('INSERT INTO thread_items VALUES (?,?,?,?,?)', ('thread','turn',item,1,json.dumps(value)))
        self.db.commit()

    def test_local_attachment_and_markdown_reference_use_persisted_item(self):
        for item, options in [('user',{'part':'1'}),('reply',{'reference':str(self.image)})]:
            result = store.read_image({'threadId':'thread','itemId':item,**options})
            self.assertEqual(result['mime'],'image/png')
            self.assertEqual(base64.b64decode(result['data']),PNG)

    def test_wrong_thread_item_part_and_unreferenced_path_are_rejected(self):
        for request in [dict(threadId='other',itemId='user',part='1'), dict(itemId='missing',part='1'), dict(itemId='user',part='0'), dict(itemId='user',part='-1'),dict(itemId='user',part='99'),dict(itemId='user',part='1',reference=str(self.image)),dict(itemId='reply',reference=str(self.root/'other.png'))]:
            with self.assertRaises(ValueError):
                store.read_image({'threadId':'thread',**request})

    def test_missing_nonimage_symlink_and_oversized_files_fail_closed(self):
        text = self.root/'plain.png'; text.write_text('not an image')
        link = self.root/'link.png';link.symlink_to(self.image)
        huge = self.root/'huge.png'
        with huge.open('wb') as file: file.truncate(store.MAX_IMAGE_BYTES+1)
        for index, path in enumerate([text,link,huge,self.root/'missing.png']):
            item='bad'+str(index);self.add(item,{'type':'userMessage','content':[{'type':'localImage','path':str(path)}]})
            with self.assertRaises((ValueError,OSError)):
                store.read_image({'threadId':'thread','itemId':item,'part':'0'})

    def test_embedded_and_generated_images_still_work_without_network_fetches(self):
        b64=base64.b64encode(PNG).decode()
        self.add('inline',{'type':'userMessage','content':[{'type':'image','url':'data:image/png;base64,'+b64}]})
        self.add('generated',{'type':'imageGeneration','result':b64})
        self.add('remote',{'type':'userMessage','content':[{'type':'image','url':'https://example.com/a.png'}]})
        self.assertEqual(store.read_image({'threadId':'thread','itemId':'inline','part':'0'})['data'],b64)
        self.assertEqual(store.read_image({'threadId':'thread','itemId':'generated'})['data'],b64)
        with self.assertRaises(ValueError):store.read_image({'threadId':'thread','itemId':'remote','part':'0'})
