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

## What this does NOT do yet

- No AI-driven placeholders - their fallback behavior is simple and random
- No reconnect handling - if your tab closes mid-game, your seat just stops
  submitting actions and the round resolves without you at the phase timeout
- No real internet hosting configured - this runs on your own machine for now
- No persistence - if the server restarts, all rooms and in-progress games
  are gone (that's a deliberate, documented decision for now)
- No report/flag or host-kick UI yet
