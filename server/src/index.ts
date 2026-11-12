import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

import { apiRouter } from './routes.js';
import { setupSpeechProxy } from './speechProxy.js';
import { setupTelegramBot } from './bot.js';
import { db } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root or current dir
const rootEnvPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

const PORT = parseInt(process.env.PORT || '3001', 10);
const app = express();

app.use(cors());
app.use(express.json());

// Health check for Docker / Coolify / Monitoring
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api', apiRouter);

// Serve client dist in production if built
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Create HTTP and WebSocket servers
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/speech' });

setupSpeechProxy(wss);

// Start Telegram Bot with 409 Conflict retry (safe for Coolify zero-downtime rolling deploys)
let isShuttingDown = false;
let botRetryTimer: NodeJS.Timeout | null = null;
const bot = setupTelegramBot();

function startBotWithRetry() {
  if (!bot || isShuttingDown) return;
  bot
    .start({
      onStart: (botInfo) => {
        console.log(`[Bot] Started @${botInfo.username}`);
      },
    })
    .catch((err: any) => {
      if (isShuttingDown) return;
      const isConflict = err?.error_code === 409 || String(err?.message || '').includes('409');
      console.warn(
        `[Bot] Polling stopped (${isConflict ? '409 Conflict — another instance is running' : err?.message || err}). Retrying in 5s...`
      );
      botRetryTimer = setTimeout(startBotWithRetry, 5000);
    });
}

if (bot) {
  startBotWithRetry();
}

server.listen(PORT, () => {
  console.log(`[Server] Teleprompter server running on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket speech endpoint: ws://localhost:${PORT}/ws/speech`);
});

// Graceful shutdown on SIGTERM / SIGINT (Coolify restart / redeploy)
const handleShutdown = (signal: string) => {
  console.log(`[Server] Received ${signal}. Initiating graceful shutdown...`);
  isShuttingDown = true;
  if (botRetryTimer) {
    clearTimeout(botRetryTimer);
    botRetryTimer = null;
  }
  if (bot) {
    try {
      bot.stop();
      console.log('[Server] Telegram bot stopped.');
    } catch (e) {
      console.error('[Server] Error stopping bot:', e);
    }
  }

  wss.close(() => {
    console.log('[Server] WebSocket server closed.');
  });

  server.close(() => {
    try {
      db.close();
      console.log('[Server] SQLite database closed.');
    } catch (e) {
      console.error('[Server] Error closing SQLite database:', e);
    }
    console.log('[Server] HTTP server closed. Shutdown complete.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[Server] Shutdown timeout exceeded (10s), forcing exit.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
