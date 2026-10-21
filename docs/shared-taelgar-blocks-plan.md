# Generated Taelgar bio block

Add one `taelgar-header` block that displays the existing generated note header
in Obsidian and on the website. Reuse the current header rules and appearance.

````markdown
```taelgar-header
```
````

The block reads the current note's frontmatter. It produces the same
pronunciation, biographical information, dates, affiliations and whereabouts
that the current header produces, including the H1 title. Rendering does not
rewrite the note.

## Initial implementation

1. **Reuse the existing generator.** Use the existing header classes and runtime;
   do not redesign the rules, introduce a block framework or build a query engine.
2. **Render in Obsidian.** Add a code-block processor to the Taelgarverse plugin.
   Generate the current Obsidian-style header with its values filled in, then
   render the Markdown as the familiar information callout. Use the current
   note's date rules and refresh when its metadata or relevant date changes.
3. **Render on the website.** Recognize the same fence and call the existing
   website header generator with the visitor's selected date/context. Preserve
   the current website styling.
4. **Keep existing notes working.** A note with the new block gets one generated
   header; notes with saved headers keep working as today. Teach the existing
   website to consume an older materializer's marker and the block as one header.
   Prepare a few sample notes for local review before changing real vault notes.

## Completion check

Compare the new block with the current header on a person, a place and a dated
note. Check the displayed values and appearance in Obsidian and the local
website, including a date change. Verify that no duplicate header appears and
that the original body text stays intact.

The deliverable is a working bio block. Dataview body queries, other block
families, bulk note migration and automated publication are outside this change.

## Refactor direction (2026-10-21)

The generated header internals have been extracted into maintained shared
modules under `src/header-core/`. Dates, metadata and link lookup are explicit
inputs. Node, Worker and the Obsidian adapter all call this core; new bio blocks
use `renderBio` directly, while `renderHeader` handles existing saved headers.
The modules and adapter ownership are listed in [architecture](architecture.md).

The nine identified issues are fixed in this new implementation. The vault's
CustomJS source and generated legacy copy have not received these fixes. The
original renderer remains a reference for existing behavior in tests, and the
unused Dataview query helpers remain on that legacy path.

The nine former TODO reproductions are ordinary passing acceptance tests for the
new core. `header-legacy-defects.test.mjs` separately characterizes the original
defects. Fixed-output fixtures have not been refreshed: existing outputs still
match, and the direct bio API is also checked against the frozen vault outputs.
When a future correction intentionally changes a captured output, review and
record its new expectation alongside the legacy baseline instead of recapturing
all expectations.

The user selected a header error for circular location and organization chains.
The core throws a typed `HeaderDataError` with the chain; Obsidian displays a bio
error, and the website returns a clear 422 without exposing nested metadata paths.
Discuss additional bugs and unresolved behavior choices before implementing
their fixes. Quoted-date interpretation, age wording and differences between the
two presentations remain separate decisions. Development builds are installed
only in the user's local vault for smoke testing; production is unchanged.

## Canonical publication format (2026-10-21)

The block now owns the complete header, including its H1, in Obsidian and on the
website. The Node preparation step uses `normalizeHeader` to convert old HTML
placeholders, detected saved generated headers, and separate title-plus-block
layouts to one empty `taelgar-header` fence. Normalization is idempotent, retains
frontmatter and authored content, and runs before hashing or building indexes.
It accepts older materializer exports, so header handling needs no change to
the legacy materializer. Body Dataview export remains a separate requirement.

The website retains old-marker support for existing R2 snapshots. Deploy the
updated website before publishing the canonical blocks. No snapshot schema
change or in-place R2 migration is needed. Local tagged smoke-test notes use a
leading block with their former standalone H1 removed.

## Refactoring test baseline

Before restructuring the header library, run `npm test`. For focused header
checks, use `node --test "tests/header-*.test.mjs"`. `header-modules.test.mjs`
retains comparisons with the original vault classes and needs the configured
vault; the other header unit-test files use synthetic notes or frozen vault
frontmatter and can run without a vault or Obsidian.

- `header-dates`: date formats, DR arithmetic, partial-date conventions,
  inclusive lifecycle boundaries, frontmatter precedence, and age wording.
- `header-locations`: home/travel boundaries, unknown and secondary locations,
  ancestry chains, depth/type filters, date-sensitive ancestry, and formats.
- `header-names-templates`: lookup and ambiguity, aliases, display overrides,
  articles, prepositions, pronouns, optional tokens, and template modifiers.
- `header-affiliations`: membership intervals, leadership succession, grouping,
  campaign identities, validation, and encounters at their recorded dates.
- `header-legacy-helpers`: existing query helper contracts, using an explicit
  test-only Dataview stub for backlink-dependent methods. This does not make
  those helpers available in the bio renderer.
- `header-legacy-defects`: nine characterization tests documenting the original
  stack's failures, independently of the corrected replacement.
- `header-output`: twenty scenarios with fixed Markdown in both static and
  website formats, saved-header replacement, body preservation, one complete H1,
  version selectors, immutable inputs, render isolation, and indexed/full-scan
  leadership parity.
- `header-vault`: all 21 vault pages tagged `testcase` or `testcase/*`, plus the
  historical Sembara, Tyrwingha and Vostok pages. The fixtures cover 126 recorded
  date boundaries with checks before, on and after each boundary: 288 dated
  renders of tagged pages and 54 kingdom renders, each in both formats. Explicit
  assertions also cover Elaine I's simultaneous titles, Derik III's grouped
  kingdoms, Sura and Akan's travel, Hralgar's release, Antonia's mirror/ship
  chain, the garrison's organization chain, and custom artifact/event sentences.
- `header-preparation`: canonicalization, repeat-pass stability, authored-content
  preservation, malformed-block errors, and all 21 frozen vault cases through
  real packaging and simulated R2 loading. Checks source immutability, stored
  Markdown hashes, Node/Worker parity, and exactly one rendered title.
- `header-complex`: an integrated synthetic history with concurrent memberships,
  primary affiliations, different offices in different places, independent
  successors, changing borders, secondary locations, an unknown current
  location, historical encounters, a moving ship and a transferred artifact.
  Fifteen complete headers in both formats complement domain assertions for
  display-rule precedence and indexed/full-scan parity.
- `header-synthesized`: eight independently invented examples (a person with two
  primary houses, a carried lantern, a lost compass in a moving container, a
  destroyed pier, a short event, a spirit, a jointly governed village and a
  plain note). Handwritten domain expectations complement eight membership
  interval matrices, all six orderings of an unambiguous home/travel history,
  nested death-date clamping, empty display defaults and render isolation.
  These expectations do not come from captured renderer output.

`tests/fixtures/header-display-rules.json` freezes representative rules from the
vault. `header-outputs.json` contains the reviewed pre-refactor outputs; tests do
not regenerate expected results. Changes to either fixture require explicit
output review. The original vault classes are also checked independently against
the fixed outputs, so two changing implementations cannot redefine the baseline.

`header-vault-cases.json` freezes frontmatter from the local vault on 2026-10-20,
including the related metadata needed for the recorded dates and rulers. It
omits note bodies, lint bookkeeping and DM ownership/comments. Its source paths,
tagged-page inventory and normalized boundary dates are recorded with the
fixtures. `header-vault-outputs.json` freezes 684 outputs; the complex history has
another 30 in `header-complex-outputs.json`. These tests never recapture outputs.
The live-vault compatibility suite checks for added/removed test tags, compares
both generators using the current metadata of all tagged pages, and runs the
original classes independently against both sets of frozen expectations.
Changing live lore does not silently update this baseline: review any fixture
refresh deliberately, including the dependency metadata and all affected dates.

These are characterization tests of current generator behavior. They preserve
overlapping offices and concurrent rulers from the captured metadata; they do
not assert that historical metadata is complete or resolve disputed lore. Numeric
end years remain inclusive through December 31, which can overlap another role
starting January 1 of the same year.

Keep intentional corrections explicit during the refactor. Existing conventions include
different bounds for quoted and numeric years, inclusive end dates, and the
age wording `1 months` / `12 months`. Website output also currently omits some
information shown by the static generator, including event dates and place
leadership. The fixtures record these differences rather than promising parity.

Three original defect reproductions cover these cases: missing calendar months
can produce an invalid date; token range filters reorder `2-3` into `-23`; and
custom affiliation sentence formats can replace member names with duplicated
text. These now pass against the maintained core. The original behavior is kept
in the separate legacy characterization tests, without patching that stack.

Six additional cases in `header-synthesized.test.mjs` cover problems found by the
independently constructed examples. They also pass against the new core:

| Reproduction | Legacy behavior | Correction in the new core |
| --- | --- | --- |
| Query Aster's rulers in 1720 while the current date is 1700. | Returns no rulers; the same explicit query works when the current date is 1740. | Pass the explicit query date through candidate affiliation normalization. This affects helper calls with a date different from the render's date. |
| Add a secondary residence starting after a person's birth. | It never appears, because secondary entries are filtered at the birth/origin date. | Select the secondary residence at the requested date, including start/end boundaries. |
| Give two otherwise matching memberships different current/past sentences. | The first sentence is applied to both memberships and the second disappears. | Include both sentence formats in the affiliation grouping key. |
| Override articles for a name with no corresponding note. | Definite and indefinite articles are swapped; resolved notes do not have this error. | Correct the unresolved-name override assignments. |
| Filter for places in a chain of two objects that contain each other. | Recursion overflows the stack even with a numeric depth limit, because excluded objects do not advance that limit. | Detect repeated nodes and report a header error, including when the filter excludes every node in the loop. |
| Make two organizations each the other's parent. | An unrestricted parent chain overflows the stack. | Detect repeated parents and report a header error. |

The circular cases are malformed-data recovery checks, separate from the valid
world examples. Tests require the user-selected typed header error; Node, Worker
and Obsidian adapter tests verify its visible behavior.

For coverage, add `--experimental-test-coverage` and
`--test-coverage-include="src/header-core/*.mjs"` to the focused test command.
Coverage complements the fixed values, boundary checks, and output comparisons;
it does not establish that every legacy input is supported.

At the 2026-10-21 refactor check, the full suite passed 1,366 tests with no TODOs.
The focused header run measured 97.29% line, 94.19% branch and 98.54% function
coverage across the maintained core. The local Worker package check and Obsidian
plugin build also passed; neither check publishes or installs the result.

The canonical-format follow-up passed 1,382 tests, the local R2 integration
check, and the Worker compilation dry run. All 21 current local test pages also
passed the real materializer's pure Markdown transformation followed by header
normalization and 42 dated renders. The updated plugin was installed locally,
and those test notes now have leading blocks without separate H1 headings;
plugin settings and authored note bodies were verified unchanged.
