// Express + Socket.IO transport for the Teen Patti room engine.
// Virtual practice chips only. Deploy this Node.js service separately from GitHub Pages.
'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TeenPattiGame = require('./teenPattiGame');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'teen-patti-diamond' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : '*',
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();
const socketRooms = new Map();

function makeRoomId() {
  let id;
  do { id = Math.random().toString(36).slice(2, 8).toUpperCase(); }
  while (rooms.has(id));
  return id;
}

function safeName(value) {
  return String(value || 'Player').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18) || 'Player';
}

function sendError(socket, callback, message) {
  const payload = { ok: false, error: message };
  if (typeof callback === 'function') callback(payload);
  else socket.emit('gameError', payload);
}

function broadcastRoom(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;
  // Each player receives their own cards; opponents' cards remain hidden by the engine.
  for (const player of game.players) {
    io.to(player.id).emit('stateUpdate', game.getPublicState(player.id));
  }
}

function leaveRoom(socket) {
  const roomId = socketRooms.get(socket.id);
  if (!roomId) return;
  const game = rooms.get(roomId);
  socket.leave(roomId);
  socketRooms.delete(socket.id);
  if (!game) return;
  game.removePlayer(socket.id);
  if (game.players.length === 0) rooms.delete(roomId);
  else broadcastRoom(roomId);
}

io.on('connection', socket => {
  socket.emit('connected', { socketId: socket.id });

  socket.on('createRoom', (payload = {}, callback) => {
    if (socketRooms.has(socket.id)) leaveRoom(socket);
    const roomId = makeRoomId();
    const game = new TeenPattiGame(roomId, 6, {
      startingChips: 10000,
      bootAmount: Math.max(1, Math.min(10000, Number(payload.bootAmount) || 10))
    });
    if (!game.addPlayer(socket.id, safeName(payload.name))) {
      return sendError(socket, callback, 'Could not create room');
    }
    rooms.set(roomId, game);
    socket.join(roomId);
    socketRooms.set(socket.id, roomId);
    const result = { ok: true, roomId, state: game.getPublicState(socket.id) };
    if (typeof callback === 'function') callback(result);
    socket.emit('stateUpdate', result.state);
  });

  socket.on('joinRoom', (payload = {}, callback) => {
    const roomId = String(payload.roomId || '').trim().toUpperCase();
    const game = rooms.get(roomId);
    if (!game) return sendError(socket, callback, 'Room not found');
    if (socketRooms.has(socket.id)) leaveRoom(socket);
    if (game.phase === 'playing') return sendError(socket, callback, 'A hand is in progress; join after it finishes');
    if (!game.addPlayer(socket.id, safeName(payload.name))) {
      return sendError(socket, callback, 'Room is full or player could not join');
    }
    socket.join(roomId);
    socketRooms.set(socket.id, roomId);
    const result = { ok: true, roomId, state: game.getPublicState(socket.id) };
    if (typeof callback === 'function') callback(result);
    broadcastRoom(roomId);
  });

  socket.on('startGame', (_payload, callback) => {
    const roomId = socketRooms.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return sendError(socket, callback, 'Join a room first');
    if (game.players[0]?.id !== socket.id) return sendError(socket, callback, 'Only the room creator can start the hand');
    if (game.phase !== 'waiting' && game.phase !== 'showdown') return sendError(socket, callback, 'A hand is already in progress');
    if (!game.startHand()) return sendError(socket, callback, 'At least two players with chips are required');
    if (typeof callback === 'function') callback({ ok: true });
    broadcastRoom(roomId);
  });

  socket.on('action', (payload = {}, callback) => {
    const roomId = socketRooms.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return sendError(socket, callback, 'Join a room first');
    const result = game.act(socket.id, payload.action, payload.amount);
    if (!result.ok) return sendError(socket, callback, result.error);
    if (typeof callback === 'function') callback({ ok: true });
    broadcastRoom(roomId);
  });

  socket.on('nextHand', (_payload, callback) => {
    const roomId = socketRooms.get(socket.id);
    const game = rooms.get(roomId);
    if (!game) return sendError(socket, callback, 'Join a room first');
    if (game.players[0]?.id !== socket.id) return sendError(socket, callback, 'Only the room creator can start the next hand');
    if (game.phase !== 'showdown' && game.phase !== 'waiting') return sendError(socket, callback, 'The current hand has not finished');
    if (!game.startHand()) return sendError(socket, callback, 'At least two players with chips are required');
    if (typeof callback === 'function') callback({ ok: true });
    broadcastRoom(roomId);
  });

  socket.on('leaveRoom', callback => {
    leaveRoom(socket);
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Teen Patti Diamond server listening on port ' + PORT);
});
