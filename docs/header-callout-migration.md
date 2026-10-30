# Header callout transition and legacy review

The callout renderer and explicit source-regeneration tools are implemented.
Rendering never migrates or rewrites source notes automatically. Plugin
installation, releases, content publication and website deployment remain
separate actions. Dynamic replacement of the region above a callout is not
implemented; the explicit writer can replace a recognized saved header.
Current authoring syntax belongs in [vault usage](vault.md#generated-bio-block).

## Runtime contract

`> [!taelgar-header]` explicitly identifies one generated information component.
Titles, pronunciation and surrounding prose remain authored Markdown. The saved
callout body is fallback content, not executable code or configuration. Header
generation ignores it. The shared core retains website and Obsidian layouts.

| Consumer | Implementation and checks |
| --- | --- |
| taelgar.org | Node and Worker replace top-level source callout ranges before Markdown rendering. The R2 and compiled-runtime paths use the same handler. Publication preserves native source callouts and converts eligible legacy headers on the working copy. |
| Old static website | Core's Taelgarverse materializer replaces callouts with generated Markdown for its export date. `website` selects cards/icons; `static` selects the Obsidian-style info callout. Select this materializer explicitly; the original standalone plugin is unchanged. |
| Obsidian | One callout postprocessor serves Reading view and Obsidian's native Live Preview callout widget. No separate header replacement extension competes with that widget. Native callout editing and Source mode expose saved Markdown. Rendering never writes the note. |

Tests cover dated output in both layouts, source boundaries and CRLF, authored
titles/pronunciation, fallback omission, nested/literal examples, index buttons,
refresh/disposal, publication preservation, and rejection of old header triggers.
These are local automated checks, not verification of an installed plugin or
production deployment.

## Removed active header compatibility

- `src/bio-block.mjs`: retired leading code-fence detection, adjacent-title
  inference, HTML marker recognition and automatic saved-header normalization.
  `src/header-callout.mjs` now owns explicit Markdown callout boundaries.
- Website renderer: removed generation triggered by `headerVersion`/`tags`, HTML
  markers or old header fences. It replaces only explicit callouts and does not
  rewrite surrounding headings or pronunciation.
- Website preparation: removed header migration from
  `src/website-compatibility.mjs`. A dedicated publication pass now reuses the
  saved-header writer for eligible legacy headers, without restoring legacy
  rendering. DQL/DataviewJS conversion and cleanup remain separate features.
- Obsidian: removed the `taelgar-header` code-block processor, saved-title
  detection and code-block/automatic-pronunciation styling. Header indexes mount
  through the callout handler only.
- Static materializer: removed native header-fence handling and always disables
  the inherited CustomJS header-regeneration pass. Non-header Dataview and
  CustomJS capabilities remain available for the old static pipeline.
- Compiled notes: no longer emit inferred `bio`/`headerMarkerEnd` boundaries or
  saved-header rewrite source. The renderer reads callouts from the note body;
  old compiled hints are not rendering instructions.
- Authored content: removed implicit versioned-header stripping. Search,
  backlinks and transclusions exclude explicit callouts only. Native Obsidian
  backlink processing masks callout spans to preserve source link offsets.

## Legacy code intentionally retained

`src/headers.mjs`, `src/header-runtime.mjs`, `src/worker-headers.mjs` and the frozen
`tests/fixtures/legacy-vault/` remain independent characterization references.
Do not regenerate these fixtures to make the new syntax appear compatible.

The maintained core still exports `renderBio` and `renderHeader`, including the
saved-header/version rewrite in `OutputHandler.regenerateHeader`, for historical
output comparisons. The Node/Worker adapters and new callout handler do not
invoke these exports. Moving those compatibility helpers entirely into the
reference test harness is a useful subsequent cleanup; retaining them does not
enable a legacy syntax in the callout handler.

The bundled old materializer implementation still contains its original header
helpers and dynamic-website preparation machinery. The Taelgarverse static pass
does not select its header regeneration, and website DQL requests use the
separate exporter. Removing those dormant helpers can be done separately from
the still-required Dataview/CustomJS execution machinery.

Vault-owned CustomJS/Templater scripts and the original materializer have not
been rewritten. They can still produce old syntax if invoked. Update their
authoring commands/templates as part of the source migration so they cannot
reintroduce obsolete headers.

## Vault inventory and conversion requirements

A read-only scan on 2026-10-30 using the configured Store inclusion rules found
2,891 indexed Markdown notes: 2,487 with `headerVersion`, one with a native
`taelgar-header` fence, no HTML header markers, and no new header callouts.
Counts overlap; `headerVersion` identifies candidates, not proof of a particular
saved-header shape. The inventory is not a file-by-file conversion approval.

The shared writer and installed standalone tool now produce dry-run reports and
representative diffs before editing the vault. A read-only `--all` preview on
2026-10-30 scanned 4,548 local Markdown notes (including unpublished/DM notes):
2,169 eligible header changes, 14 already-current headers, 2,221 ineligible
notes (untagged or excluded tags), 144 eligible unmarked notes, and no parse
errors. Eligibility is checked before old/new header detection. No notes were written. This broader selection differs from the
website Store inventory above. See [CLI usage](deploy.md#saved-header-commands).

The conversion review should:

1. Distinguish saved headers, old native fences, versioned handouts with authored
   openings, and ambiguous layouts. Do not classify every versioned heading as
   disposable generated content.
2. Preserve existing titles and pronunciation. Former full-header fences need
   explicit authored title/pronunciation when those are wanted in the note.
3. Convert the intended information component to `taelgar-header`; remove its
   old Dataview view calls rather than storing executable legacy fallback text.
   Remove obsolete top-level `headerVersion` on successful conversion; preserve
   other frontmatter, arbitrary authored prose, images and other callouts.
4. Include both notes and creation/regeneration templates in the reviewed scope.
   Keep unresolved/ambiguous cases in the report for human review.
5. Compare Obsidian output, taelgar.org local/compiled rendering and static
   materializer exports on the converted corpus at multiple dates.

The old static website must select core's materializer via the documented
`TAELGAR_MATERIALIZER` override in [publishing pipelines](publishing-pipelines.md).
Its default original materializer does not implement the new syntax.

The website transition no longer requires a vault source migration. Content
preparation runs `scripts/convert-website-headers.mjs`, which reuses the shared
saved-header writer on publication inputs only. It converts eligible saved info
headers, closed empty legacy header fences and leading HTML header markers.
Existing native headers and unmarked/ineligible notes remain unchanged. Unsafe
boundaries stop preparation with a per-file report. The same stage runs in
build-only and full local previews; neither publishes content.

Deploy the callout-only website code, then republish content. Existing published
legacy headers can regress temporarily between those actions, which the user
has accepted. Publication restores eligible headers independently of when the
source vault is migrated; local Obsidian and the old static website retain
their own authoring/materializer requirements. Code alone does not change an
already-published snapshot. See the [publication transition](publishing-pipelines.md#header-callout-transition).
Production deployment/publication, remote pushes and a vault commit each retain
their explicit permission gates.
