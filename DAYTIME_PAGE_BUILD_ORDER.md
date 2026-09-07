# Hollow Creek - Daytime Page Build Order

The current attempt is broken in specific, diagnosable ways - frames not
fitting portraits and a jumbled clock are both symptoms of skipping
layering/alignment steps, not random bugs. This is a strict build order:
complete and visually verify each step before starting the next. Do not
attempt multiple steps at once - that's very likely what produced the
current mess.

Reference: image 20 (the mockup) for overall feel - not pixel-exact,
structure and asset placement matter, exact spacing doesn't.
ASSET_GUIDE_CORRECTED.md for exactly which asset does what. Read the
image files once, when needed, not repeatedly.

--- Efficiency rules, same as last time, still apply ---
Scope searches to the relevant section before viewing anything. Never
read the full client file at once. Don't re-read other task files unless
a specific question actually requires it. Test after every step below,
not just at the end.

---

## Step 1: Bare structural skeleton, no art yet

Build the three columns and bottom nav row as plain, unstyled containers
- correct proportions and placement only. No textures, no frames, no
icons. Verify this renders with the right structure before touching any
asset.

Checkpoint: screenshot or describe the plain skeleton before proceeding.

---

## Step 2: Panel background textures only

Wire in `texture-dark-wood.png` (nav bars, stage framing, larger panels),
`texture-aged-paper.png` (notebook/ballots/notices), `texture-dark-
leather.png` (notebook cover, secret-role panel), `texture-cork-board.png`
(bulletin/evidence surface). Pure `background-image` CSS, no layering
complexity yet.

Checkpoint: confirm text stays readable over every textured background
before proceeding - this is exactly what "use sparingly" was warning
about in the asset guide.

---

## Step 3: Player card frames and portraits - the specific technique that fixes "frames don't fit"

This bug happens when a frame image gets placed over a portrait without
first matching their actual dimensions. Do this instead, on ONE card
first before applying to all:

1. Open `player-card-frames.png` and determine the exact pixel
   coordinates of the frame's inner window (the transparent cutout where
   a portrait should show) for the "normal" state specifically.
2. The portrait image is a separate `<img>` layer, sized and positioned
   to exactly fill that inner window - not the full card, the window
   specifically. Use `object-fit: cover` if the portrait's own aspect
   ratio doesn't match the window exactly.
3. The frame image sits in a layer on top of the portrait, same
   dimensions as the card, `pointer-events: none` so it never blocks
   clicks on the card underneath.
4. Repeat for hover, selected, speaking, dead, and notification states -
   each state's inner window may be positioned slightly differently in
   the sheet, check each one rather than assuming they match.

Checkpoint: verify on one real player card that the portrait sits
correctly inside the frame's window at every state before wiring this
into the full roster.

---

## Step 4: Pocket watch - the specific technique that fixes "jumbled mess"

This bug happens when a rotating hand's `transform-origin` isn't set to
its actual pivot point, so it spins around the wrong center. Do this:

1. Layer order, back to front: watch case/body, then the face/dial, then
   the hour hand, then the minute hand, then the glowing ring (hidden by
   default).
2. Each hand image has a small circle at its base - that's the pivot
   point. Set `transform-origin` to that exact point's coordinates
   within the hand image, not the image's default center. Getting this
   wrong is what produces a visually broken, jumbled rotation.
3. Rotate the minute hand via CSS `transform: rotate()`, updated as
   remaining time changes. Keep the plain numerical countdown visible
   beside the watch at all times, not replaced by it.
4. Show the glowing ring only when time is low (reuse whatever "low
   time" threshold is already used elsewhere for the existing timer
   color-shift behavior).

Checkpoint: verify the hand visually rotates around its actual pivot,
not its center, before integrating this into the round-status bar.

---

## Step 5: Role envelope

Wire in the five states from `role-envelope-states.png` (closed,
hovered, opening, open-with-card, notification-badge) as the literal
animation sequence for the existing reveal task. Checkpoint: click
through all five states once before moving on.

---

## Step 6: The Stage

`stage-curtains.png` framing the existing voice/mic feature (already
built - this step is purely the visual frame around it, not new
functionality). Mic/waveform icons from `chat-stage-controls.png`.

Checkpoint: confirm the curtain art doesn't overlap or block any existing
functional stage element (queue, timer, buttons).

---

## Step 7: Ballot-box voting

`voting-controls-sheet.png` for the ballot states, `button-red-wide.png`
as the Confirm Vote button background with real HTML text on top - never
baked-in text. The Confirm Vote button stays visible alongside the
ballot animation, not replaced by it.

---

## Step 8: Bottom navigation

`navigation-objects-sheet.png` - case-file stack (Characters), notebook
(Private Notes), newspaper (Match History), gear (Settings). Each gets a
permanent text label beneath it and a real `aria-label`. No map icon.

Checkpoint: tab through the nav row with keyboard only, confirm visible
focus outlines and that Enter/Space activate each one.

---

## Step 9: Town Talk and remaining status icons

Wire in the accusation pointer, tag-card, and remaining icons from
`chat-stage-controls.png` / `game-status-markers.png` into the existing
chat panel. Status badges (`status-badges-sheet.png`) and empty-state
icons (`empty-state-icons-sheet.png`) wherever a panel currently has
nothing to show.

---

## Final checkpoint, after all steps

- Every interactive element is a real `<button>`/link/input, not an
  invisible rectangle over an image.
- `prefers-reduced-motion` is honored project-wide.
- Every player's actual character portrait displays correctly - this was
  the recent regression, confirm it explicitly again here, don't assume
  it's still fine.
- Phase, timer, objective, selected vote, current speaker, unread-chat
  count, and role symbol are all visible at all times, per the original
  "most important convenience rule."

Report back per step, not just at the end - if something in steps 3 or 4
doesn't look right, better to catch it there than after building six more
steps on top of a broken layering technique.
