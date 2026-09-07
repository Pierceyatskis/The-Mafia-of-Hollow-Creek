# Hollow Creek - Asset Guide (corrected)

One correction applied to the version this was drafted from - flagged
explicitly below since it directly conflicts with the portrait-regression
fix already sent. Everything else here is unchanged and solid as
originally written.

---

## Corrected: the two "unknown portraits" sheets

**Original instruction said:** crop into separate portraits and randomly
assign them to unrevealed players.

**Do not do this.** This is the same mistake that caused the recent
portrait regression - a player's character identity (their actual
portrait) and their secret role are two different things. "Unrevealed"
describes a role, never a face. Every player already has a real, distinct
portrait that must always display, regardless of what role they hold or
whether that role has been revealed.

**Corrected use:** offer these twenty portraits as an optional personal
avatar/profile-icon choice on the Profile screen, for a human player to
pick for themselves if they want. This is a small, separate personalization
feature - it must never replace, hide, or substitute for a townsperson's
or role's actual character portrait anywhere in the live game itself.

`unknown-portraits-set-a.png` / `unknown-portraits-set-b.png` -> crop into
20 individual profile-icon options, Profile screen only.

---

## Everything else - unchanged, send as originally written

| Current filename | Suggested name | Intended use |
|---|---|---|
| 01fbc59c-6836-4bad-83c0-cf2348336e21.png | texture-dark-wood.png | Dark wood texture for navigation bars, bulletin-board frames, stage framing, larger panel backgrounds. Use sparingly so text stays readable. |
| 2b9b1875-ad75-42ea-9fe2-ab484be07def.png | texture-aged-paper.png | Aged paper texture for notebook pages, ballots, notices, case-file interiors, tooltips, announcements. |
| 04d18f20-5637-4efe-959e-0b83df3343ce.png | status-badges-sheet.png | Six notification states: red notification, amber warning, gold information, gray no-information, green complete, locked/unavailable. Split into six assets. |
| 4c54f3e5-c5c8-4f35-8ee0-734efb5865bd.png | empty-state-icons-sheet.png | Empty-folder, no-notes, no-chat, empty-stage, no-vote, no-evidence illustrations for sections with nothing to display. |
| 5a39c4d8-da27-4c33-ae10-dd4b35d89fc4.png | navigation-objects-sheet.png | Case-file stack (Characters), notebook (Private Notes), newspaper (Match History), gear (Settings). |
| 5a52c854-2bee-460f-8ea3-62cea7fcb008.png | pocket-watch-parts.png | Watch body, face, hands, glowing warning ring - separate layers, hands rotate via CSS with remaining time. |
| 5d385e8f-46ec-43c3-80c3-3bc944ef9238.png | unknown-portraits-set-a.png | See correction above - Profile-screen personal icon option only. |
| 5dcbc76b-57ef-43e1-a6de-9a02f7032fa1.png | interaction-controls-sheet.png | Wax seal, secret envelope, ballot box, pushpins, short pencil, close button, blank card. Use the long standalone pencil instead of the short one here. |
| 6e21f93e-1ae5-4d94-8764-7dd4cc95d149.png | role-envelope-states.png | Closed, highlighted/hovered, opening, open-with-role-card, new-information-notification states. |
| 6e217f05-a79b-4b4c-8adb-fa69551ff887.png | bulletin-paper-shapes.png | Blank pinned papers, various shapes/sizes, behind dynamically generated instructions/announcements/notices. |
| 7d9a6868-1668-4ac8-9a5f-24ca337bba99.png | player-card-frames.png | Normal, hover, selected/glowing, speaking, dead-with-ribbon, unread-note-notification states. Portrait/name/status/vote-selection/note-indicator stay separate dynamic layers inside these frames. |
| 18a4e798-12f5-4144-9071-3437f7ec26c1.png | unknown-portraits-set-b.png | See correction above - Profile-screen personal icon option only. |
| 37a04bae-6a55-4c63-9a41-48bf6b1c41be.png | chat-stage-controls.png | Mic active/muted, speaking waveform, phase-change bell, back arrow, player-tag card, settings, accusation pointer, protection shield, stage chair. |
| 61aab725-541b-414b-8854-18ec211f304a.png | game-status-markers.png | Black ribbon (dead), note marker, speaking indicator, red pin, trusted check, unknown marker, important wax seal, notification bell, defense shield, investigation magnifier, linked players, spectator/view icon. |
| 132ed294-b901-4784-8977-3f2a95e7496f.png | texture-dark-leather.png | Notebook cover, tabs, navigation backing, or secret-role panel. |
| 35591eb0-67e5-4ec5-b0cd-470915edc804.png | notebook-pencil-long.png | Decorative notebook pencil / "edit note" indicator - decorative only, never the sole way to edit. |
| 04911599-699e-4466-afc4-4c6c587cdf09.png | texture-cork-board.png | Evidence board / bulletin board surface - papers, pins, portraits, string layered on top. |
| ad683cac-8b02-498c-ba5f-4112fa5769bc.png | stage-curtains.png | Frames the expanded speaking-stage - can slide slightly outward when the stage opens. |
| c9ac3aec-1393-4a1a-be0e-ecd8f4a801c0.png | voting-controls-sheet.png | Blank/empty/filled ballot states, wax confirmation seal, locked state, cancel button, unavailable ballot. |
| Untitled_design.png | button-red-wide.png | Wide red button background - live HTML text on top for Confirm Vote / Leave Stage etc. Never bake button wording into the image itself. |

---

## Full instruction block for Claude Code - unchanged from the original, still correct

Integrate these images as decorative UI assets for a painted 1920s town
mystery game. Do not use any sprite sheet as one visible image - crop
each object or state into a separate transparent PNG with a descriptive
filename.

Every interactive object must be a real HTML `<button>`, link, input, or
dialog control. Artwork appears inside or behind that control - never
create invisible clickable rectangles over one large screenshot.

Main navigation: case-file stack -> Characters, leather notebook ->
Private Notes, rolled newspaper -> Match History, gear -> Settings. Every
object gets a permanent text label beneath it and an accessible
aria-label. Support keyboard focus, Enter/Space activation, visible
focus outlines.

Player-card frames: normal, hover, selected, speaking, dead, notification
states - portrait, name, status, vote selection, and note indicator stay
separate dynamic layers, not baked into the frame art.

Pocket watch: separate layers, hands rotate via CSS based on the timer,
numerical countdown stays visible beside it, glowing ring only near the
end of the phase.

Role envelope: revealable panel using the provided states. Voting:
ballot assets for the interaction, but keep a standard Confirm Vote
button visible alongside it, not replaced by it.

Aged paper and cork for notebook/bulletin/evidence-board surfaces. Dark
wood and leather only around panels and navigation - never directly
behind small text.

All labels, names, timers, messages, notes, announcements, and button
text are rendered as real HTML text - images are decoration only, never
baked-in text.

Keep permanently visible at all times: current phase, timer, objective,
selected vote, current speaker, unread-chat count, and the player's own
role symbol.

Honor `prefers-reduced-motion`, keep animations under roughly one second,
never let an animation block clicking.

**Production warning:** several files show a checkerboard pattern in
preview - verify whether that's genuine transparency or baked into the
actual pixels before use. If baked in, remove it first. Clean crop every
sprite sheet before placing any piece into the game.
