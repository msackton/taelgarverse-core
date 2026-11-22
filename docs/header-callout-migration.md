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
| taelgar.org | Node and Worker replace top-level source callout ranges before Markdown rendering. The R2 and compiled-runtime paths use the same handler. Publication uses the native callouts authored in the vault. |
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
- Website preparation: removed both the old normalization in
  `src/website-compatibility.mjs` and the dedicated publication pass that later
  migrated eligible legacy headers. DQL materialization and DataviewJS conversion
  and cleanup operate independently.
- Obsidian: removed the `taelgar-header` code-block processor, saved-title
  detection and code-block/automatic-pronunciation styling. Header indexes mount
  through the callout handler only.
- Publication: retired the core static CLI and the Obsidian publishing adapters.
  Website publication evaluates DQL in Node.
- Compiled notes: no longer emit inferred `bio`/`headerMarkerEnd` boundaries or
  saved-header rewrite source. The renderer reads callouts from the note body;
  old compiled hints are not rendering instructions.
- Authored content: removed implicit versioned-header stripping. Search,
  backlinks and transclusions exclude explicit callouts only. Native Obsidian
  backlink processing masks callout spans to preserve source link offsets.

## Legacy code intentionally retained

The independent CustomJS references live in `tests/helpers/legacy-headers/`.
They use the frozen source inputs in `tests/fixtures/legacy-vault/` for
characterization and parity tests.

The test harness reconstructs complete historical headers and saved-header
replacements with `tests/helpers/full-header-rendering.mjs`. It adds the former
title, pronunciation and version marker around the maintained callout body for
comparisons against frozen outputs. The website and Obsidian plugin use
`renderHeaderCallout` for the information component.

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
5. Compare Obsidian output and taelgar.org local and compiled rendering on the
   converted corpus at multiple dates.

The vault migration let the publisher retire its automatic header conversion
pass. Use the explicit saved-header tools for source edits and see
[publishing header callouts](publishing-pipelines.md#publishing-header-callouts)
for the current publication behavior.
Production deployment/publication, remote pushes and a vault commit each retain
their explicit permission gates.
