const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint (evita spin-down)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    connections: clients.size,
    players: players.size
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    players: players.size,
    connections: clients.size,
    uptime: process.uptime()
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Armazenamento
const players = new Map();
const clients = new Map();

// Heartbeat para manter conexões vivas
const HEARTBEAT_INTERVAL = 30000;

wss.on('connection', (ws, req) => {
  const clientId = 'player_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
  const clientIp = req.socket.remoteAddress;
  
  console.log(`[${new Date().toISOString()}] Cliente conectado: ${clientId} (IP: ${clientIp})`);
  
  clients.set(clientId, {
    ws,
    lastPing: Date.now()
  });
  
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    if (clients.has(clientId)) {
      clients.get(clientId).lastPing = Date.now();
    }
  });
  
  // Enviar estado atual
  const currentPlayers = {};
  players.forEach((player, id) => {
    currentPlayers[id] = player;
  });
  
  ws.send(JSON.stringify({
    type: 'presence',
    players: currentPlayers
  }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch(data.type) {
        case 'join':
          players.set(clientId, {
            id: clientId,
            userId: data.userId,
            username: data.username,
            characterType: data.characterType,
            x: Math.random() * 20 - 10,
            y: 0.5,
            z: Math.random() * 20 - 10,
            rotation: 0,
            moving: false,
            lastUpdate: Date.now()
          });
          
          broadcast({
            type: 'player_joined',
            player: players.get(clientId)
          }, clientId);
          break;
          
        case 'move':
          if (players.has(clientId)) {
            const player = players.get(clientId);
            player.x = data.x;
            player.y = data.y;
            player.z = data.z;
            player.rotation = data.rotation;
            player.moving = data.moving;
            player.lastUpdate = Date.now();
            
            broadcast({
              type: 'player_moved',
              playerId: clientId,
              x: data.x,
              y: data.y,
              z: data.z,
              rotation: data.rotation,
              moving: data.moving
            }, clientId);
          }
          break;
          
        case 'chat':
          broadcast({
            type: 'chat',
            playerId: clientId,
            message: data.message,
            timestamp: data.timestamp
          });
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Erro:`, e);
    }
  });
  
  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Cliente desconectado: ${clientId}`);
    clients.delete(clientId);
    players.delete(clientId);
    
    broadcast({
      type: 'player_left',
      playerId: clientId
    });
  });
  
  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Erro no cliente ${clientId}:`, error);
  });
});

// Heartbeat checker
setInterval(() => {
  clients.forEach((client, clientId) => {
    if (!client.ws.isAlive) {
      console.log(`[${new Date().toISOString()}] Cliente ${clientId} sem heartbeat, terminando`);
      client.ws.terminate();
      clients.delete(clientId);
      players.delete(clientId);
      return;
    }
    
    client.ws.isAlive = false;
    client.ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// Limpar jogadores inativos
setInterval(() => {
  const now = Date.now();
  players.forEach((player, playerId) => {
    if (now - player.lastUpdate > 30000) {
      console.log(`[${new Date().toISOString()}] Jogador ${playerId} inativo, removendo`);
      players.delete(playerId);
      clients.delete(playerId);
      
      broadcast({
        type: 'player_left',
        playerId: playerId
      });
    }
  });
}, 10000);

function broadcast(message, excludeClientId = null) {
  const messageStr = JSON.stringify(message);
  clients.forEach((client, clientId) => {
    if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] 🚀 Servidor WebSocket rodando na porta ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Status: http://localhost:${PORT}/status`);
});