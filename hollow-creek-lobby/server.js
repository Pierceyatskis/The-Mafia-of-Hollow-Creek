// Hollow Creek - bare-bones multiplayer lobby server
// ----------------------------------------------------
// This is step 1 only: create a room, share a code, join it, see who's there.
// No game logic yet. That comes in a later step, once this foundation works.

const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8080;

// ---- tiny static file server for the client page ----
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === '.js' ? 'application/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// In-memory room store. Resets if the server restarts - that's fine for now.
// Shape: { code: { players: [{id, name, isHost}], hostId } }
const rooms = {};

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, avoids confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms[code]);
  return code;
}

function makePlayerId() {
  return Math.random().toString(36).slice(2, 10);
}

function broadcastRoster(code) {
  const room = rooms[code];
  if (!room) return;
  const roster = room.players.map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId }));
  const msg = JSON.stringify({ type: 'roster', roomCode: code, players: roster });
  room.players.forEach(p => {
    if (p.socket.readyState === WebSocket.OPEN) p.socket.send(msg);
  });
}

function removePlayer(socket) {
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    const idx = room.players.findIndex(p => p.socket === socket);
    if (idx !== -1) {
      const wasHost = room.players[idx].id === room.hostId;
      room.players.splice(idx, 1);
      if (room.players.length === 0) {
        delete rooms[code];
        console.log(`Room ${code} closed (empty)`);
      } else {
        if (wasHost) room.hostId = room.players[0].id;
        broadcastRoster(code);
      }
      return;
    }
  }
}

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'create') {
      const code = makeRoomCode();
      const id = makePlayerId();
      rooms[code] = { players: [{ id, name: msg.name || 'Player', socket }], hostId: id };
      socket.send(JSON.stringify({ type: 'created', roomCode: code, playerId: id }));
      broadcastRoster(code);
      console.log(`Room ${code} created by ${msg.name}`);
    }

    else if (msg.type === 'join') {
      const code = (msg.roomCode || '').toUpperCase();
      const room = rooms[code];
      if (!room) {
        socket.send(JSON.stringify({ type: 'error', message: 'No room with that code.' }));
        return;
      }
      const id = makePlayerId();
      room.players.push({ id, name: msg.name || 'Player', socket });
      socket.send(JSON.stringify({ type: 'joined', roomCode: code, playerId: id }));
      broadcastRoster(code);
      console.log(`${msg.name} joined room ${code}`);
    }

    else if (msg.type === 'leave') {
      removePlayer(socket);
    }
  });

  socket.on('close', () => {
    removePlayer(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Hollow Creek lobby server running at http://localhost:${PORT}`);
  console.log(`Open that address in a browser to test - open it in a few tabs to simulate multiple players.`);
});
