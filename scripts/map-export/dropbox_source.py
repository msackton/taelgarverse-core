"""Read-only Dropbox API downloads, revision-pinned and content-hash verified."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request

BLOCK_SIZE = 4 * 1024 * 1024
DEFAULT_LIMIT = 16 * 1024**3


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Dropbox returned an unexpected redirect; credentials were not forwarded.")


def open_request(request):
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=60)


def request(request, opener):
    try:
        return opener(request)
    except urllib.error.HTTPError as error:
        error.close()
        hint = {401: "Check or refresh your Dropbox credentials.", 403: "Check the Dropbox app's read scopes and account access.",
                409: "Check the Dropbox file path, revision, and namespace.", 429: "Dropbox rate limit reached; try again later."}.get(error.code, "Try again later.")
        raise ValueError(f"Dropbox request failed (HTTP {error.code}). {hint}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ValueError("Dropbox connection failed or timed out.") from None


def read_json(response):
    with response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ValueError("Dropbox response was unexpectedly large.")
    try:
        result = json.loads(data)
    except (ValueError, UnicodeError):
        raise ValueError("Dropbox returned invalid JSON.") from None
    if not isinstance(result, dict):
        raise ValueError("Dropbox returned invalid metadata.")
    return result


def access_token(credentials_file=None, *, environ=None, opener=open_request):
    environ = os.environ if environ is None else environ
    credentials = {}
    if credentials_file:
        try:
            with Path(credentials_file).open("rb") as stream:
                data = stream.read(65537)
            if len(data) > 65536:
                raise ValueError()
            credentials = json.loads(data)
            if not isinstance(credentials, dict):
                raise ValueError()
        except (OSError, ValueError, UnicodeError):
            raise ValueError("Dropbox credential file could not be read as a JSON object.") from None
    # An explicit session token overrides persistent refresh credentials.
    token = environ.get("DROPBOX_ACCESS_TOKEN") or credentials.get("access_token")
    if token:
        if not isinstance(token, str) or any(c in token for c in "\r\n"):
            raise ValueError("Invalid Dropbox access token.")
        return token
    key = environ.get("DROPBOX_APP_KEY") or credentials.get("app_key")
    refresh = environ.get("DROPBOX_REFRESH_TOKEN") or credentials.get("refresh_token")
    secret = environ.get("DROPBOX_APP_SECRET") or credentials.get("app_secret")
    if not isinstance(key, str) or not key or not isinstance(refresh, str) or not refresh:
        raise ValueError("Provide a session Dropbox token, or a credential file with app_key and refresh_token.")
    form = {"grant_type": "refresh_token", "refresh_token": refresh, "client_id": key}
    if secret:
        if not isinstance(secret, str):
            raise ValueError("Invalid Dropbox app secret.")
        form["client_secret"] = secret
    req = urllib.request.Request("https://api.dropboxapi.com/oauth2/token", data=urllib.parse.urlencode(form).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    value = read_json(request(req, opener)).get("access_token")
    if not isinstance(value, str) or not value or any(c in value for c in "\r\n"):
        raise ValueError("Dropbox token refresh did not return an access token.")
    return value


class ContentHash:
    def __init__(self):
        self.whole, self.block, self.length = hashlib.sha256(), hashlib.sha256(), 0

    def update(self, data):
        while data:
            take = min(BLOCK_SIZE - self.length, len(data))
            self.block.update(data[:take])
            self.length += take
            data = data[take:]
            if self.length == BLOCK_SIZE:
                self.whole.update(self.block.digest())
                self.block, self.length = hashlib.sha256(), 0

    def hexdigest(self):
        result = self.whole.copy()
        if self.length:
            result.update(self.block.digest())
        return result.hexdigest()


def file_hash(filename):
    digest = ContentHash()
    with Path(filename).open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(data)
    return digest.hexdigest()


def download_source(source, cache_dir, *, credentials_file=None, namespace=None, max_bytes=DEFAULT_LIMIT,
                    opener=open_request, environ=None, progress=print):
    if not isinstance(source, str) or not source or len(source) > 4096 or any(ord(c) < 32 for c in source) or not (source.startswith("/") or source.startswith("id:")):
        raise ValueError("Use a Dropbox account-relative /file.psd or /file.psb path, or a file id: identifier.")
    if type(max_bytes) is not int or not 0 < max_bytes <= 64 * 1024**3:
        raise ValueError("Dropbox download limit must be between 1 byte and 64 GiB.")
    token = access_token(credentials_file, environ=environ, opener=opener)
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    if namespace:
        if not str(namespace).isdigit():
            raise ValueError("Dropbox root namespace must contain digits only.")
        headers["Dropbox-API-Path-Root"] = json.dumps({".tag": "root", "root": str(namespace)})
    req = urllib.request.Request("https://api.dropboxapi.com/2/files/get_metadata", data=json.dumps({"path": source}).encode(), headers=headers, method="POST")
    metadata = read_json(request(req, opener))
    name, size, revision, identity, digest = (metadata.get(k) for k in ("name", "size", "rev", "id", "content_hash"))
    if metadata.get(".tag") != "file" or not isinstance(name, str) or Path(name).suffix.lower() not in {".psd", ".psb"}:
        raise ValueError("Dropbox source must be a PSD or PSB file.")
    if type(size) is not int or not 0 < size <= max_bytes:
        raise ValueError("Dropbox Photoshop file exceeds the configured download size limit or is empty.")
    if not isinstance(identity, str) or not identity.startswith("id:") or not isinstance(revision, str) or not revision:
        raise ValueError("Dropbox did not supply a file identity and revision.")
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("Dropbox did not supply a valid content hash.")
    cache = Path(cache_dir).expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = hashlib.sha256((identity+"\n"+revision).encode()).hexdigest()
    target = cache / (key + Path(name).suffix.lower())
    if target.is_symlink():
        raise ValueError("Dropbox cache entry must not be a symbolic link.")
    if target.is_file() and target.stat().st_size == size and file_hash(target) == digest:
        progress("Using verified cached Dropbox revision.")
        return target
    if shutil.disk_usage(cache).free < size + 64*1024**2:
        raise ValueError("Not enough disk space to download this Dropbox file.")
    download_headers = {k: v for k, v in headers.items() if k != "Content-Type"}
    download_headers["Dropbox-API-Arg"] = json.dumps({"path": identity, "rev": revision}, ensure_ascii=True)
    req = urllib.request.Request("https://content.dropboxapi.com/2/files/download", data=b"", headers=download_headers, method="POST")
    temporary = None
    try:
        with request(req, opener) as response:
            try:
                actual = json.loads(response.headers.get("Dropbox-API-Result", "{}"))
            except (ValueError, UnicodeError):
                raise ValueError("Dropbox returned invalid download metadata.") from None
            if not isinstance(actual, dict) or any(actual.get(k) != metadata[k] for k in ("id", "rev", "size", "content_hash")):
                raise ValueError("Dropbox download does not match the requested revision.")
            count, announced, content = 0, 0, ContentHash()
            with tempfile.NamedTemporaryFile(prefix=".download-", suffix=".part", dir=cache, delete=False) as stream:
                temporary = Path(stream.name)
                progress(f"Downloading Dropbox source ({size / 1024**2:.1f} MiB)…")
                while True:
                    chunk = response.read(1024*1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > size:
                        raise ValueError("Dropbox download exceeded its declared size.")
                    content.update(chunk)
                    stream.write(chunk)
                    if count - announced >= 64*1024**2:
                        announced = count
                        progress(f"Downloaded {count / 1024**2:.0f} / {size / 1024**2:.0f} MiB")
            if count != size or content.hexdigest() != digest:
                raise ValueError("Dropbox download failed its size or content-hash check.")
        os.replace(temporary, target)
        temporary = None
        progress("Dropbox revision downloaded and verified.")
        return target
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ValueError("Dropbox download or cache write failed; no partial file was accepted.") from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
