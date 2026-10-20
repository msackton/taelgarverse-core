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
the full-resolution export. Candidate widths come from the actual uses, with
one additional popup version; its longest edge defaults to 2560. Nothing is
enlarged or cropped. JPEG/WebP use quality 82;
PNG uses lossless WebP encoding to retain transparency, lettering and fine lines.
Settings are described in [deployment](deploy.md#image-settings).

`scripts/image-usage.mjs` renders the distinct date/campaign/DM states of each
prepared note and the homepage using the normal Markdown/comment rules. This
captures numeric widths, HTML images, role-based sizes, table thumbnails, comment
popups and alternative reference-style image definitions. Saved generated headers
are omitted as in the other publication compilers; the current generated headers
do not emit images. Literal code, administrative comments, unsafe notes, and
pages excluded from all publication views contribute no uses. Embedded note bodies
are inspected through their source notes. Materialized queries are ordinary
exported content and participate automatically.

The planner uses the widest desktop/mobile bounds for each occurrence. Each use
requests a 1× and 2× inline size, capped at 1440px and native dimensions. Semantic
heroes and galleries allow up to 1936 CSS pixels (the 2000px shell minus gutters),
with inline derivatives capped at 2560px, the configured longest edge, and native
dimensions. Narrower uses retain the 1440px cap. Wide
layouts also request a phone-sized choice. Multiple uses combine into one set;
widths within 25% merge upward. For example, a single fixed 300px image needs
300px and 600px inline copies, plus the popup version. Images with no inline use
get no derivatives, while originals remain indexed for direct asset links.

Resampled line drawings sometimes compress worse than sharper versions. Choices
dominated by a sharper, cheaper variant are omitted within the inline and popup
groups. Animated PNG/WebP and other formats retain their existing delivery.
Undecodable images retain the original URL and add a publication warning.
Filesystem and processing failures still stop preparation.

The cache recipe includes source content, planned widths, size/quality and Sharp/libvips versions.
Missing cached files trigger rebuilding. Every published derivative is an asset
entry with the existing content-hashed R2 object key. Derivatives therefore
participate in normal upload deduplication, snapshot retention, cleanup and
rollback. Their content-addressed browser URLs receive immutable cache headers.
No on-demand image transformation service or additional binding is required.

`prepareContent` plans and generates variants before packaging. Local Node previews
use the same complete usage plan, generating files only for images in the rendered
page. Thus a reused image gets the same widths regardless of which page opens first.
Leaflet overlays and tiles keep their separate interactive-map delivery.

## Browser loading

The shared renderer adds `srcset`, `sizes`, aspect-ratio dimensions and asynchronous
decoding to images from the publication index, including generated headers and
embedded notes. It preserves authored sizes/loading choices and custom `srcset`.
The first visible-content image is eager; subsequent images and images inside
closed details/popovers are lazy. Browsers can fetch lazy images near the viewport
before they become visible. Lazy images use `sizes="auto"` with layout fallbacks.

Inline choices use only the planned inline sizes and stop at 1440 pixels wide
for ordinary uses or 2560 pixels for expanded heroes/galleries. Eager expanded
images use viewport/gutter bounds as a conservative fallback; lazy `sizes="auto"`
uses the actual gallery cell/article width when supported.
The popup-only choice and the original URL
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

The earlier generic size ladder stored 12 derivatives (570,804 bytes) for these
same three sample assets. Usage-based planning stores 8 derivatives (423,618
bytes), about 26% less derivative storage. Including unchanged originals, the
total falls from 1,058,024 to 910,838 bytes, about 14% less. The scene has several
sizes in this test page, so its combined set is larger than a single-use image's.
These storage figures do not include metadata-index overhead or establish a
full-vault estimate. Download measurements above describe the initial browser
verification; the fitted viewer behavior is unchanged.

The full Node test suite passed 224 tests after usage-based planning, including
new checks for precise widths, reused sizes, omitted unused files, homepage,
HTML/table images, and visibility-specific reference definitions. No content was
published or core deployed.
