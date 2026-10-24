Taelgarverse 0.7.0

- Add a campaign calendar with colored dots for each campaign's current date and daily moon phases. Turn on **Settings → Taelgarverse → Enable campaign calendar**, then open it from the calendar icon in the left ribbon or **Open campaign calendar** in the command palette. The feature is off by default; turning it off closes its views and releases its date provider while preserving saved choices.
- Choose an active campaign to use its latest session date for generated headers, indexes, and campaign interactions. Choose **Custom** to save a manual DR date in settings. Invalid dates leave the saved value unchanged, and browsing the calendar never changes query dates. Explicit CustomJS overrides and `pageTargetDate` retain precedence.
- Align moon phases to the full moon on **April 6, 1748 DR at midnight**, with a **29.5-day cycle** and no leap days. Icons show illumination at noon; hover for illumination and exact new/full/quarter times.
- Preserve an authored H1 immediately above `taelgar-header`, including setext titles and intervening blank lines, so Obsidian and exports show one title. Pronunciation, header details, and index controls still render.
- Fix native headers in static website exports to use the website card layout, icons, and pronunciation styling. Explicit `--header-type static` retains the Markdown information callout. Reload the updated plugin and rerun the static export to refresh previously generated files.

Using the calendar date from existing CustomJS queries requires the separate [vault-side date adapter](https://github.com/msackton/taelgarverse-core/blob/main/docs/vault.md#campaign-calendar-prototype). The plugin does not install that vault script. The calendar is currently available in Obsidian.

Desktop only. The minimum app version remains Obsidian 1.8.0.
