# Hollow Creek - Lobby Server (Step 1: bare-bones multiplayer foundation)

This is the FIRST piece of real multiplayer - just a room you can create,
share a code for, and see who's joined. No game logic yet. That comes later,
once this foundation is solid.

## Setup (one-time)

1. Install Node.js if you don't have it: https://nodejs.org
2. Open a terminal in this folder
3. Run: npm install

## Running it

1. In a terminal, in this folder, run: node server.js
2. It'll print something like "running at http://localhost:8080"
3. Open that address in your browser
4. Open it in a second browser tab too - that simulates a second player
5. Create a room in one tab, copy the room code, join it from the other tab
6. Watch both tabs update live as players join/leave

## Testing with a friend on the same WiFi (not the internet yet)

Find your computer's local network IP (on Windows: run `ipconfig` in Command
Prompt and look for "IPv4 Address", usually starts with 192.168.x.x). Have
your friend go to http://YOUR_IP:8080 while on the same WiFi network. This
won't work over the internet yet - that's a later step (real hosting).

## What this does NOT do yet

- No roles, no night/day phases, no actual game - purely the lobby
- No AI townspeople yet - those come back once the game logic is server-side
- No real internet hosting - this runs on your own machine for now
- No persistence - if the server restarts, all rooms are gone (that's fine
  for now, this is just proving the connection/lobby mechanic works)
