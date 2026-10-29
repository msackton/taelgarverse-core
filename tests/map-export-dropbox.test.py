"""Offline Dropbox transport tests: no account, token, or network required."""
from pathlib import Path
import hashlib
import io
import json
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/map-export'))
import dropbox_source as dropbox

class Response(io.BytesIO):
    def __init__(self, data, headers=None):
        super().__init__(data)
        self.headers = headers or {}

class DropboxTests(unittest.TestCase):
    def test_hash_spans_blocks_with_irregular_chunks(self):
        for size in [0, 1, dropbox.BLOCK_SIZE, dropbox.BLOCK_SIZE+17, dropbox.BLOCK_SIZE*2]:
            data = b'x'*size
            expected = hashlib.sha256(b''.join(hashlib.sha256(data[i:i+dropbox.BLOCK_SIZE]).digest() for i in range(0, size, dropbox.BLOCK_SIZE))).hexdigest()
            actual = dropbox.ContentHash()
            for i in range(0, size, 70001): actual.update(data[i:i+70001])
            self.assertEqual(actual.hexdigest(), expected)
            self.assertEqual(actual.hexdigest(), expected)

    def transfer(self, root, *, body=b'Photoshop bytes', download=None, metadata_changes=None, result_changes=None, limit=dropbox.DEFAULT_LIMIT, interrupt=False):
        digest = dropbox.ContentHash(); digest.update(body)
        meta = {'.tag':'file','name':'world.PSB','id':'id:abc','rev':'abcdef','size':len(body),'content_hash':digest.hexdigest(), **(metadata_changes or {})}
        requests = []
        def opener(request):
            requests.append(request)
            self.assertEqual(request.get_header('Authorization'), 'Bearer fake-test-token')
            self.assertEqual(json.loads(request.get_header('Dropbox-api-path-root')), {'.tag':'root','root':'123'})
            if request.full_url.endswith('/get_metadata'):
                self.assertEqual(json.loads(request.data), {'path':'/Maps/world.psb'})
                return Response(json.dumps(meta).encode())
            self.assertEqual(request.full_url, 'https://content.dropboxapi.com/2/files/download')
            self.assertEqual(json.loads(request.get_header('Dropbox-api-arg')), {'path':'id:abc','rev':'abcdef'})
            response = Response(body if download is None else download, {'Dropbox-API-Result':json.dumps({**meta, **(result_changes or {})})})
            if interrupt:
                response.read = lambda *a: (_ for _ in ()).throw(KeyboardInterrupt())
            return response
        result = dropbox.download_source('/Maps/world.psb',root,environ={'DROPBOX_ACCESS_TOKEN':'fake-test-token'},namespace='123',opener=opener,max_bytes=limit,progress=lambda _:None)
        return result, requests

    def test_download_and_verified_cache_hit_and_repair(self):
        with tempfile.TemporaryDirectory() as directory:
            file, requests = self.transfer(directory)
            self.assertEqual(file.read_bytes(), b'Photoshop bytes')
            self.assertEqual(len(requests), 2)
            cached, requests = self.transfer(directory)
            self.assertEqual(cached, file); self.assertEqual(len(requests), 1)
            file.write_bytes(b'corrupted bytes')
            repaired, requests = self.transfer(directory)
            self.assertEqual(repaired.read_bytes(), b'Photoshop bytes');self.assertEqual(len(requests),2)
            self.assertFalse(list(Path(directory).glob('*.part')))

    def test_rejects_revision_mismatch_short_corrupt_and_oversized_downloads(self):
        for kwargs, message in [({'result_changes':{'rev':'new'}},'revision'),({'download':b'short'},'size or content-hash'),({'download':b'Photoshop bytex'},'size or content-hash'),({'download':b'too many bytes for expected size'},'declared size'),({'limit':1},'size limit'),({'metadata_changes':{'name':'world.jpg'}},'PSD or PSB')]:
            with self.subTest(kwargs=kwargs), tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(ValueError,message):self.transfer(directory,**kwargs)
                self.assertEqual(list(Path(directory).iterdir()),[])

    def test_interrupt_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(KeyboardInterrupt):self.transfer(directory,interrupt=True)
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_insufficient_space_and_cache_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(dropbox.shutil,'disk_usage') as usage:
                usage.return_value.free=0
                with self.assertRaisesRegex(ValueError,'disk space'):self.transfer(directory)
            file,_=self.transfer(directory)
            file.unlink(); file.symlink_to(Path(directory)/'elsewhere')
            with self.assertRaisesRegex(ValueError,'symbolic link'):self.transfer(directory)

    def test_refresh_token_and_session_override(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'private.json'
            file.write_text(json.dumps({'app_key':'key','refresh_token':'refresh-secret','app_secret':'app-secret'}))
            def opener(request):
                self.assertEqual(request.full_url,'https://api.dropboxapi.com/oauth2/token')
                self.assertEqual(urllib.parse.parse_qs(request.data.decode()),{'grant_type':['refresh_token'],'refresh_token':['refresh-secret'],'client_id':['key'],'client_secret':['app-secret']})
                return Response(b'{"access_token":"renewed-test-token"}')
            self.assertEqual(dropbox.access_token(file,environ={},opener=opener),'renewed-test-token')
            self.assertEqual(dropbox.access_token(file,environ={'DROPBOX_ACCESS_TOKEN':'session'},opener=lambda _:self.fail('unnecessary refresh')),'session')
            file.write_text('invalid secret text')
            with self.assertRaisesRegex(ValueError,'credential file'):dropbox.access_token(file,environ={})
            for token in [123,'token\nheader']:
                file.write_text(json.dumps({'access_token':token}))
                with self.assertRaisesRegex(ValueError,'Invalid Dropbox access token'):dropbox.access_token(file,environ={})

    def test_failures_do_not_leak_response_or_authentication(self):
        def denied(request):raise urllib.error.HTTPError('https://example.invalid',401,'secret-token',{},io.BytesIO(b'secret response'))
        with self.assertRaisesRegex(ValueError,'HTTP 401') as context:dropbox.request(None,denied)
        self.assertNotIn('secret',str(context.exception))
        with self.assertRaisesRegex(ValueError,'credentials were not forwarded'):dropbox.NoRedirect().redirect_request(None,None,302,'',{},'https://elsewhere.invalid')
        with self.assertRaisesRegex(ValueError,'account-relative'):dropbox.download_source('https://dropbox.com/link','unused',environ={})
        with self.assertRaisesRegex(ValueError,'Provide a session'):dropbox.access_token(environ={})

if __name__=='__main__':unittest.main()
