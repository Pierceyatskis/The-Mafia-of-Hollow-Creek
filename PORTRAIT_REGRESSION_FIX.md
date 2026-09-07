Stop and revert before doing anything else with the silhouette assets -
this is a real regression, not a style choice to refine.

What's wrong: every player tile in the town roster currently shows a
generic question-mark silhouette instead of that character's actual
portrait. This replaced real, already-built character and role art
project-wide - Mabel Finch, Otis Redwood, every townsperson, every role
(Detective, Godfather, all the way through the newest roles like
Vigilante and Cult Leader) all had real, distinct portraits before this
task. None of that should have been touched.

This traces back to a note in LAYOUT_AND_ASSETS.md describing the
silhouette image sets as a possible "default placeholder" - that note was
mine, it was flagged as unconfirmed, and it should not have been
implemented as a project-wide default replacing working assets. That's
on the instruction, not on a misread of it - but it needs undoing now.

Required fix:
1. Every player tile, everywhere in the app, goes back to showing that
   character's real, existing portrait as the permanent default - no
   exceptions, no "shared generic" state for anyone, ever.
2. The silhouette image sets are not a default for anything. If a
   personal "Game icon" picker is still wanted as a feature, it needs to
   be redesigned from scratch as something a player can optionally turn
   on for a small, clearly-bounded piece of UI (their own profile avatar
   in a menu, for instance) - it must never be the thing that determines
   whether real character art shows up in the main game itself.
3. Confirm this fix with an actual live playthrough, not a code read -
   start a real game and visually confirm every single player tile shows
   its correct, distinct portrait, not just that the code path looks
   right.

General rule for everything going forward, not just this fix: an
optional or additive feature is never allowed to change the default
behavior of something that already works. If implementing something new
would mean an existing, working piece of art, text, or functionality
stops appearing by default for players who haven't opted into anything,
stop and flag that specifically before proceeding - don't implement it
and let me discover it later. Any note in a spec marked "unconfirmed" or
"flagged, confirm before treating as final" means exactly that - it's a
question, not a default instruction to build the most literal reading of
it. When in doubt on one of those, ask before implementing, especially
if the literal reading would remove or hide something that currently
works.

---

One more thing to be direct about, separate from the portrait bug above:
this is a complete interface overhaul, not a series of small adjustments
layered on top of the existing layout. LAYOUT_AND_ASSETS.md,
UI_LAYOUT_POLISH.md, VOICE_FEATURE_TASKS.md, and INTERACTIVE_OBJECTS.md
together describe the actual target interface - treat that as what's
being built, not as a checklist of minor tweaks to nudge the current
interface slightly closer to. If getting the real target means replacing
or substantially restructuring existing layout or rendering code rather
than patching it in place, do that - don't preserve old structure for
its own sake, and don't treat this as incremental polish on the current
design. Rebuild toward the actual spec directly.

