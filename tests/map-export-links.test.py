"""Shared-link download tests use synthetic bytes and never access Dropbox."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/map-export'))
import dropbox_link as links

LINK = 'https://www.dropbox.com/scl/fi/example/world.psb?rlkey=private-test-key&st=tracking&dl=0'
NORMALIZED = 'https://www.dropbox.com/scl/fi/example/world.psb?rlkey=private-test-key&dl=1'
BODY = b'8BPS\x00\x02' + b'example-data'*200

class Response(io.BytesIO):
    status=200
    def __init__(self, body=BODY, headers=None):
        super().__init__(body)
        self.headers={'Content-Length':str(len(body)), 'ETag':'"revision-1"', **(headers or {})}

class LinkTests(unittest.TestCase):
    def test_modern_and_legacy_links_keep_access_key_and_force_download(self):
        self.assertEqual(links.normalize_link(LINK),(NORMALIZED,'.psb'))
        self.assertEqual(links.normalize_link('https://dropbox.com/s/example/My%20Map.PSD?dl=0#preview'),('https://www.dropbox.com/s/example/My%20Map.PSD?dl=1','.psd'))
        self.assertEqual(links.normalize_link(LINK.replace('private-test-key','key%2B%26%3D'))[0],NORMALIZED.replace('private-test-key','key%2B%26%3D'))
        for url in ['http://www.dropbox.com/s/id/a.psd', 'https://www.dropbox.com.evil.invalid/s/id/a.psd', 'https://user:password@www.dropbox.com/s/id/a.psd', 'https://www.dropbox.com:444/s/id/a.psd', 'https://www.dropbox.com/scl/fo/id/folder', 'https://www.dropbox.com/s/id/map.html', 'https://www.dropbox.com/s/id/a.psd\n', 'https://dl.dropboxusercontent.com/s/id/a.psd']:
            with self.subTest(url=url),self.assertRaises(ValueError):links.normalize_link(url)

    def test_redirects_stay_on_https_dropbox_download_hosts_and_carry_no_credentials(self):
        redirect=links.DropboxRedirect()
        request=urllib.request.Request(NORMALIZED,headers={'Authorization':'secret','Cookie':'session','If-None-Match':'"rev"'})
        for destination in ['https://dl.dropboxusercontent.com/file', 'https://abc.dl.dropboxusercontent.com/file']:
            next_request=redirect.redirect_request(request,None,302,'',{},destination)
            self.assertIsNone(next_request.get_header('Authorization'));self.assertIsNone(next_request.get_header('Cookie'))
        for destination in ['http://dl.dropboxusercontent.com/file','https://evil.invalid/file','https://dl.dropboxusercontent.com.evil.invalid/file','https://user@dl.dropboxusercontent.com/file','https://dl.dropboxusercontent.com:8443/file']:
            with self.assertRaisesRegex(ValueError,'outside'):redirect.redirect_request(request,None,302,'',{},destination)

    def test_download_has_no_auth_and_verified_cache_is_revalidated(self):
        with tempfile.TemporaryDirectory() as directory:
            requests=[]
            def download(request):
                requests.append(request)
                self.assertEqual(request.full_url,NORMALIZED)
                self.assertIsNone(request.get_header('Authorization'))
                self.assertIsNone(request.get_header('Cookie'))
                return Response()
            with patch.dict('os.environ',{'DROPBOX_ACCESS_TOKEN':'must-not-send'}):
                file=links.download_link(LINK,directory,opener=download,progress=lambda _:None)
            self.assertEqual(file.read_bytes(),BODY)
            def unchanged(request):
                self.assertEqual(request.get_header('If-none-match'),'"revision-1"')
                raise urllib.error.HTTPError(request.full_url,304,'Not Modified',{},None)
            self.assertEqual(links.download_link(LINK,directory,opener=unchanged,progress=lambda _:None),file)
            index=next(Path(directory).glob('link-*.json')).read_text()
            self.assertNotIn('private-test-key',index);self.assertNotIn('dropbox.com',index)
            file.write_bytes(b'corrupted')
            repaired=links.download_link(LINK,directory,opener=download,progress=lambda _:None)
            self.assertEqual(repaired.read_bytes(),BODY)
            self.assertIsNone(requests[-1].get_header('If-none-match'))
            self.assertEqual(list(Path(directory).glob('*.part')),[])

    def test_changed_link_downloads_new_content_and_absent_validators_redownload(self):
        with tempfile.TemporaryDirectory() as directory:
            first=links.download_link(LINK,directory,opener=lambda _:Response(),progress=lambda _:None)
            second=links.download_link(LINK,directory,opener=lambda _:Response(BODY+b'new',{'ETag':None}),progress=lambda _:None)
            self.assertNotEqual(first,second);self.assertEqual(second.read_bytes(),BODY+b'new')
            def no_validator(request):
                self.assertIsNone(request.get_header('If-none-match'));self.assertIsNone(request.get_header('If-modified-since'))
                return Response(BODY+b'new',{'ETag':None})
            links.download_link(LINK,directory,opener=no_validator,progress=lambda _:None)

    def test_html_wrong_magic_short_oversized_and_unbounded_downloads(self):
        examples=[(Response(b'<html>login</html>',{'Content-Type':'text/html'}),10000,'web page'),
                  (Response(b'not photoshop'),10000,'PSD or PSB'),
                  (Response(BODY,{'Content-Length':str(len(BODY)+1)}),10000,'incomplete'),
                  (Response(),10,'size limit'),
                  (Response(BODY,{'Content-Length':None}),10,'size limit'),
                  (Response(BODY,{'Content-Length':None}),10000,None)]
        for response,limit,message in examples:
            with self.subTest(message=message),tempfile.TemporaryDirectory() as directory:
                if message:
                    with self.assertRaisesRegex(ValueError,message):links.download_link(LINK,directory,opener=lambda _:response,max_bytes=limit,progress=lambda _:None)
                    self.assertEqual(list(Path(directory).iterdir()),[])
                else:self.assertEqual(links.download_link(LINK,directory,opener=lambda _:response,max_bytes=limit,progress=lambda _:None).read_bytes(),BODY)

    def test_interruption_cleans_partial_and_http_errors_do_not_print_shared_key(self):
        with tempfile.TemporaryDirectory() as directory:
            response=Response();read=response.read
            def interrupted(size):
                if size==6:return read(size)
                raise KeyboardInterrupt()
            response.read=interrupted
            with self.assertRaises(KeyboardInterrupt):links.download_link(LINK,directory,opener=lambda _:response,progress=lambda _:None)
            self.assertEqual(list(Path(directory).iterdir()),[])
            def denied(request):raise urllib.error.HTTPError(LINK,403,'private-test-key',{},io.BytesIO(b'private-test-key'))
            with self.assertRaisesRegex(ValueError,'HTTP 403') as error:links.download_link(LINK,directory,opener=denied,progress=lambda _:None)
            self.assertNotIn('private-test-key',str(error.exception));self.assertNotIn('https:',str(error.exception))

    def test_cache_index_cannot_escape_directory_or_bypass_size_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            index=Path(directory)/'index.json'
            for record in [{'sha256':'../../secret','size':10}, {'sha256':hashlib.sha256(BODY).hexdigest(),'size':len(BODY)}]:
                index.write_text(json.dumps(record))
                self.assertEqual(links.cached_link(index,Path(directory),'.psb',1),(None,None))
            with patch.object(links.shutil,'disk_usage') as usage:
                usage.return_value.free=0
                with self.assertRaisesRegex(ValueError,'disk space'):links.download_link(LINK,directory,opener=lambda _:Response(),progress=lambda _:None)

if __name__=='__main__':unittest.main()
