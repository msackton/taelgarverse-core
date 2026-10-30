"""Stream public Dropbox shared-file links without account credentials."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_LIMIT = 16 * 1024**3


def allowed_url(value):
    try:
        parsed = urllib.parse.urlsplit(value)
        host = parsed.hostname or ""
        return (parsed.scheme == "https" and parsed.port in (None, 443) and not parsed.username and
                not parsed.password and not any(ord(c) < 33 for c in value) and
                (host in {"dropbox.com", "www.dropbox.com", "dl.dropboxusercontent.com"} or
                 host.endswith(".dl.dropboxusercontent.com")))
    except ValueError:
        return False


def normalize_link(value):
    if not isinstance(value, str) or len(value) > 8192 or not allowed_url(value):
        raise ValueError("Use an HTTPS Dropbox shared-file link, without a login or custom port.")
    parsed = urllib.parse.urlsplit(value)
    if parsed.hostname not in {"dropbox.com", "www.dropbox.com"} or not re.fullmatch(r"/(?:scl/fi|s)/[^/]+/[^/]+", parsed.path):
        raise ValueError("Use a Dropbox /scl/fi/ or /s/ shared-file link, not a folder or preview page.")
    suffix = Path(urllib.parse.unquote(parsed.path)).suffix.lower()
    if suffix not in {".psd", ".psb"}:
        raise ValueError("Dropbox shared link must name a PSD or PSB file.")
    # Preserve the access key; discard tracking, preview flags and URL fragments.
    query = urllib.parse.parse_qs(parsed.query, max_num_fields=100)
    parameters = {"rlkey": query["rlkey"][0]} if query.get("rlkey") else {}
    parameters["dl"] = "1"
    return urllib.parse.urlunsplit(("https", "www.dropbox.com", parsed.path, urllib.parse.urlencode(parameters), "")), suffix


class DropboxRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise ValueError("Dropbox shared link redirected outside its HTTPS download hosts.")
        result = super().redirect_request(req, fp, code, msg, headers, newurl)
        if result is not None:
            for name in ("Authorization", "Cookie", "Proxy-Authorization"):
                result.remove_header(name)
        return result


def open_link(request):
    return urllib.request.build_opener(DropboxRedirect()).open(request, timeout=60)


def sha256_file(filename):
    digest = hashlib.sha256()
    with filename.open("rb") as stream:
        for data in iter(lambda: stream.read(1024*1024), b""):
            digest.update(data)
    return digest.hexdigest()


def cached_link(index, cache, suffix, limit):
    try:
        if index.is_symlink() or index.stat().st_size > 16384:
            return None, None
        value = json.loads(index.read_text(encoding="utf-8"))
        digest = value["sha256"]
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or type(value["size"]) is not int or not 0 < value["size"] <= limit:
            return None, None
        target = cache / ("shared-"+digest+suffix)
        if target.is_symlink() or not target.is_file() or target.stat().st_size != value["size"] or sha256_file(target) != digest:
            return None, None
        return value, target
    except (OSError, ValueError, KeyError, TypeError):
        return None, None


def download_link(source, cache_dir, *, max_bytes=DEFAULT_LIMIT, opener=open_link, progress=print):
    url, suffix = normalize_link(source)
    if type(max_bytes) is not int or not 0 < max_bytes <= 64*1024**3:
        raise ValueError("Dropbox download limit must be between 1 byte and 64 GiB.")
    cache = Path(cache_dir).expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Never store a shared URL or its access key in the cache index.
    index = cache / ("link-"+hashlib.sha256(url.encode()).hexdigest()+".json")
    previous, cached = cached_link(index, cache, suffix, max_bytes)
    headers = {"Accept-Encoding": "identity", "User-Agent": "Taelgarverse-Map-Exporter"}
    if previous:
        for field, header in [("etag", "If-None-Match"), ("lastModified", "If-Modified-Since")]:
            value = previous.get(field)
            if isinstance(value, str) and value and len(value) < 4096 and not any(c in value for c in "\r\n"):
                headers[header] = value
    temporary = index_temp = None
    try:
        try:
            response = opener(urllib.request.Request(url, headers=headers, method="GET"))
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            if code == 304 and cached is not None:
                progress("Using verified cached Dropbox shared file.")
                return cached
            raise ValueError(f"Dropbox shared-link request failed (HTTP {code}). Check that the link allows downloads without signing in or a password.") from None
        with response:
            if getattr(response, "status", 200) != 200:
                raise ValueError("Dropbox shared link did not return a complete download.")
            if "text/html" in response.headers.get("Content-Type", "").lower():
                raise ValueError("Dropbox returned a web page. Use a public file link that allows downloads without signing in or a password.")
            length = response.headers.get("Content-Length")
            if length is not None and (not re.fullmatch(r"[0-9]{1,20}", length) or not 0 < int(length) <= max_bytes):
                raise ValueError("Dropbox shared file exceeds the download size limit or has an invalid size.")
            expected = int(length) if length is not None else None
            free = shutil.disk_usage(cache).free - 64*1024**2
            if free <= 0 or (expected is not None and free < expected):
                raise ValueError("Not enough disk space to download this Dropbox file.")
            chunk = response.read(6)
            if chunk not in (b"8BPS\x00\x01", b"8BPS\x00\x02"):
                raise ValueError("Dropbox shared link did not return a PSD or PSB file.")
            digest, count, announced = hashlib.sha256(), 0, 0
            with tempfile.NamedTemporaryFile(prefix=".shared-", suffix=".part", dir=cache, delete=False) as stream:
                temporary = Path(stream.name)
                progress("Downloading Dropbox shared file…")
                while chunk:
                    count += len(chunk)
                    if count > max_bytes or (expected is not None and count > expected):
                        raise ValueError("Dropbox shared download exceeded its size limit.")
                    if count > free:
                        raise ValueError("Not enough disk space to download this Dropbox file.")
                    digest.update(chunk)
                    stream.write(chunk)
                    if count - announced >= 64*1024**2:
                        announced = count
                        progress(f"Downloaded {count / 1024**2:.0f} MiB from Dropbox shared link")
                    chunk = response.read(1024*1024)
            if expected is not None and count != expected:
                raise ValueError("Dropbox shared download was incomplete; no partial file was accepted.")
            record = {"sha256": digest.hexdigest(), "size": count,
                      "etag": response.headers.get("ETag"), "lastModified": response.headers.get("Last-Modified")}
        target = cache / ("shared-"+record["sha256"]+suffix)
        if target.is_symlink():
            raise ValueError("Dropbox cache entry must not be a symbolic link.")
        os.replace(temporary, target)
        temporary = None
        with tempfile.NamedTemporaryFile(prefix=".link-", suffix=".part", dir=cache, mode="w", encoding="utf-8", delete=False) as stream:
            index_temp = Path(stream.name)
            json.dump(record, stream)
        os.replace(index_temp, index)
        index_temp = None
        progress("Dropbox shared file downloaded; local checksum recorded.")
        return target
    except (urllib.error.URLError, OSError, http.client.HTTPException):
        raise ValueError("Dropbox shared download or cache write failed; no partial file was accepted.") from None
    finally:
        for partial in (temporary, index_temp):
            if partial is not None:
                partial.unlink(missing_ok=True)
