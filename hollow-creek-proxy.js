// Hollow Creek local AI proxy
// ----------------------------
// This lets the downloaded Hollow Creek game call Claude when you're NOT
// running it inside Claude.ai. It runs only on your own computer and never
// shares your API key with anyone else.
//
// SETUP (one-time):
//   1. Install Node.js if you don't have it: https://nodejs.org
//   2. Get an API key from https://console.anthropic.com (this is a paid API -
//      usage is billed per request, separate from any claude.ai subscription)
//
// EVERY TIME YOU WANT TO PLAY OFFLINE:
//   1. Open a terminal in this folder
//   2. Run:  ANTHROPIC_API_KEY=sk-ant-yourkeyhere node hollow-creek-proxy.js
//      (on Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-yourkeyhere"; node hollow-creek-proxy.js)
//   3. Leave this terminal window open
//   4. Open the Hollow Creek HTML file in your browser as normal and play
//
// Never put your API key inside the HTML file itself, and never share this
// key with anyone - treat it like a password.

const http = require('http');
const https = require('https');

const PORT = 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('\nMissing API key.\n');
  console.error('Run it like this instead:');
  console.error('  ANTHROPIC_API_KEY=sk-ant-yourkeyhere node hollow-creek-proxy.js\n');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Only POST is supported' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let responseBody = '';
      proxyRes.on('data', (chunk) => { responseBody += chunk; });
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(responseBody);
      });
    });

    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not reach Anthropic API: ' + err.message }));
    });

    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log('Hollow Creek AI proxy running at http://localhost:' + PORT);
  console.log('Leave this open, then play the game in your browser.');
});
