# Hollow Creek - Confirmed Layout & Generated Assets

Supersedes the "no three-column layout" note in UI_LAYOUT_POLISH.md -
that decision was reversed after seeing the full assembled mockup. This
file is the actual layout target, using real generated art rather than
descriptions Claude Code would otherwise have to guess at or regenerate.

**The mockup image is a reference for structure and feel, not a locked
pixel-perfect spec.** Column contents, exact wording, and panel
proportions can flex - the column structure itself, and the specific
generated assets below, are the real deliverable.

**Confirmed: no map, anywhere.** Already excluded in
INTERACTIVE_OBJECTS.md and confirmed again here - do not build one even
though the bottom nav in the reference mockup shows a map icon.

---

## Column structure

**Left column:** the town roster - player portraits, alive/eliminated/
speaking/voted status indicators (Task 3, UI_LAYOUT_POLISH.md), selection
for voting.

**Center column, top to bottom:** title header, the round-status bar
(Task 1, UI_LAYOUT_POLISH.md - phase, timer), a bulletin-style panel for
phase instructions/announcements/player count, the Stage (full voice/mic
spec, VOICE_FEATURE_TASKS.md), the vote panel (Task 2, UI_LAYOUT_POLISH.md
- now realized as a physical ballot box, see Task A below).

**Right column:** the role card (Task 4, UI_LAYOUT_POLISH.md - now
realized as a sealed envelope, see Task B below), Town Talk (Task 3,
telegraph chat enhancements, INTERACTIVE_OBJECTS.md).

**Bottom nav row, spanning full width:** Case Files, Characters/Notebook,
History, Settings - each a themed object with a plain-text label beneath
it, per the earlier "best navigation setup" idea. No map icon.

---

## Generated asset inventory - what maps to what

All assets referenced below were generated and provided directly - use
these rather than creating new placeholder art or regenerating something
that already exists.

**Panel background textures:** two dark wood/leather textures, a cork
texture (fits the bulletin-panel specifically, matching its pinned-paper
concept), and a cream/parchment texture for card and note backgrounds.

**Portrait frames:** a set of ornate gold frame variants - plain/default,
a glowing gold version for the selected/active state, a connector piece
for adjoining frames, a damaged/black-tape-corner version for eliminated
players, and a red-sealed-corner version, proposed for marking the host
specifically. Use these as the actual frame states for Task 3's alive/
dead/speaking/voted/on-stage indicators rather than building a separate
indicator system from scratch.

**Role-envelope reveal sequence:** a full state sequence already exists -
sealed, a glowing/hover state, opening, fully open showing the role card,
and closed again with a small persistent glowing badge. This is the
literal frame-by-frame reference for Task 4's "face-down, click to
reveal" interaction - build the animation as a transition through these
exact states, not a new interaction designed from scratch.

**Pocket watch, as separable parts:** the watch case, the face/dial, an
hour hand, a minute hand, and a glowing ring effect - provided as
individual layers specifically so they can be assembled and animated
independently (the minute hand actually rotating during the round, the
glowing ring activating near zero). This is the direct implementation
reference for the pocket-watch timer concept from the earlier interactive
objects discussion.

**Stage curtains:** a matched pair of red velvet curtain assets for the
Stage panel's frame.

**Icon set:** mic on/mic off/soundwave, a call-bell (phase-change chime),
a back-arrow, a folder-with-portrait (Case Files nav icon), a gear
(Settings), a pointing hand, a shield, a magnifying glass (investigate/
view file), an eye (spectate), linked rings (ally/teammate marker), a
question-mark badge (unknown status), a checkmark ribbon (confirmed/
verified), a mourning ribbon (eliminated), a star-sealed badge, and a set
of status roundels (info/warning/checkmark/lock/minus/exclaim) for
compact inline status use.

**Paper/note assets:** several blank aged-paper shapes in different
sizes and pin/paperclip styles, a folder icon, a closed notebook and an
open blank notebook, a rolled newspaper, a speech-bubble shape, and a
stack of papers with a wax-seal tab - covering Case Files, the Notebook,
History, and Town Talk's visual vocabulary without needing new art for
any of them.

**Ballot/voting assets:** a wax seal, a wooden ballot box (both closed
and with a paper mid-slot), and a padlock - see Task A.

**Character silhouette sets:** two sets of ten faceless, period-hatted
silhouette portraits. Proposed use: default/placeholder portraits for
any character slot before a real portrait is assigned, or as the visual
style for an unrevealed/unknown player state generally - confirm this
matches intent before treating it as final.

---

## Task A: Physical ballot-box voting

Confirmed as its own object, not just a visual skin on the existing
Confirm Vote button. Action: selecting a player shows their name on a
paper-ballot element; clicking the ballot box submits it; a wax seal
animates on top to confirm. Keep the full animation under one second,
with an option to skip it. The Confirm Vote button remains present
alongside the box, not replaced by it, for accessibility/clarity.

Acceptance: the full select-to-confirm flow completes in under a second
when not skipped, and functions identically (just without the visual
flourish) when skipped.

---

## Task B: Sealed-envelope role reveal

Builds directly on Task 4 in UI_LAYOUT_POLISH.md, now with the exact
visual reference from the asset set. Action: implement the envelope
using the provided state sequence (sealed -> hover glow -> opening ->
open/revealed -> closed with persistent badge) as the literal animation
states, per the technique already discussed (layered elements, CSS
transforms, eased keyframes).

Acceptance: matches the provided reference states in sequence, and the
small persistent badge remains visible after closing so the player has a
passive reminder their role card exists without it taking up screen
space.

---

## Cross-reference - nothing here duplicates existing task files

This file describes structure and assets only. The actual behavior specs
for the roster (Task 3), timer (Task 1), vote panel (Task 2), role card
(Task 4), and general readability/color rules (Tasks 5-8) all still live
in `UI_LAYOUT_POLISH.md` unchanged - this file tells Claude Code *where*
they sit and *what art to build them from*, not what they do
mechanically. Same relationship to `VOICE_FEATURE_TASKS.md` (the Stage)
and `INTERACTIVE_OBJECTS.md` (Case Files, Notebook, Town Talk).
