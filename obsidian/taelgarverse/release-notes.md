Taelgarverse 1.0.1

- Remove the obsolete top-level `headerVersion` field when Regenerate page header, Add header to current note, or the standalone header tool successfully writes the new header format. Skipped notes remain unchanged.
- Preserve the remaining YAML formatting, comments, field values, BOM, line endings and article text. Nested keys and literal text named `headerVersion` are retained; shared anchors or merges that make removal unsafe are reported for review.
- Include the metadata removal in before/after previews and in the same single undoable Obsidian edit as the header replacement. Regeneration remains idempotent.

Desktop-only; the minimum Obsidian version remains 1.8.0. Rendering itself never edits notes. Reload the updated plugin before using its editor commands or installed standalone tool.

Automated checks cover CLI preview/write behavior, source preservation, YAML edge cases, publication conversion and the editor's single range replacement. The local development installation and a read-only preview of the website's eligible vault notes were checked without rewriting source notes. A fresh BRAT UI installation has not been visually verified.
