#!/usr/bin/env node
// ARC Raiders Quest Tree — local server
// Usage: node server.js
// Then open http://localhost:3000

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3013;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js':   'text/javascript',
  '.css':  'text/css',
};

http.createServer((req, res) => {
  const filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Quest tree running at http://localhost:${PORT}`);
});
