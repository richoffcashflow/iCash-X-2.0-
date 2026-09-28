# Compact workspace rules

The home view stays short regardless of the number of records:

- Balance and account access at the top.
- One current status. A required decision replaces the ordinary current-action headline rather than adding another competing headline.
- One featured property row. Photos, seller conversations, numbers, buyer status and closing checklist expand on demand.
- History is closed by default, mounts no event rows while closed, and renders at most 20 events per page when opened. Its snapshot is held while reading so incoming events do not shift the page. Pagination resets the scroll position.
- No always-visible milestone lists or arrays of full property cards.
- The sample remains explicitly fictional. Signed-in users do not receive sample deals as real work.

For the future live workspace, use the existing tenant-scoped workspacePriority selector to choose required action first, then deadlines, signed contracts and verified promising leads. Keep totals available as compact counts; do not expand all signed contracts into the home screen. Real property/event APIs still need server pagination, subscription fan-out controls and load testing. This UI change is not evidence that those live services are implemented or scale-tested.
