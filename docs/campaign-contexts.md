# Campaign dates from session notes

The campaign registry supplies identity, and published session-note frontmatter
is the sole source of campaign dates. No additional metadata is required on
campaign landing pages.

## Identity and session selection

The engine reads _scripts/session_note_campaigns.json for campaign IDs, labels,
codes and aliases. It joins that registry to published Markdown notes tagged
session-note using their campaign field.

Each campaign uses its latest published session: realWorldDate first, then
sessionNumber, then in-world date/path as deterministic fallback/tiebreak.
This chooses the latest played session rather than the maximum in-world date
in the campaign, so time travel or flashbacks do not force the clock forward.
When no played dates or session numbers exist (such as Great Library arcs),
the latest DR date supplies the fallback ordering.

The date is DR_end when it is a valid full date, otherwise DR when that is a
valid full date. Partial years, unknown values and missing dates do not invent
a day. An undated latest session disables the preset even if older sessions
had dates. Dates are corrected by maintaining the session note itself.

Non-session notes do not affect campaign dates. Restart the server after
updating notes to rebuild the content snapshot.

## Modern, campaigns and Custom

- Modern uses the maximum date among available campaign contexts. With the
  current snapshot it is 1752-06-29, from Great Library Arc 6. If no dated
  context exists, it falls back to the configured default_date.
- Each campaign preset selects its registry code and session-derived date.
- Custom shows the header date picker for a manual date.
- Modern and Custom select no campaigns and hide all campaign-specific blocks.

Campaign markers match canonical codes case-insensitively: a block opened by
%%^Campaign:dufr%% and closed by %%^End%% is shown when Dunmar Frontier is
selected, and removed otherwise. Campaign:none is hidden by default; the
independent See Behind the Curtain checkbox reveals it in a clearly labeled panel in any
context. This viewing preference is available to everyone and does not reveal
other campaigns' blocks.
Date filtering applies independently of campaign selection.

Named context URLs retain the campaign ID, so dates advance after a refreshed
snapshot supplies later sessions. Custom URLs retain the literal date.

## Current snapshot

| Context | Date | Source |
| --- | --- | --- |
| Addermarch | 1715-05-31 | Session 22, DR_end |
| Dunmar Frontier | 1749-08-12 | Session 134, DR_end |
| Great Library | 1752-06-29 | Arc 6, DR_end |
| Mawar Adventures | 1749-05-27 | Episode 5, DR_end |
| Into the Chasm | 1730-01-29 | Episode 6, DR_end |
| Labyrinths of the Lost | 1748-10-19 | Session 3, DR_end |
| Lost in the Feywild | 1740-10-06 | Episode 7, DR_end |
| Cleenseau | Unavailable | No session notes in this published snapshot |
| Dragonets | Unavailable | Latest session uses an unknown DR date |

/api/contexts reports full source-note paths and date provenance. Values are
derived at startup; the table records the October 18, 2026 review.
