Taelgarverse 0.7.0

- Add an opt-in campaign calendar with a colored dot on each campaign's current date and daily moon illumination. Open it from the calendar icon in the left ribbon or the command palette.
- Enable the whole feature in regular plugin settings; it is off by default. Disabling it closes its views, hides its entry points, stops its listeners, and releases its date API while retaining saved choices.
- Choose an active campaign to use the website's latest-session date rules for native headers, indexes, and interactions. Choose Custom to set and remember a manual DR date; invalid dates leave the saved date unchanged.
- Align lunar phases to the confirmed full moon on April 6, 1748 DR at midnight with a 29.5-day cycle and no leap days. Icons sample noon; hover for illumination and exact new/full/quarter times.
- Preserve explicit CustomJS overrides and pageTargetDate. Calendar browsing changes only the view. Existing CustomJS queries can use the separate vault adapter described in the calendar reference.

Desktop only. The minimum app version remains Obsidian 1.8.0.
