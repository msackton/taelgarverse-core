# Image delivery

Articles use small responsive images. The expand icon opens a screen-filling
viewer over a dimmed page, with the whole image fitted by default. **Download**
saves the full-resolution exported image. **Pan / zoom** loads that original,
then offers dragging, +/−, arrow-key panning, mouse-wheel and pinch zoom.
**Fit to screen** resets the view. Escape, Close and fitted-view backdrop clicks
dismiss it and restore focus to the expand button. Authored image links keep
their destinations. Native inline images remain usable without JavaScript.

## Publication and caching

`scripts/build-images.mjs` creates WebP derivatives of static JPEG, PNG and WebP
files without rewriting their source files. The normal publication path keeps
the full-resolution export. Candidate widths are 96, 192, 320, 480, 640, 960,
1440, 1920 and 2560 pixels, plus a final source-limited size; the longest derivative
edge defaults to 2560. Nothing is enlarged or cropped. JPEG/WebP use quality 82;
PNG uses lossless WebP encoding to retain transparency, lettering and fine lines.
Settings are described in [deployment](deploy.md#image-settings).

Resampled line drawings sometimes compress worse than sharper versions. Choices
dominated by a sharper, cheaper variant are omitted within the inline and popup
groups. Animated PNG/WebP and other formats retain their existing delivery.
Undecodable images retain the original URL and add a publication warning.
Filesystem and processing failures still stop preparation.

The cache recipe includes source content, size/quality and Sharp/libvips versions.
Missing cached files trigger rebuilding. Every published derivative is an asset
entry with the existing content-hashed R2 object key. Derivatives therefore
participate in normal upload deduplication, snapshot retention, cleanup and
rollback. Their content-addressed browser URLs receive immutable cache headers.
No on-demand image transformation service or additional binding is required.

`prepareContent` generates variants before packaging. Local Node previews generate
them only for images in the rendered page, with the same cache and renderer.
Leaflet overlays and tiles keep their separate interactive-map delivery.

## Browser loading

The shared renderer adds `srcset`, `sizes`, aspect-ratio dimensions and asynchronous
decoding to images from the publication index, including generated headers and
embedded notes. It preserves authored sizes/loading choices and custom `srcset`.
The first visible-content image is eager; subsequent images and images inside
closed details/popovers are lazy. Browsers can fetch lazy images near the viewport
before they become visible. Lazy images use `sizes="auto"` with layout fallbacks.

Inline choices stop at 1440 pixels wide. Larger popup choices and the original URL
appear only as inert metadata, which does not fetch their bytes. Opening the viewer
shows the inline image immediately, then selects a screen-sized derivative from
the fitted dimensions with density capped at 2×. Pan/zoom loads the original;
Download links directly to it. Loading races are scoped to the current image/mode,
and a failed larger-image request leaves the existing image visible.

Older snapshots with no derivative metadata still render and support the viewer
using their existing image. New delivery requires both a core deployment and a
fresh content publication. Neither operation is performed by local verification.

## Verification

`tests/images.test.mjs` checks source preservation, cached-file recovery, bounded
dimensions, lossless transparency, animation preservation, responsive markup,
context filtering and Node/Worker delivery. It verifies that rendering fetches no
original-image bytes and covers MIME types, ranges, HEAD, ETags and immutable
caching. Existing publication and retention tests cover the common asset lifecycle.

Local browser checks use copies of Delwath's portrait, Kenzo's desert scene and
the Voltara drawing. Desktop and 390×844 views were inspected for inline layout,
fit-to-screen display, original loading on zoom, controls, keyboard panning,
dragging, reset, Escape and focus return. Authored destinations remain links;
closed details and the final offscreen image remain deferred. Actual touch-device
pinch behavior still merits a device check. These checks measure a small sample,
not full-vault performance or production network latency.

The comparison below uses the previous default optimizer on disposable copies
of the same exports, and the variants selected by the browser at 1× density.
Both desktop and 390×844 views selected these three main image files:

| Sample | Previous published bytes | Responsive bytes |
| --- | ---: | ---: |
| Delwath portrait | 14,006 | 13,228 |
| Kenzo desert scene | 197,556 | 58,188 |
| Voltara drawing | 16,383 | 6,108 |
| **Total** | **227,945** | **77,524** |

That is about **66% fewer image bytes** for the sample. The desktop session also
requested a 2,534-byte portrait thumbnail. Logs on the separate desktop/mobile
origins showed only derivative requests during initial reading. Opening the
fitted popup used a derivative; clicking Download then requested the 442,582-byte
scene original. The downloaded file was checked against the original export.
These are response-body bytes, excluding HTML, scripts, styles, protocol overhead
and cache reuse; they do not establish page-load timing or a full-site reduction.

The full Node test suite passed 222 tests; affected image tests were rerun after
the final candidate-size refinements. No content was published or core deployed.
