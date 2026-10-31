// Shared helpers for the socket-level scripts in this folder: start a real
// server child process, then talk to it exactly like a browser client would.
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(file = 'server.js', env = {}) {
  const port = 3100 + Math.floor(Math.random() * 1500);
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MD_LOG: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const settle = (ok) => {
      if (ok) resolve({ child, port, url: `http://127.0.0.1:${port}` });
      else { child.kill(); reject(new Error(`server did not start:\n${output}`)); }
    };
    // The pre-fix baseline has no /healthz, so its startup banner counts too:
    // both servers must be testable by the same scripts.
    const poll = async () => {
      if (child.exitCode !== null) return settle(false);
      if (/running on port/i.test(output)) return settle(true);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (res.ok) return settle(true);
      } catch (e) { /* not up yet */ }
      if (Date.now() > deadline) return settle(false);
      setTimeout(poll, 120);
    };
    poll();
  });
}

async function roomCount(base) {
  try {
    const res = await fetch(`${base}/healthz`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.rooms;
  } catch (e) { return null; }
}

async function healthz(base) {
  try {
    const res = await fetch(`${base}/healthz`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

function connect(base) {
  return io(base, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 4000 });
}

function nextEvent(socket, event, ms = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(event, handler); resolve(null); }, ms);
    function handler(payload) { clearTimeout(timer); socket.off(event, handler); resolve(payload); }
    socket.on(event, handler);
  });
}

function ack(socket, event, payload, ms = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), ms);
    socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res || { ok: false, error: 'no ack' }); });
  });
}

module.exports = { ROOT, sleep, startServer, roomCount, healthz, connect, nextEvent, ack };
