import importlib.util
import io
import json
import os
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('file_reader', pathlib.Path(__file__).parents[1] / 'scripts/file-reader.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

class MessageFilesTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-files-')).resolve()
        self.home = self.root/'home'; (self.home/'.codex').mkdir(parents=True)
        self.db = sqlite3.connect(self.home/'.codex/thread_history_1.sqlite')
        self.db.execute('CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,item_json TEXT)')
        self.file = self.home/'中文 (样例) 100%.mp4';self.file.write_bytes(bytes(range(256))*8192)
        self.add('video',self.file)

    def tearDown(self):
        self.db.close()

    def add(self,item,path,text=None):
        self.db.execute('INSERT INTO thread_items VALUES (?,?,?)',('thread',item,json.dumps({'type':'agentMessage','text':text or '[**产物**](<'+str(path)+'>)'})))
        self.db.commit()

    def read(self,**options):
        output=io.BytesIO()
        class Stdout:
            buffer=output
        with patch.object(reader.sys,'stdout',Stdout()):
            reader.serve({'threadId':'thread','itemId':'video','reference':str(self.file),**options},self.home)
        header,body=output.getvalue().split(b'\n',1)
        return json.loads(header),body

    def test_full_range_suffix_head_metadata_and_if_range(self):
        meta,body=self.read();self.assertEqual(body,self.file.read_bytes());self.assertEqual(meta['kind'],'video')
        for value,expected in [('bytes=0-9',bytes(range(10))),('bytes=-10',self.file.read_bytes()[-10:]),('bytes=100-199',bytes(range(100,200)))]:
            header,body=self.read(range=value);self.assertEqual(header['status'],206);self.assertEqual(body,expected)
        header,body=self.read(range='bytes=0-9',head=True);self.assertEqual(body,b'');self.assertEqual(header['length'],10)
        header,body=self.read(mode='meta');self.assertEqual(body,b'');self.assertEqual(header['size'],self.file.stat().st_size)
        header,body=self.read(range='bytes=0-9',ifRange='stale');self.assertEqual(header['status'],200);self.assertEqual(len(body),self.file.stat().st_size)
        header,body=self.read(range='bytes=0-9',ifRange=meta['etag']);self.assertEqual(header['status'],206)

    def test_invalid_ranges_return_416_and_size(self):
        for value in ['bytes=-0','bytes=9-1','bytes=99999999-','bytes=0-1,5-6','nonsense','bytes=-']:
            header,body=self.read(range=value);self.assertEqual(header['status'],416);self.assertEqual(header['size'],self.file.stat().st_size);self.assertEqual(body,b'')

    def test_thread_message_membership_and_code_examples(self):
        for options in [{'threadId':'other'},{'itemId':'missing'},{'reference':str(self.home/'another.mp4')},{'reference':'https://example.com/a.mp4'}]:
            with self.assertRaises(reader.FileError):self.read(**options)
        for i,text in enumerate(['`[video](<'+str(self.file)+'>)`','```md\n[video](<'+str(self.file)+'>)\n```']):
            self.add('code'+str(i),self.file,text)
            with self.assertRaises(reader.FileError):self.read(itemId='code'+str(i))

    def test_video_in_markdown_image_syntax(self):
        self.add('image-video',self.file,'![video](<'+str(self.file)+'>)')
        header,_=self.read(itemId='image-video',mode='meta')
        self.assertEqual(header['kind'],'video')
        self.add('code-label',self.file,'[`video`](<'+str(self.file)+'>)')
        header,_=self.read(itemId='code-label',mode='meta')
        self.assertEqual(header['kind'],'video')

    def test_sensitive_files_symlink_escape_and_special_files(self):
        secret=self.home/'.ssh/key.txt';secret.parent.mkdir();secret.write_text('private')
        link=self.home/'innocent.txt';link.symlink_to(secret)
        fifo=self.home/'pipe.txt';os.mkfifo(fifo)
        for i,path in enumerate([secret,link,fifo]):
            self.add('bad'+str(i),path)
            with self.assertRaises(reader.FileError):self.read(itemId='bad'+str(i),reference=str(path))
        self.add('outside',pathlib.Path('/etc/passwd'))
        with self.assertRaises(reader.FileError):self.read(itemId='outside',reference='/etc/passwd')

    def test_text_limit_html_inert_and_line_suffix(self):
        path=self.home/'报告.html';path.write_text('<script>alert(1)</script>'+'中'*400000)
        self.add('text',path)
        header,_=self.read(itemId='text',reference=str(path),mode='meta');self.assertEqual(header['mime'],'text/plain; charset=utf-8')
        _,body=self.read(itemId='text',reference=str(path),mode='text');result=json.loads(body);self.assertTrue(result['truncated']);self.assertTrue(result['text'].startswith('<script>'))
        self.add('line',path,str('[代码](<'+str(path)+':12:3>)'))
        header,_=self.read(itemId='line',reference=str(path)+':12:3',mode='meta');self.assertEqual(header['name'],path.name)

    def test_empty_file_and_changed_version(self):
        before,_=self.read(mode='meta');self.file.write_bytes(b'')
        after,body=self.read();self.assertNotEqual(before['etag'],after['etag']);self.assertEqual(after['length'],0);self.assertEqual(body,b'')
        header,_=self.read(range='bytes=0-');self.assertEqual(header['status'],416)

    def test_directory_is_not_retryable_and_never_streamed(self):
        directory=self.home/'project';directory.mkdir();self.add('directory',directory)
        for mode in ['meta','text','content','download']:
            with self.assertRaises(reader.FileError) as caught:
                self.read(itemId='directory',reference=str(directory),mode=mode)
            self.assertEqual(caught.exception.status,422)
            self.assertFalse(caught.exception.retryable)
            self.assertIn('文件夹',str(caught.exception))

    def test_reference_positions_and_literal_names(self):
        path=self.home/'source.py';path.write_text('one\ntwo\n')
        for i,suffix in enumerate([':2',':2:3','#L2','#L2C3']):
            reference=str(path)+suffix;self.add('position'+str(i),reference)
            meta,_=self.read(itemId='position'+str(i),reference=reference,mode='meta')
            self.assertEqual(meta['line'],2);self.assertEqual(meta['path'],str(path))
            _,body=self.read(itemId='position'+str(i),reference=reference,mode='text')
            self.assertEqual(json.loads(body)['line'],2)
        for i,suffix in enumerate([':2','#L2']):
            literal=self.home/('literal'+suffix);literal.write_text('literal')
            self.add('literal'+str(i),literal)
            meta,_=self.read(itemId='literal'+str(i),reference=str(literal),mode='meta')
            self.assertEqual(meta['name'],literal.name);self.assertNotIn('line',meta)

    def test_utf8_limit_does_not_add_replacement_for_split_character(self):
        path=self.home/'unicode.txt';path.write_text('中'*400000);self.add('unicode',path)
        _,body=self.read(itemId='unicode',reference=str(path),mode='text')
        result=json.loads(body);self.assertTrue(result['truncated'])
        self.assertNotIn('\ufffd',result['text']);self.assertEqual(result['text'],'中'*(reader.TEXT_LIMIT//3))

    def test_html_browser_mode_streams_complete_document_but_source_stays_inert(self):
        for i,extension in enumerate(['.html','.HTM']):
            path=self.home/('page'+extension);data=b'<!doctype html><script>document.title="sample"</script>'+b' '*(reader.TEXT_LIMIT+1);path.write_bytes(data);self.add('html'+str(i),path)
            args={'itemId':'html'+str(i),'reference':str(path)}
            meta,_=self.read(**args,mode='meta');self.assertTrue(meta['htmlPreview']);self.assertEqual(meta['kind'],'text')
            meta,body=self.read(**args,mode='html',range='bytes=0-9');self.assertEqual(meta['status'],200);self.assertEqual(meta['mime'],'text/html; charset=utf-8');self.assertEqual(body,data)
            meta,body=self.read(**args,mode='html',head=True);self.assertEqual(body,b'');self.assertEqual(meta['length'],len(data))
            meta,_=self.read(**args,mode='content');self.assertEqual(meta['mime'],'text/plain; charset=utf-8')
            _,body=self.read(**args,mode='text');self.assertTrue(json.loads(body)['truncated'])
        with self.assertRaises(reader.FileError) as caught:self.read(mode='html')
        self.assertEqual(caught.exception.status,415)
        with self.assertRaises(reader.FileError):self.read(itemId='other-message',reference=str(path),mode='html')

    def test_image_links_stream_with_image_mime_without_metadata_request(self):
        for suffix, mime, content in [('png', 'image/png', b'\x89PNG\r\n\x1a\n'), ('svg', 'image/svg+xml', b'<svg xmlns="http://www.w3.org/2000/svg"/>')]:
            path = self.home / ('diagram.' + suffix)
            path.write_bytes(content)
            self.add(suffix, path)
            header, body = self.read(itemId=suffix, reference=str(path))
            self.assertEqual(header['mime'], mime)
            self.assertEqual(header['kind'], 'image')
            self.assertEqual(body, content)
