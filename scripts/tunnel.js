import dotenv from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const port = process.env.PORT || '3001';
const token = process.env.PINGGY_TOKEN ? process.env.PINGGY_TOKEN.trim() : '';
const targetHost = token ? `${token}@a.pinggy.io` : 'a.pinggy.io';

console.log(`\n🚀 Запуск Pinggy туннеля для порта ${port}...`);
if (token) {
  console.log(`🔑 Используется токен аккаунта: ${token.slice(0, 4)}***`);
} else {
  console.log(`ℹ️  Токен не указан (анонимный режим). Для снятия ограничений добавьте PINGGY_TOKEN в .env`);
}

const ssh = spawn('ssh', [
  '-o', 'StrictHostKeyChecking=no',
  '-p', '443',
  `-R0:localhost:${port}`,
  targetHost
], {
  stdio: 'inherit'
});

ssh.on('close', (code) => {
  console.log(`\nТуннель завершил работу (код ${code})`);
});
