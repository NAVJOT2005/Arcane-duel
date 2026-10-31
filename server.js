const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO connection — just a ping/pong for Day 1
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Client pings to measure latency and verify connection
  socket.on('ping_server', (clientTime, callback) => {
    callback({ serverTime: Date.now(), clientTime });
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mage Duel server running on port ${PORT}`);
});
