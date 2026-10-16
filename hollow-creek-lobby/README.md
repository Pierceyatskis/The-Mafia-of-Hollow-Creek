# Hollow Creek - Multiplayer Server

Server-authoritative multiplayer: create/join a room, the host starts a game,
the server runs every role's night action, mafia kill vote, day chat, and day
vote - each player's browser only ever receives its own redacted view of the
game (`game.js`'s `getPlayerView`), never the full state.

## Setup (one-time)

1. Install Node.js if you don't have it: https://nodejs.org
2. Open a terminal in this folder
3. Run: npm install

## Running it

1. In a terminal, in this folder, run: node server.js
2. It'll print something like "running at http://localhost:8080"
3. Open that address in your browser
4. Open it in a couple more browser tabs too - that simulates more players
5. Create a room in one tab, copy the room code, join it from the other tabs
6. The host picks total seats and mafia count, then hits "Start game" -
   empty seats are filled with placeholder townsfolk (no AI yet - their
   night/day choices are simple randomized fallbacks)
7. Play it out: submit your night action, chat and vote during the day,
   watch the town record log fill in

## Testing with a friend on the same WiFi (not the internet yet)

Find your computer's local network IP (on Windows: run `ipconfig` in Command
Prompt and look for "IPv4 Address", usually starts with 192.168.x.x). Have
your friend go to http://YOUR_IP:8080 while on the same WiFi network. This
won't work over the internet yet - that's a later step (real hosting).

## Testing the game engine on its own

`game.js` is pure logic, no sockets/DOM - run `node test-game.js` to check
role assignment, redaction, night/day resolution, and win conditions without
starting the server at all.

## Moderation and safety

- **Language filter** (`profanity.js`): swearing, slurs, sexual language, hate speech and telling someone to hurt themselves are blocked
  everywhere players can type (Town Talk, whispers, mafia/cult/ghost chat, lobby chat, polls) and in player names. It sees through the usual
  disguises (`@ss`, `sh1t`, `f*ck`, `f u c k`, `fuuuck`, accents, look-alike letters) without blocking innocent words like "class",
  "assassin" or "Scunthorpe". A blocked message is not delivered and its sender gets a short notice; a name with language that is not
  allowed is replaced with "Player ###" and tagged UNAPPROVED. Add or remove words in the lists at the top of `profanity.js`
  (mild words like "damn" and "hell" are allowed on purpose, there is an empty `mild` list to fill in). Run `node test-profanity.js`.
- **Flood limits** (`server.js`, `rateOk`): a few chat messages in a burst, then about one every 1.5 seconds; the same line twice in a
  row is refused; a socket that hammers the server is disconnected; any single message over 64 KB closes that connection.
- **Reports**: any player can report another (player menu > Report, or the Report button beside the Stage for the current speaker),
  choosing one of the fixed reasons. Reports are private and limited (one per person per target, three per game). When enough different
  players report someone (2 in a small room, about 40% of the others in a big one) they are muted for the rest of the game, on the
  Stage and in public chat, and everyone is told. The host is told about each report and can lift the mute (Moderate > Unmute).
  Six blocked-language messages in one game mute a player the same way (`STRIKES_BEFORE_MUTE`).
- **Host tools**: the host can mute or kick a player from the room (with a fixed set of reasons), and the verified owner can hang the
  Tag of Shame on a name.

## What this does NOT do yet

- Placeholder townspeople have simple, mostly random fallback behavior (no AI)
- Reconnect works (rejoin a game in progress from the same browser), but only while the server is running
- No real internet hosting configured - this runs on your own machine for now
- No persistence - if the server restarts, all rooms and in-progress games
  are gone (that's a deliberate, documented decision for now)
- Voice is not filtered live (audio goes straight between browsers); reports and host mute are the tools for that
- Achievements and the Leaderboard are not built yet, so their buttons are hidden on the home screen
