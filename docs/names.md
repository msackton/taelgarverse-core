# Name explorer

This is an exploratory prototype retained on a draft branch. See
[resumption notes](name-explorer-resumption.md) for design feedback, limitations,
local setup, and the decisions still needed before adopting it.

The **Names** header link opens **/names**, a read-only view of recorded names
across the published vault. It opens with separate **First names** and
**Surnames** shelves from personal names. Choose a language or search, then select
a part to see the recorded full names that use it. Repeated parts are grouped
within their language; the count is distinct people, not repeated aliases.

**All recorded names** switches to the original view grouped by subject type.
Select a whole name there to see its pronunciation, recorded meaning, alternate
forms, and article link. Both views use the same read-only published index.

The overview shows up to sixteen examples spread across each subject type's
alphabetical collection. **Browse all**
opens that collection with pages of seventy-two names or parts. Less populated language
labels are under **More languages**; **Unassigned** retains names with unknown
language. Search ignores case and diacritics. Filter and selection URLs can be
bookmarked, and ordinary links/forms work without JavaScript.

## First names and surnames

The parts view is a browsing interpretation, not adopted vault metadata. It
uses primary personal names and alternate full names, avoiding title, epithet,
translation, and nickname entries. A one-word primary name contributes a first
name. Simple two-word names are split into first name and surname; surname
particles such as **de la** and **van** stay attached. Common leading titles,
regnal numerals, and descriptive endings such as **the Elder** or **of Ashcombe**
do not become surnames. Longer ambiguous names contribute only their first word.
These conservative rules still do not establish a culture's surname order or
whether an ending is hereditary; the details identify unconfirmed browsing splits.

An exact recorded component supplies its own language, pronunciation, and
meaning. Otherwise a part is grouped with the full name's language, and the
details explain this inheritance. A full name's pronunciation and meaning are
never assigned to a smaller component. One-word names retain their own fields.
Source full-name links return to the all-recorded-names view; article links
retain the reader's context. No names are generated and no vault files are changed.

## Sources and interpretation

The compiler reads **Metadata:names:v1** blocks and accepted frontmatter
**name**, **aliases**, and **pronunciation**. Notes tagged as people, places,
groups, powers, objects, creatures, ancestries, events, or religions get a name
fallback even without a block. Other note types, including named works,
participate when they have an explicit name block. Organizational background
and session titles alone do not become name entries.

The first non-component metadata entry is primary unless a form explicitly has
**role: primary**. Component entries appear in details and can supply evidence for
the parts view, rather than becoming independent whole names. Distinct forms are deduplicated within their subject while
preserving spelling and diacritics.

The optional original-vault file
**_Plugins/Name Explorer/Name Decisions.jsonl** supplies direct concept language
assignments and recorded components from the existing Obsidian explorer.
It does not publish the file itself. A direct assignment fills an unknown
language; when it disagrees with a known metadata language, the metadata wins
and the different catalog assignment appears in details. Component assignments
do not establish the language of the entire name. Catalog rules, heuristic
language guesses, prose extraction, form-grouping overrides, and place-evidence
scores are outside this first website view.

Only selected structured fields are published. Free-form metadata/decision
notes, lint reports, private evidence, and source paths are not copied into the
name index. Proposed, inferred, disputed, and unresolved entries retain their
status; a proposal is not silently treated as accepted. Malformed blocks produce
a preparation warning and eligible notes retain their frontmatter fallback.
Language labels retain their authored spelling, including older or inconsistent
labels; the website does not rewrite vault metadata.

## Publication and reader context

The explorer deliberately covers the whole published vault. Campaign selection,
in-world date, POV preference, and Behind the Curtain do not filter its names,
including alternate forms recorded in name blocks. Article links retain the
reader's context and articles continue to apply their ordinary availability
rules. Normal file/folder publication exclusions and **excludePublish: all** still
remove subjects from the explorer.

Local Node previews compile names once per engine from the current source and
the original vault's decisions. The preview supervisor restarts after relevant
vault changes. Packaging compiles the same version-1 index into the optional
**names** field of the revision's **index.json**. The publisher fingerprints the
decision store and name compiler. Both the updated website code and a fresh
content publication are required for the hosted feature. Older snapshots remain
readable and show an unavailable-index message on **/names**; no request scans
all Markdown shards to rebuild an index.

The name index follows the existing snapshot activation, retention and rollback
lifecycle, and requires no new binding or D1 migration.

## API and ownership

**GET /api/names** accepts **view**, **language**, **kind**, **find**, **name**, and **offset**,
plus the site's context parameters for article URLs. It returns language counts,
grouped forms, selected details, related forms, pagination, and the HTML used
by progressive browser navigation. Filters are bounded and authored strings
are escaped. The API is read-only and uses the normal no-store response policy.
**view=parts** is the default, with **kind=given** or **kind=family**; **view=names**
uses the existing subject types. Old URLs selecting a whole-name ID or a subject
type still select the whole-name view when **view** is omitted.

- **scripts/compile-names.mjs**, **scripts/name-sources.mjs**: source reading and
  snapshot compilation; no production writes.
- **src/names.mjs**, **src/names-view.mjs**: querying and escaped server presentation.
- **public/names.js**, **public/names.css**: progressive navigation and layout.

Verification lives in **tests/names.test.mjs** and the Worker publication tests.
Editing and review remain in the vault; this feature makes no AI requests and
does not generate or adopt new names.
