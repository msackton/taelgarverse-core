# Index registry: v1 YAML reference

Named queries are defined in the vault’s `_scripts/indexes.yaml`. Copy the
[base example](../examples/indexes.yaml) and, optionally, the
[personal profile](../examples/indexes.mike.yaml) to get started. The tables below
describe the implemented v1 syntax.

| Reference | Contents |
| --- | --- |
| [Registry keys](#registry-keys) | File structure and host patches |
| [Index keys](#index-keys) | Named definitions and invocation options |
| [Columns](#columns) | Presets, arbitrary fields, templates, formats |
| [Display examples](#display-examples) | Table and card examples |
| [Cards](#cards) | Title, subtitle, body, footer, image toggle |
| [Sort](#sort) | Typed ordering in both layouts |
| [Fields](#fields) | All metadata and calculated field meanings |
| [Filters](#filters) | Flat AND conditions and comparisons |
| [Relationships](#relationships) | Home, affiliation, watershed |
| [Inheritance](#inheritance) | Extends for conditions and columns |
| [Headers](#headers) | Automatic rules and explicit lists |
| [Profiles](#profiles) | Shared file, one override, host rules |
| [Base definitions and core queries](#base-definitions-and-core-queries) | Six worked queries |
| [Publication and scope](#publication-and-scope) | Validation, migration, deferred features |

## Registry keys

Location: the selected YAML registry file. Index/rule IDs start with a lowercase
letter and contain lowercase letters, digits, or hyphens, such as `members` or
`organization-members`. Labels are human-readable text.

| Key | Required / default | Meaning |
| --- | --- | --- |
| `version` | Required: `1` | Schema version. Optional in an override; if present there, also `1`. |
| `indexes` | Empty map | Named definitions keyed by index ID. |
| `headerRules` | Empty map | Automatic header rules keyed by rule ID. |
| `hosts` | Empty map | Host patches, with optional `website` and `obsidian` keys. |
| `hosts.website` | No patch | Website-only `indexes` and/or `headerRules` overrides. |
| `hosts.obsidian` | No patch | Obsidian-only `indexes` and/or `headerRules` overrides. |

Definitions are vault content. Changing a definition using supported fields and
operators requires a vault refresh/publication, rather than a core rebuild.

## Index keys

Location: `indexes.<id>`. Required keys apply to complete enabled definitions;
override files can provide partial patches.

| Key | Required / default | Meaning |
| --- | --- | --- |
| `label` | Required text | Inline title and header-button label. |
| `enabled` | `true` | `false` suppresses this index everywhere while retaining its settings. |
| `extends` | None | One parent ID. Inherits only `where` and `columns`; see [inheritance](#inheritance). |
| `where` | Required, own or inherited | A field/relationship condition, or a flat `all` list. |
| `target` | Source note | Default target for relationship matching. |
| `mode` | `grid` | Inline layout: `grid` or `table`. |
| `show` | `both` | Host availability: `both`, `website`, or `obsidian`. |
| `heading` | `true` | Show the inline title. Header popups supply their own title. |
| `columns` | Inherited, otherwise `[name]` | Non-empty ordered list of table columns. |
| `cards` | See [cards](#cards) | Independent grid presentation settings. |
| `sort` | Page name, then path | Ordered list of sort keys. `[]` uses the default. |
| `header.mode` | `grid` | Header-popup layout, independent of inline `mode`. |
| `header.hideWhenEmpty` | `true` | Hide the header button when no visible result matches. |

### Inline invocation keys

Inside a `taelgar-index` fence, `index` is required. Queries are defined in the
registry; invocations select a query and can change its target or presentation.

| Key | Meaning |
| --- | --- |
| `index` | Required named index ID. |
| `target` | Override the relationship target. |
| `label`, `mode`, `show`, `heading` | Override the corresponding display setting. |
| `columns`, `sort` | Replace the corresponding list for this invocation. |
| `cards` | Merge settings by key; supplying a position replaces that position's complete content. |

No ad hoc queries, invocation `where`, or invocation `extends` in v1. An
invocation cannot re-enable a disabled definition.

### Source, target, and date

| Term / value | Meaning |
| --- | --- |
| Source / `$source` | Note containing the block or receiving header buttons. Transcluded blocks keep their owning note as source. |
| Target / `$target` | Resolved relationship target, defaulting to the source note. |
| Candidate | Note being considered for a row/card. Field paths refer to this note. |
| Selected date | In-world date used for lifecycle and relationship matching, not the computer's date. |

Literal targets can be note names, aliases, vault-relative paths, or quoted
wikilinks such as `"[[Sembara]]"`. Explicit `./` and `../` invocation targets
are source-relative. Registry references use vault-relative paths or unambiguous
names, rather than the YAML file's folder. Wikilink display aliases do not change
identity. `$source` and `$target` are complete reference values, not expressions.
V1 has no custom parameters or date expressions.

## Columns

`columns` controls a table's **headings, cell contents, and left-to-right order**.
Each result note becomes one row. Each list entry creates one column.

```yaml
columns: [person, info, home]
```

This means: a Person column, an Info column, then a Home column. Short names
such as `person` are **presets**: saved combinations of a label and display
definition. Custom objects can read arbitrary frontmatter or use a header
template. You can mix presets and custom objects in one list. The `image` and
`firstSentence` presets add an image thumbnail or prose summary column.

### Column presets

All presets are global. They display values; the query's filters determine
which notes appear. Missing values normally show `—`.

| Preset | Column heading | What the reader sees |
| --- | --- | --- |
| `name` | Name | Linked display name, with available pronunciation. |
| `person` | Person | Linked name, followed by available pronouns and pronunciation in parentheses. Empty parentheses are removed. |
| `info` | Info | Ancestry plus displayed species/type, such as `Sembaran dwarf`. |
| `type` | Type Of | Displayed classification, including aliases; for example `city` rather than raw `settlement`. |
| `population` | Population | Header population wording, such as `pop. 12,500`; authored text is retained. |
| `region` | Region | First ancestor above the immediate home with raw `typeOf: region` or `typeOf: realm`, found through the dated home/parent chain. Uses `Taelgar` if none qualifies. A matched website-hidden destination displays as `Unknown`. |
| `home` | Home | Immediate home using the header location formatter, with `Unknown` when absent. |
| `lastKnown` | Current Location | Current or last-known location chain, including regional context and an observation date when available. |
| `lastKnownCompact` | Current Location | The existing compact member-style location chain, omitting region-type ancestors, plus an available observation date. |
| `start` | Start | Known lifecycle start date, retaining recorded precision. |
| `end` | End | Known lifecycle end date, including a recorded future end. |
| `role` | Role | Title(s) of affiliations matched by this query, such as `Scout`. |
| `organization` | Organization | Actual matching organization(s), linked to their notes. |
| `joined` | Joined | Known matching membership start date(s). |
| `left` | Left | Known explicit departure dates for matched affiliations already ended at the selected date. Death does not supply this value. |
| `status` | Status | `current` or `former` for the matched affiliations; independent of whether the person is alive. |
| `image` | Image | Thumbnail from `metadata.image`; empty when no usable image exists. Table columns only. |
| `firstSentence` | Description | First visible ordinary prose sentence from the note body. Available in columns and card positions. |

For a name without pronouns, choose `name`. To omit pronunciation too, use a
custom template such as `<name>`. To show a date without header wording, use
`field: life.start` or `field: life.end` with date formatting.

### Containing region

`region` resolves the candidate note's immediate home, then starts searching
above that home in the home/parent chain at the selected date. It returns the
first ancestor whose raw `typeOf` is `region` or `realm`, whichever comes first.
The candidate and its immediate home are always excluded from the ancestor
search, even if the home itself is a realm or region. It skips intervening buildings and
settlements and does not use temporary travel locations.
Aliases such as `typeOfAlias: barony` do not change the classification.

For example, the chain `Rinburg → Barony of Aveil → Sembara → Greater Sembara`
skips the immediate home, Barony of Aveil, then selects Sembara (`typeOf: realm`).
The display is:

```yaml
index: settlements-in
target: "[[Barony of Aveil]]"
mode: table
columns: [name, home, region]
```

| Name | Home | Region |
| --- | --- | --- |
| Rinburg | Barony of Aveil | Sembara |

A building whose home is Rinburg shows Home as Rinburg and Region as Barony of
Aveil. If no qualifying ancestor exists above the home, Region is `Taelgar`.
This is a fixed root fallback: even when the immediate home is already Taelgar,
the search skips it and the fallback still displays Taelgar.

The calculated display/sort field is `location.region`. `region` can also be
used in a card position, such as `footer: region`. The Taelgar fallback does not
require a Taelgar note: it displays as text unless the host can resolve a visible
link. A matched website-hidden region/realm still displays as `Unknown` under
the normal visibility rules. The search never substitutes a town or building.

### Custom display definitions

These objects work in table columns and card positions. Cards use the position
to determine styling, so custom card definitions do not need a label.

| Key | Required / default | Meaning |
| --- | --- | --- |
| `label` | Required non-empty text for a custom column | Table heading. Optional and not rendered in a card position; an existing column object can be reused there. |
| `field` | Exactly one of `field` / `template` | Field path whose value supplies the cell. |
| `template` | Exactly one of `field` / `template` | Header display string combining tokens and literal text. |
| `format` | Field-specific | `text`, `number`, `date`, `boolean`, `link`, or `list`. For field definitions only. |
| `trueText` | `"Yes"` with `format: boolean` | Text/icon for a true value. An empty string intentionally displays nothing. Only valid with boolean formatting. |
| `falseText` | `"No"` with `format: boolean` | Text/icon for a false value. An empty string intentionally displays nothing. Only valid with boolean formatting. |
| `separator` | ` · ` | Join multiple usable field values. For field definitions only. |
| `empty` | `—` in columns; `""` in card positions | Text when no usable value exists. Empty card content is omitted; an empty title falls back to the note name. Presets retain their documented fallbacks, such as Home's `Unknown`. |

Labels and values are escaped text. Templates use their token formatting and
do not accept `format` or `separator`. Arbitrary JavaScript is not evaluated.
To include a visible label on a card, write it into a template, for example
`template: "Home: <home:1>"`.

### Display formats

| Format | Behavior |
| --- | --- |
| `text` | Scalar text. Explicit wikilinks resolve. Zero and false remain visible. |
| `number` | Numbers/plain numeric strings with separators, such as `12,500`. Invalid values use `empty`. |
| `date` | DR date text retaining recorded precision: a year stays a year. Invalid/unknown dates use `empty`. |
| `boolean` | Map a boolean to `trueText` or `falseText`. Accepts booleans and literal `true`/`false` strings; other values use `empty`, without arbitrary truthiness. |
| `link` | Resolve note references to host-native links. Unresolved references display as text; website-hidden authored wikilinks display as `Unknown`. |
| `list` | Join scalar list values with `separator`. Explicit wikilinks resolve. Objects need a scalar property path. |

These six formats apply to field definitions. Image thumbnails and first
sentences are selected with the `image` and `firstSentence` display presets.
The image source is fixed to `metadata.image` in v1.

With boolean formatting, `trueText: ""` or `falseText: ""` is an intentional
blank, rather than a missing value: it does not trigger the `empty` fallback.
In a card position that item is omitted. `empty` applies to missing/invalid input.

| Field | Default format |
| --- | --- |
| `metadata.*` | `text` |
| Known date fields | `date` |
| `page.name`, location references, `membership.org` | `link` |
| `page.tags` | `list` |
| Other scalar fields | `text` |

Scalar formats also accept scalar lists: format usable values, combine duplicates,
and join them. Hidden calculated locations are missing before formatting and
therefore use `empty`. Display fallbacks never become filter values.

### Header templates

Templates reuse the existing header formatter and its punctuation cleanup.
Token spelling is case-insensitive; field-path spelling is case-sensitive.

| Tokens | Meaning |
| --- | --- |
| `<name>`, `<pronouns>`, `<pronunciation>` | Identity display. Pronouns retain the metadata/gender fallback. |
| `<ancestry>`, `<species>`, `<typeOf>`, `<maintype>` | Classification names/aliases. `maintype` prefers species when supplied. |
| `<startDate>`, `<endDate>`, `<targetDate>` | Lifecycle dates and selected date. |
| `<startStatus>`, `<endStatus>`, `<age>` | Header status wording and formatted age. |
| `<home>`, `<current>`, `<lastknown>`, `<origin>`, `<secondary>` | Formatted dated location chains. Available for display even though v1 has no general location query. |
| `<lastknowndate>` | Observation/current date associated with the last-known display. |
| `<population>` | Existing population wording. |
| `<primary>`, `<nonprimary>`, `<affiliations>`, `<partof>` | Candidate's header relationships, rather than just this query's matched affiliations. |

| Example | Meaning |
| --- | --- |
| `<name:n>` | Unlinked name |
| `<home:1>` | Immediate home |
| `<lastknown:2>` | Limited location chain |
| `<lastknown:2Fr>` | Existing compact member-style location chain |

For arbitrary metadata use `field: metadata.<path>`. For only the queried
organization's roles use `membership.title`, rather than `<affiliations>`.

## Display examples

Values in this section are illustrative. In the application, resolved note names
are clickable. Tables below show their visible text.

### Preset people table

```yaml
index: residents
target: "[[Sembara]]"
mode: table
columns: [person, info, home]
```

| Person | Info | Home |
| --- | --- | --- |
| Merrin Copperharp (she/her) | Sembaran dwarf | The Lantern Inn |

`person` combines identity details; `info` combines ancestry/species; `home`
shows the immediate residence. The inn's containing town is used by the recursive
filter, but the `home` preset displays the inn itself.

### Custom labels and arbitrary metadata

Given a person's frontmatter containing:

```yaml
occupation: smith
languages: [Dwarvish, Common]
```

Use:

```yaml
index: residents
mode: table
columns:
  - name
  - label: Occupation
    field: metadata.occupation
    empty: Unrecorded
  - label: Languages
    field: metadata.languages
    format: list
    separator: ", "
  - label: Residence
    field: location.home
```

| Name | Occupation | Languages | Residence |
| --- | --- | --- | --- |
| Merrin Copperharp | smith | Dwarvish, Common | The Lantern Inn |

Any authored metadata property can supply a column. `label` controls the heading;
`field` controls the value. Missing occupation displays `Unrecorded`.

### Population preset versus a plain numeric column

```yaml
index: major-cities
mode: table
columns:
  - name
  - population
  - label: Population number
    field: metadata.population
    format: number
```

For an authored population of `12500`:

| Name | Population | Population number |
| --- | --- | --- |
| Example City | pop. 12,500 | 12,500 |

The preset uses the header's population wording. The custom field uses numeric
formatting. Either can be selected independently of filtering or sorting.

### Family table with dates only

```yaml
index: family-members
target: "[[Charmhearts]]"
mode: table
columns:
  - name
  - label: Born
    field: life.start
    empty: Unknown
  - label: Died
    field: life.end
    empty: ""
```

| Name | Born | Died |
| --- | --- | --- |
| Example Elder | 1680 | 1735 |
| Example Younger | 1710 | |

These custom date fields omit status wording inside each cell. The `start`
and `end` presets show the same dates with generic headings. An empty cell means no usable
end date was supplied; it is not itself a living-person test.

### Skull icon for deceased or ended subjects

```yaml
index: family-members
target: "[[Charmhearts]]"
mode: table
columns:
  - name
  - label: Life status
    field: life.active
    format: boolean
    trueText: ""
    falseText: "💀"
```

| Name | Life status |
| --- | --- |
| Example Elder | 💀 |
| Example Younger | |

The true value of `life.active` produces a blank cell; the false value produces
the chosen icon. Use any text/icon, such as
`falseText: "💀 Deceased"`. The same definition works in a card position:

```yaml
cards:
  footer:
    field: life.active
    format: boolean
    trueText: ""
    falseText: "💀"
```

The base family/places queries already require `life.exists`. That excludes
subjects that have not started, so false means ended/dead/destroyed in these
results. A custom query without that restriction can also have false for a
not-yet-born/created subject; require `life.exists` when using the skull that way.

### Table with images and first sentences

```yaml
index: residents
target: "[[Sembara]]"
mode: table
columns: [image, person, info, firstSentence]
```

| Image | Person | Info | Description |
| --- | --- | --- | --- |
| (thumbnail) | Merrin Copperharp (she/her) | Sembaran dwarf | Merrin watches the northern roads. |

The Image cell contains an actual thumbnail in the application. Missing images
and first sentences leave empty cells. The prose is filtered for the reader's
date/campaign/comment visibility before its first sentence is selected.

### Grid with named positions

```yaml
index: current-members
target: "[[Rangers]]"
mode: grid
cards:
  image: true
  title: person
  subtitle: info
  body: firstSentence
  footer:
    - role
    - template: "Home: <home:1>"
```

Illustrative card text:

> **Merrin Copperharp (she/her)**
>
> *Sembaran dwarf*
>
> Merrin watches the northern roads.
>
> Scout
>
> Home: The Lantern Inn

An available `metadata.image` supplies the image. Title is the heading, subtitle
is supporting text, body is the main content, and footer is bottom metadata.
Footer items appear in the listed order. Positions have no automatic labels.
`columns` controls table mode; card positions control grid mode independently.

To turn images off and remove the footer:

```yaml
cards:
  image: false
  footer: null
```

## Cards

Location: `cards` on a definition or invocation. Cards have four content positions
and a separate boolean image setting.

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | `name` | Main heading. Uses display items below; empty results fall back to the note name. |
| `subtitle` | `null` | Supporting text immediately below the title. |
| `body` | `null` | Main card content, commonly `firstSentence`. |
| `footer` | `null` | Supporting metadata at the bottom of the card. |
| `image` | `true` | Show an available supported local image from `metadata.image`. `false` hides it. Custom image-source fields are deferred. |
| `count` | `false` | Show the number of matching visible notes for this grid. |

Each position accepts a preset, a custom display definition, or an ordered list
of those items. Lists stack content in that position; custom definitions can
combine values into one line with a template. `image` is reserved for the
separate toggle and cannot be used as a position's display item.

Omit or set `subtitle`, `body`, or `footer` to `null` to hide that position. `[]`
also clears an optional position. Title must have a display item; if its evaluated
content is empty, use the note name. No automatic field labels are added.

`firstSentence` reads filtered note bodies, skipping headings, callouts,
blockquotes, code, lists, tables, and image-only paragraphs. This applies wherever
the preset is used, including table columns. Metadata-only tables still avoid
body reads. Missing/hidden/invalid images are omitted from grids and leave empty
image cells in tables. The image toggle affects only grids; tables show images
only when their column list contains `image`.

## Sort

Location: `sort`, an ordered list. Applies to tables and grids; a sort field
does not have to be displayed.

| Key | Required / default | Meaning |
| --- | --- | --- |
| `field` | Required | Any output field available for the query. |
| `format` | Field's normal default | `text`, `number`, `date`, `boolean`, `link`, or `list`. |
| `direction` | `asc` | `asc` or `desc`. |

```yaml
sort:
  - field: metadata.population
    format: number
    direction: desc
  - field: page.name
```

Numbers/dates sort by their underlying values; links by visible names. Boolean
sorting puts false before true in ascending order and ignores display text/icons. Text
ordering is natural and case-insensitive. Partial date sort keys use the first
day of the recorded year/month. Missing/invalid values stay last in
either direction. Lists use their first usable value. Name and path break ties;
omitted `sort` or `[]` uses name/path. No templates or arithmetic sort keys.
The `image` and `firstSentence` presets are display-only and are not sort fields.

## Fields

Fields are authored metadata paths or values calculated by the engine. They are
not extra frontmatter that every note must acquire. Paths are case-sensitive.

| Field family | Filter use | Display/sort use |
| --- | --- | --- |
| `metadata.*` | Yes, scalar values and scalar lists | Yes |
| `page.*` | Yes | Yes |
| `life.exists`, `life.active` | Yes, booleans | Yes |
| `life.start`, `life.end` | No; calculated date comparisons deferred | Yes, dates |
| `location.home`, `location.current`, `location.lastKnown`, `location.secondary` | Relationship predicates handle matching | Yes, immediate location links |
| `location.region` | No | Yes, first containing region/realm above the immediate home, or `Taelgar` if none qualifies |
| `membership.*` | Relationship predicate handles matching | Yes, for affiliation queries |

### Authored metadata

`metadata.species`, `metadata.typeOf`, `metadata.population`, and
`metadata.occupation` read those frontmatter properties. Dotted paths such as
`metadata.industry.goods` read nested objects. Scalar lists can be displayed or
tested for an equal item. Values retain authored types and are not date-filtered.

Objects are not automatically rendered as text. Traversal through lists of
objects, scoped list matching, bracket expressions, literal-dot property names,
and JavaScript-internal paths such as `constructor` are outside v1.

### Page fields

| Field | Value |
| --- | --- |
| `page.name` | Display name for filtering; linked note identity/name with available pronunciation for output. |
| `page.path` | Vault-relative Markdown path, including `.md`. |
| `page.kind` | Existing tag-based header classification: `person`, `place`, `group`, `object`, `event`, `power`, `ancestry`, `creature`, or `unknown`. |
| `page.tags` | Frontmatter tags normalized to a list without leading `#`. Excludes body inline tags. |
| `page.mainType` | Displayed species/type classification, including aliases. |

Use `metadata.typeOf` for raw classification, such as `settlement`, and
`page.mainType` for displayed wording, such as `city`.

### Lifecycle fields

The engine reads start/end dates from the shared header metadata interpretation:
typically `born`/`died`, `created`/`destroyed`, or applicable `DR`/`DR_end`.

| Field | Meaning |
| --- | --- |
| `life.exists` | Has started by the selected date. Missing start imposes no restriction. Remains true after death/destruction. |
| `life.active` | Passes `life.exists` and has not ended at the selected date. Missing end imposes no end restriction. |
| `life.start` | Known start/birth/creation date, preserving precision; missing when unknown. |
| `life.end` | Known end/death/destruction date, preserving precision; can be an authored future date. |

For a place tagged `place`, created in 1600 and destroyed in 1700, a query in
1750 sees `page.kind: place`, `life.exists: true`, and `life.active: false`.
Visibility applies before filtering; these fields cannot reveal website-hidden
notes. Interval boundaries are inclusive. A partial start uses the first day
of the recorded year/month; a partial end uses its last day. Quoted and numeric
years have identical index behavior. This normalization applies to index
lifecycle, home, and affiliation intervals; legacy header output elsewhere
retains its existing conventions.

### Display-only location fields

| Field | Value |
| --- | --- |
| `location.home` | Active immediate home at the selected date. |
| `location.region` | First ancestor above the immediate home with raw `typeOf: region` or `typeOf: realm` in the dated home/parent chain. Excludes the candidate and immediate home from the search; returns `Taelgar` if no ancestor qualifies. |
| `location.current` | Current location without fallback. |
| `location.lastKnown` | Current when known, otherwise last-known. |
| `location.secondary` | Secondary location, including watershed relationships. |

These are available as display/sort fields. Templates can additionally display
chains, origin, and observation dates. Missing/hidden destinations are missing
field values. Unresolved authored locations may display as text.

### Matched membership fields

Available only as display/sort fields for a query with one affiliation predicate.
Only affiliations matching its target and state supply values.

| Field | Value |
| --- | --- |
| `membership.org` | Actual matching organization; recursive matching may identify a chapter. |
| `membership.title` | Matching role, with the shared fallback when not explicit. |
| `membership.start` | Known matching start date; unknown sentinel dates are omitted. |
| `membership.end` | Known explicit departure date for a matching affiliation ended before the selected date. Active/unknown ends are omitted. Death does not supply an end. |
| `membership.status` | `current` or `former`, based on explicit affiliation dates. |

There is one row/card per note. Multiple matching roles produce combined values,
ordered by membership start, end, and title, with duplicate values combined.
Filtering individual roles or affiliation records is deferred.

## Filters

`where` is one field predicate, one relationship predicate, or a **flat** `all`
list. Every condition must pass. Inheritance combines these conditions into one
flat list. A resolved query can have at most one relationship predicate. Empty
conditions and `all: []` are errors.

```yaml
where:
  all:
    - field: page.kind
      eq: person
    - field: metadata.species
      in: [dwarf, elf]
```

An index with no relationship condition searches all visible matching notes.
There are no nested groups, `any`, `not`, `some`, or per-affiliation `where` in v1.

### Field predicate keys

| Key | Required / default | Meaning |
| --- | --- | --- |
| `field` | Required | An allowed filter field from the field reference. |
| `as` | Preserve authored type | Optional `text` or `number` comparison conversion. Does not control display. |
| One operator below | Required | Exactly one operator. Use separate `all` entries for multiple tests. |

| Operator | Operand | Meaning |
| --- | --- | --- |
| `eq` | Scalar | Any field value equals the operand. Text comparison is case-insensitive. |
| `ne` | Scalar | Comparable values exist and none equals the operand. |
| `in` | Non-empty scalar list | Any field value equals any listed item. |
| `exists` | Boolean | At least one value is present, or none is present for `false`. |
| `gt`, `gte`, `lt`, `lte` | Number | Any numeric value is greater than, at least, less than, or at most the operand. Use `as: number` for plain numeric strings. |

`0` and `false` are present; null, empty text, and empty lists are absent. Missing
or unconvertible values fail comparisons, including `ne`. Number `1200` differs
from text `"1200"` unless converted. Decorated text such as `"pop. 1,200"` cannot
convert to a number. `exists` checks presence before conversion.

### Place groupings live in YAML

V1 has no calculated `place.category`. A named index groups raw `typeOf` values
with `in`, so category membership can change through vault configuration.

| Suggested grouping | Raw `typeOf` values |
| --- | --- |
| Built | `settlement`, `neighborhood`, `realm`, `inn`, `building`, `holy site`, `road`, `infrastructure`, `battlefield` |
| Natural | `region`, `watershed`, `forest`, `wetlands`, `desert`, `grassland`, `waterway`, `lake`, `marine feature`, `topographical feature`, `topographic feature`, `subterranean feature`, `island` |
| Plane | `plane`, `extraplanar domain`, `planar link` |

```yaml
indexes:
  planar-places:
    extends: places
    label: Planar places
    where:
      field: metadata.typeOf
      in: [plane, extraplanar domain, planar link]
```

This groups note types. A settlement on another plane still has raw type
`settlement`; a containment query selects where it belongs.

## Relationships

All relationship predicates resolve note identities at the selected date.
Explicit unavailable, ambiguous, or wrong-kind targets produce an index error.
Self-matches are excluded. Cycles are bounded and can omit affected candidates
with a warning while leaving other results readable.

### Home

| Key | Required / default | Meaning |
| --- | --- | --- |
| `relation` | `home` | Match the active home/parent-place relationship. |
| `within` | Required place reference | Usually `$target`. |
| `recursive` | `false` | Follow the home/parent chain when true. |

String `whereabouts` and legacy `primary` entries supply home relationships;
place `partOf` is the fallback when no whereabouts are supplied. Recursion
follows home containment, excluding temporary travel records. The predicate
adds no implicit person/place or lifecycle condition.

```yaml
relation: home
within: $target
recursive: true
```

### Affiliation

| Key | Required / default | Meaning |
| --- | --- | --- |
| `relation` | `affiliation` | Match affiliation/leadership records. |
| `target` | Required organization reference | Usually `$target`. |
| `state` | `current` | `current` or `former`, defined below. |
| `recursive` | `false` | Also accept organizations connected to the target through `partOf`. |

| State | Meaning at the selected date |
| --- | --- |
| `current` | Membership has started and has not explicitly ended. Includes someone who died while still a member. |
| `former` | Membership has started and explicitly ended before the selected date. |

Death is recorded on the person. An affiliation's explicit `end` records
departure. Missing membership dates impose no corresponding start/end
restriction; `former` requires a known past end. Future starts never match.
The departure day itself remains inside the membership interval.

```yaml
relation: affiliation
target: $target
state: current
```

Use `life.active: true` as a separate field condition to require living members.
For a family roster including deceased relatives, omit that condition.

This deliberately changes index matching from the current helper's death-as-end
fallback. The matcher must retain explicit affiliation dates separately. No
`historical` state or current/historical picker is supported.

### Watershed

| Key | Required / default | Meaning |
| --- | --- | --- |
| `relation` | `watershed` | Match dated home/secondary containment to a watershed target. |
| `within` | Required watershed reference | Usually `$target`; target must be a place with `typeOf: watershed`. |
| `recursive` | `false` | Follow home/secondary containment through intermediate places and nested watersheds. |

This handles existing mixed metadata: Valmont names Istaros Watershed as home,
while Silverflood has home Alta Tonaro and secondary Yeraad Watershed. Both forms
participate in watershed matching. Away/current/last-known travel records do not.

```yaml
relation: watershed
within: $target
recursive: true
```

This is the narrow extra relationship needed for rivers/lakes. General
`location`, `via`, and `homeOrIn` queries are outside v1.

## Inheritance

`extends` accepts one parent and inherits **only conditions and table columns**.

| Property | Behavior |
| --- | --- |
| `where` | Parent conditions AND child conditions. Flatten into one list; at most one relationship in the resolved query. |
| `columns` omitted | Inherit the parent's list. |
| `columns` supplied | Replace the parent's whole list. |
| Other properties | Use the child's own settings/defaults. Label, cards, sort, target, enabled, mode, and header settings are not inherited. |

Resolve inheritance after file/host patches, so parent condition/column changes
affect children. Unknown parents and cycles are errors. A child cannot broaden a
parent's query or replace its relationship by adding another condition. Create
a complete new query for that case.

## Headers

### Automatic rule keys

Location: `headerRules.<id>`. Rules use the same restricted field-filter syntax;
v1 header applicability tests are field conditions, without relationships.

| Key | Required / default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable/disable this automatic rule while retaining its settings. |
| `when` | Required | Field predicate or flat `all` list, evaluated against the note receiving the header. |
| `indexes` | Required ordered list | Named index IDs. String entries only. |

```yaml
headerRules:
  organization-members:
    enabled: false
    when:
      field: page.kind
      eq: group
    indexes: [members]
hosts:
  website:
    headerRules:
      organization-members:
        enabled: true
```

All matching rules contribute IDs in registry order. Duplicate IDs are combined,
keeping their first position. New profile rules follow existing rules.

### Explicit note frontmatter

```yaml
indexes: [residents, settlements-in]
```

An explicit list replaces all automatic rules for that note, including personal
rules. `indexes: []` suppresses automatic buttons. Omit the property to use rules.
Object entries, entry IDs, and entry-specific options are deferred. Create a
separate named definition when another configured header presentation is needed.

The target is the named definition's target, otherwise the header's note.
`header.mode` selects the popup layout. `header.hideWhenEmpty` checks for a
visible match without formatting rows or loading descriptions. A disabled rule
affects only that automatic placement; a disabled index suppresses all its uses.

Buttons attach to generated `taelgar-header` blocks. Obsidian's **Show header
index popups** remains the master switch for all header buttons, including
explicit lists. Inline indexes remain available.

## Profiles

V1 loads one shared file and at most one explicitly selected override file.
The override may add named definitions or change parts of existing definitions.

| Host | Setting | Meaning |
| --- | --- | --- |
| Obsidian | `indexRegistry` | Base file, recommended `_scripts/indexes.yaml`. |
| Obsidian | `indexOverride` | One optional path; null/no selection means none. |
| Publisher config | `index_registry` | Base file relative to `vault_dir`. |
| Publisher config | `index_override` | One optional path; null/no selection means none. Independent of Obsidian. |

The base defaults to `_scripts/indexes.yaml`. Obsidian’s blank base setting uses
that default; publisher omission does the same. When that default does not
exist, ordinary notes still work and no indexes are configured. An explicitly
selected missing base/profile is an error. `index_override: null` disables a
publisher profile; omission selects none unless inherited from shared config.

All these paths are vault-relative, including publisher paths supplied in
`config.local.json`. File names do not activate profiles.

Obsidian settings representation:

```yaml
indexRegistry: _scripts/indexes.yaml
indexOverride: _scripts/indexes.mike.yaml
```

Publisher configuration:

```json
{
  "index_registry": "_scripts/indexes.yaml",
  "index_override": null
}
```

Use `_scripts/indexes.mike.yaml` as a Git-shared profile selected on each
computer. Alternatively select a Git-ignored `_scripts/indexes.local.yaml` for
installation-only settings. V1 does not stack both profiles. Sharing a file in
Git makes it readable to collaborators; selection determines who applies it.

### Application and merge order

1. Shared file's ordinary settings, then its matching host patch.
2. Selected override's ordinary settings, then its matching host patch.
3. Resolve inheritance of conditions/columns.
4. Apply inline target/presentation overrides, if any.

| Part | File/host patch behavior |
| --- | --- |
| Index/rule maps | Merge by ID; new IDs add entries. |
| Ordinary settings maps, including `cards` and `header` | Merge properties; later values win. |
| Lists, including `columns`, `sort`, and rule `indexes` | Replace the whole list. |
| `where`, rule `when`, and each card position | Replace as a whole, including a position's custom definition or item list. |
| `enabled: false` | Disable while retaining settings. |
| `null` | Only where documented, such as optional card positions; not a universal delete operation. |

A file patch replacing `where` replaces that definition's own condition. It can
broaden that condition; inherited parent conditions still apply. This differs
from `extends`, which adds conditions. Use `cards.body: null` or
`cards.footer: null` to clear those positions.

### Mike's personal override

```yaml
indexes:
  residents:
    columns:
      - person
      - home
      - label: Review status
        field: metadata.reviewStatus
        empty: ""
hosts:
  obsidian:
    headerRules:
      organization-members:
        enabled: true
```

With the shared header-rule example, the website gets Members automatically.
Mike gets it in Obsidian after selecting this profile; other Obsidian users do
not. Explicit note lists still take precedence. The publisher uses the profile
only if independently configured to select it.

## Base definitions and core queries

### Complete base definitions

These four definitions specify all their required query settings. Display
options not supplied use the reference defaults.

```yaml
version: 1
indexes:
  places:
    label: Places
    where:
      all:
        - field: page.kind
          eq: place
        - field: life.exists
          eq: true
    columns: [name, type]

  settlements:
    extends: places
    label: Settlements
    where:
      field: metadata.typeOf
      eq: settlement
    columns: [name, region, population]

  residents:
    label: Residents
    where:
      all:
        - field: page.kind
          eq: person
        - field: life.active
          eq: true
        - relation: home
          within: $target
          recursive: true
    columns: [person, info, home]

  members:
    label: Members
    where:
      all:
        - field: page.kind
          eq: person
        - field: life.exists
          eq: true
        - relation: affiliation
          target: $target
          state: current
          recursive: false
    columns: [person, info, role]
```

`places` and `settlements` have no containment condition: they search all visible
matching notes. They include destroyed places that had already existed. Use
`life.active` instead of `life.exists` to exclude destroyed places.

### Derived definitions for the six core queries

Add these entries to the same registry's `indexes` map:

```yaml
indexes:
  settlements-in:
    extends: settlements
    label: Settlements
    where:
      relation: home
      within: $target
      recursive: true

  major-cities:
    extends: settlements
    label: Major cities
    where:
      field: metadata.population
      as: number
      gt: 10000
    columns: [name, population, region]

  dwarven-residents:
    extends: residents
    label: Dwarven residents
    where:
      field: metadata.species
      eq: dwarf
    columns: [person, home]

  family-members:
    extends: members
    label: Family members
    columns: [person, start, end]

  current-members:
    extends: members
    label: Current members
    where:
      field: life.active
      eq: true

  waterways-in-watershed:
    extends: places
    label: Rivers and lakes
    where:
      all:
        - field: metadata.typeOf
          in: [waterway, lake]
        - relation: watershed
          within: $target
          recursive: true
    columns: [name, type]
```

| Desired query | `index` | `target` |
| --- | --- | --- |
| All settlements in a barony | `settlements-in` | `"[[Barony of Aveil]]"` |
| All major cities, population > 10,000 | `major-cities` | Omit; searches all visible settlements |
| Dwarves living in Sembara | `dwarven-residents` | `"[[Sembara]]"` |
| Family members including deceased, excluding departures | `family-members` | `"[[Charmhearts]]"` |
| Living current Rangers | `current-members` | `"[[Rangers]]"` |
| Rivers and lakes in a watershed | `waterways-in-watershed` | `"[[Istaros Watershed]]"` |

An invocation in a note uses a fence:

````markdown
```taelgar-index
index: settlements-in
target: "[[Barony of Aveil]]"
mode: table
```
````

The global major-cities query treats "all Taelgar" as vault-wide. Excluding
extraplanar settlements specifically would require a recorded distinction or a
physical-world root in the home-containment data. A resident traveling elsewhere
still matches their home. Family membership follows affiliation, rather than
requiring a species filter.

To query departed members, define a complete affiliation query with
`state: former`; adding it to the current-members parent would create two
relationship conditions and fail validation.

## Publication and scope

### Refresh and publication

| Change / host | Behavior |
| --- | --- |
| Obsidian registry/profile or selection changes | Reload and refresh; metadata/date/rename/delete changes also refresh results. |
| Website definitions or presentation changes | Publish vault content. Supported registry changes need no core rebuild. |
| Publisher | Resolve/validate the website registry, fingerprint it, and store it with the content revision. |
| Unselected personal profile | Not included in the effective published registry. |
| Registry YAML under `_scripts` | Publication input, not an ordinary website asset. |
| Static materialization | Use the website registry/profile and configured table columns. Header buttons have no static Markdown equivalent. |
| New engine capability | Update website/plugin code before using it in YAML. |

The website uses its revision's registry and notes together. Publication and
deployment follow the existing [deployment procedure](deploy.md).

### Validation and implementation notes

Unknown keys/operators, missing selected files, invalid required settings,
unsupported field uses, multiple relationship conditions, and inheritance cycles
are errors. Invalid profiles identify file/field paths rather than silently
falling back. Invalid inline invocations leave the rest of the note readable.
Invalid publication configuration stops publication before activation.

Membership retains explicit departure dates separately from death. Watershed
matching follows home and secondary records. V1 has no separate date comparison
language.

Limits: 512 definitions/rules per file patch, 128 flat conditions/rule IDs,
64 columns, 32 sort keys or items per card position, 256 values in `in`, and
16 metadata path segments. Relationship walks are bounded at 128 ancestors.
Index IDs are at most 64 characters. Unknown properties are errors.

### Migration reference

| Former syntax | Registry equivalent |
| --- | --- |
| Built-in `type` selector | Named registry `index` |
| Block-level `recursive` | Relationship predicate's `recursive` |
| Built/natural `placeType` | Named definitions using `metadata.typeOf` and `in` |
| Membership settings | Explicit `current`/`former` query plus separate lifecycle conditions |
| Members/residents location display | Explicit `lastKnownCompact`/`lastKnown` presets |
| Automatic Members buttons | Named header rule |
| Frontmatter `indexes: [members]` | Same string-list syntax, now resolving registry IDs |

Existing native `type:` blocks need migration; no dual syntax is accepted.
The website converter emits named `residents`, `settlements-in`, `places-in`,
and `current-members` references only when the selected registry defines them.
It preserves recognized table headings/templates. Missing names are reported as
unconverted and follow the existing unmatched-JavaScript publication cleanup
policy. Header buttons have no static Markdown equivalent.

Static exports use website host rules and table columns, even for grid blocks.
Select files independently with `materialize:static -- --index-registry PATH
--index-override PATH`; paths are vault-relative. These flags do not select an
Obsidian personal profile for website publication.

### Deferred from v1

Nested Boolean filters; `any`, `not`, and `some`; string matching; custom date
comparisons; per-affiliation filtering; general location queries; ad hoc query
blocks; invocation query overrides; multiple stacked profiles; header-entry
objects; custom card image sources; and inheritance of other settings.

There is one result per note. No JavaScript, regex, arithmetic expressions,
joins, grouping, aggregates, generic body-text queries, or Dataview inline-field
queries. Arbitrary authored metadata columns and existing header templates remain
part of v1 display controls.
