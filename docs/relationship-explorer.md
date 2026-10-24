# Relationship explorer prototype

The optional Obsidian explorer opens typed relationships in a workspace tab.
Enable **Settings → Taelgarverse → Enable relationship explorer**, then run
**Taelgarverse: Open relationship explorer** or use the network ribbon icon.
It is disabled by default. Turning it off closes its views and stops its
listeners and refresh timer. It never edits notes.

This is an author view over local vault metadata, including unpublished notes.
The campaign setting supplies the query date; it does not apply website campaign
visibility rules. It always follows the active campaign date, sharing the header
snapshot and date services (including an active CustomJS/calendar override). A note's
individual `pageTargetDate` does not override this graph-wide date.

## Embedded relationship diagrams

Add an empty block to a person, organization, or place note:

````markdown
```taelgar-relationship
```
````

The block draws a network diagram of that note and its direct connections
(depth 1). People and organizations use social relationships; places use
containment, routes, and current/last-known locations. It uses the block's source
note, including in transclusions, and follows the active campaign date.
Pan, zoom, full screen, and source details remain available; the starting note
and depth are fixed. Unconnected supported notes still appear alone.
Worldbuilding notes are excluded as in the explorer's default view.
For a compact list, use:

````markdown
```taelgar-relationship
mode: list
```
````

List mode groups all direct typed connections (including a person's current or
last-known place) under their relationship headings. Note names open the linked
notes; expandable Source sections retain passage text and source-line actions.
Empty groups are omitted. `mode: diagram` is also accepted explicitly; unknown
keys or modes produce an error. Both modes fix the source note and depth at 1.

The **Enable relationship explorer** setting controls both the workspace view
and these blocks. It is off by default. Turning it off closes views, removes the
ribbon entry, hides the command, stops timers/listeners/reads, and replaces
embedded diagrams with a short enable-setting message. Turning it back on
restores diagrams in open notes. The native Markdown processor supports Reading
View and rendered code blocks in Live Preview; Source mode keeps the fence text.

## Exploring relationships

**Include Worldbuilding** applies to People and Places, including starting-note
suggestions. It is off by default. It excludes notes in a folder named
`Worldbuilding` (case-insensitive) and its subfolders, for every node type,
along with connections to those notes. Toggling does not reread notes. The choice
survives refresh and view switching while this explorer stays open. If the starting
note is excluded, the starting-note filter clears. A person whose only location
is excluded is not placed into a different box.


**People** uses network layout and shows person and group notes:
`affiliations` and `leaderOf` become membership/leadership edges, and group
`partOf` becomes organization nesting. The active campaign date is an upper cutoff:
all relationships that began by that date remain visible, including ended
memberships and deceased people's connections. There is no past-membership toggle.
The shared header service supplies start/end dates; ends (including death) label
a relationship historical instead of hiding it. Future people and relationships
are excluded until their creation/start date.

Organizations with visible members or leaders have tinted enclosures matching
their square node. Tight outlines and stronger membership attraction keep members
close together. The network layout also moves unrelated node footprints outside
organization outlines where possible, while preserving label clearance. A person belonging
to multiple visible organizations remains one node in overlapping enclosures;
selecting that person highlights each of their groups. Unrelated nodes get
cutouts if overlapping groups still place an enclosure behind them. Group details show the visible member
count, not the organization's total membership. Enclosures use only the filtered
graph: they do not fetch members, add nodes, or widen the selected connection
depth. Parent organizations do not inherit another group's members.

**Prose mentions** reads person-note prose and resolves explicit wikilinks
(including aliases and heading links) and local Markdown links to other people.
It shows incoming and outgoing mentions. Edges retain paragraph text and its
zero-based source line internally; the details panel displays the human line
number and opens that location in the source note. Frontmatter, fenced and inline
code, embeds, HTML/Obsidian comments, and info callouts are excluded. Mentions
are evidence of a reference, not proof of kinship, friendship, or an encounter.
Mentions inside `%%^Date:1730-02-01%% … %%^End%%` enter the graph on that
date and remain afterward. Partial years/months start on their first day. The
details panel reports the **earliest dated passage** and each passage's date;
this is evidence from the authored block, not a proven relationship start.

A `b` block (before-state text) remains evidence after its cutoff. It is labeled
**before [date], start unknown** and cannot establish a start date. Undated
passages are always eligible. Each passage is filtered separately: an undated
mention can keep a connection visible while a later dated passage stays hidden.
Ordinary comments, Lint/Metadata/povNotes blocks, code examples, embeds, and saved
info callouts do not create mentions. Campaign blocks remain eligible in this
author view. Malformed markers produce a per-note warning instead of extracting
unreliable prose. Unlinked name matching and third-note co-mentions are not
included in this prototype.

**Places** shows nested boxes using the active campaign date and the existing
whereabouts service. Sembara contains its duchies; duchies contain settlements;
settlements contain their smaller places. People appear inside their current or
last-known location box. Each living person has **Currently at**, or
**Last known at** only when their current location is unknown. Last-known people
carry a **Last known** badge and dashed border, indicating uncertainty.

There are no separate Home, Secondary location, or former-travel edges. A home
may still be the service's current location when no more recent whereabouts
supersede it; it is never added alongside a known current location. Deceased
people have no spatial edges, while their memberships and prose connections
remain in the social view. People with no known location have no location edge.

Place containment likewise uses current (or last-known) primary containment and
active secondary containment, including the existing `partOf` fallback. It does
not draw former containment paths. Future records and not-yet-created nodes are
excluded. The details panel retains the source whereabouts record.

In **People**, choose a starting note and connection depth **1**, **2**, **3**,
or **All**. All social connection types are included. Depth follows edges in both
directions; arrows retain their authored meaning. **All notes** clears the
starting note. People graph nodes without connections stay hidden.

Place boxes use a type icon, subtle border/header color, and short type label
from `typeOfAlias` / `typeOf`. Roads, rivers, settlements, realms, regions,
buildings, inns, forests, terrain, sacred sites, and other common kinds have
distinct symbols. Unknown aliases fall back to the underlying type; unknown
types use a generic place marker. This styling does not change containment.

In **Places**, the landing view initially shows only collapsed planes (`typeOf: plane`).
Planes are navigation roots even when their notes belong to Multiverse or another
cosmological grouping. Place trees without a plane ancestor appear implicitly
inside **Material Plane**, reusing its note when available or a display-only root
otherwise. Existing nesting within other planes is preserved. This fallback
does not edit notes or assign a location to people whose whereabouts are unknown.
Selecting a starting place opens its first layer of contents.
Each box with contents has a **+ / −** expand/collapse button. Child places start
collapsed; expanding reveals their own places and people. Collapsing hides the
contents without changing any metadata. Expansion choices survive refresh and
switching views while the explorer stays open. Empty places remain visible.

Choose a starting place to browse its subtree. Breadcrumbs navigate to its
ancestors or all places. Searching for a person opens their location box. People
are never moved up into an ancestor's box when their location is collapsed.
Place names and person chips open details and source-note actions. Places uses
ordinary scrolling; network depth and zoom controls apply only to People.

Every place/person has one displayed parent: primary containment/current location
wins, with secondary containment or last-known location as a labeled fallback.
Other containment links remain in details instead of duplicating a place.
Cycles are broken deterministically and reported as data warnings. Lists show
40 children at a time, with **Show more** to reveal the rest; the hierarchy is
built before paging, so missing ancestors do not flatten the nesting.

Select an organization and click **Expansion on** to switch it off. The
organization remains visible, but depth traversal stops there instead of using
it to discover its other members or connected organizations. People reached by
another path remain visible, along with their memberships. Click **Expansion off**
to restore traversal. A dashed organization outline marks expansion off.
Choices stay with the open explorer, including refresh and mode switches.
Organizations expand by default. This control applies when exploring from a
starting note; **All notes** still shows the whole graph. A starting organization
always expands, so exploring directly from it remains useful.

**Full screen** fills the Obsidian window. **Exit full screen** or Escape returns
to the workspace tab without changing the starting note or depth. Opening a
source note also exits full screen. Details appear only after selecting a node
or connection; the × button closes them.

Select a node for its details and note action, or a connection for source
evidence. Double-click a node or choose **Explore from here** to change the
starting note. Tab/Enter works for nodes and edges. In People, scroll, drag the background,
or use the arrow keys to pan. Use Ctrl/Command+scroll or +/− to zoom. **Fit**
(or 0 with the graph focused) shows the whole graph; **100%** (or 1) returns
to readable size around the starting note, or the center when exploring all.

The graph opens at readable size and can extend beyond the viewport. Network
placement uses compact connection distances while reserving space for node
symbols and wrapped labels, and lets dense
groups expand beyond the original canvas. Labels use a fixed 13-unit font and
up to three lines; they scale with the graph when zooming, so fitting the overview
does not enlarge labels into neighboring nodes. Full names remain in tooltips
and the selection panel.

The People renderer caps a view at 250 nodes and reports truncation. Narrow the starting
note or connection depth for larger datasets. Prose is read lazily when the view opens,
with eight concurrent reads and per-file caching until the file changes.
Individual read/metadata errors appear as data warnings rather than discarding
the whole graph. Layout traversal terminates even with cyclic containment.

### Roads and rivers

Roads and rivers appear as named route strips: roads use dashed warm lines,
rivers solid blue lines. Connections join recorded endpoint places and other
roads/rivers. Selecting a route highlights its lines. These are schematic
connections, not measured geography or inferred flow direction.

When an endpoint is inside a collapsed place, its line reaches that visible
ancestor; the endpoint link still names the actual destination and its tooltip
identifies the enclosing place. Expand the ancestor to reveal the precise
connection. Endpoint links also navigate to places outside the current subtree.
People located on a road or river appear in its expandable contents as usual.
Unresolved endpoints have a question mark; routes without recorded endpoints
remain strips without invented connections.

## Place metadata

Nesting uses existing `whereabouts` and `partOf` metadata. No map coordinates
are required. The earlier geographic prototype's `graphPositions` fields remain
readable by the graph model but are not used by the nested Places browser;
the explorer no longer loads map images.

Road/river connections come only from `locations[].feature` in existing
`%%^Metadata:map:v1%%` blocks, resolved relative to the route note:

```yaml
%%^Metadata:map:v1%%
locations:
  - {role: source, feature: Aine Hills}
  - {role: outlet, feature: Wistel}
%%^End%%
```

Coordinates are optional. Roads can omit `role`. Source/outlet roles are
retained as evidence in the connection details, with an action to open the
metadata block in its note. Prose mentions, coordinate proximity, and entry order
do not imply a physical connection, crossing, or ordered itinerary. Map metadata
is a current geographic reference; it does not encode relationship history.
The active date and Worldbuilding filters still exclude unavailable endpoints.
Route-note reads use the same bounded concurrency and change-aware cache as
person prose; malformed metadata generates a per-note warning.

## Local development

From the exploration checkout:

```powershell
node --test tests/place-routes.test.mjs tests/place-appearance.test.mjs tests/place-tree.test.mjs tests/relationship-graph.test.mjs tests/relationship-layout.test.mjs tests/relationship-view.test.mjs tests/obsidian-relationships.test.mjs tests/obsidian-calendar.test.mjs tests/obsidian-maps.test.mjs
node scripts/build-obsidian.mjs
node scripts/preview-relationships.mjs
```

The plugin build is in `dist/obsidian/taelgarverse`. The preview command creates
a self-contained `dist/relationship-explorer/index.html` with synthetic notes; it can be opened directly in a browser and needs no server.
Neither command installs into a live vault or publishes a plugin release.
Use the normal [local installation workflow](../obsidian/taelgarverse/README.md)
for a chosen test vault. Public releases follow the separate
[Obsidian release procedure](obsidian-releases.md).

