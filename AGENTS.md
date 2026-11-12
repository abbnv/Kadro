# AGENTS.md — Руководство для AI-агентов и разработчиков

Этот документ описывает архитектуру **Kadro (Open-Core)** и правила внесения изменений в проект.

## 1. Структура проекта (Monorepo / npm workspaces)

- `client/` — Frontend на React 18, Vite, TypeScript, TailwindCSS:
  - `src/App.tsx` — корневой роутинг экранов (`list`, `edit`, `prompter`).
  - `src/components/ScriptList.tsx` — список сценариев.
  - `src/components/ScriptEditor.tsx` — редактор текста сценария.
  - `src/components/PrompterView.tsx` — основной экран телесуфлёра, логика скролла, камеры и записи.
  - `src/components/PrompterControls.tsx` — панель управления суфлёром (шрифт, скорость, отступы, режим голоса/скорости, камера).
  - `src/components/CameraReviewModal.tsx` — предпросмотр и экспорт записанного видео (Reels / видеокружок).
  - `src/hooks/useSpeechRecognition.ts` — захват PCM16 (16 kHz) аудио и стриминг по WebSocket `/ws/speech`.
  - `src/hooks/useCameraRecorder.ts` — запись видео через `MediaRecorder`.
- `server/` — Backend на Node.js, Express, `ws`, SQLite (`better-sqlite3`), `grammY`:
  - `src/index.ts` — точка входа HTTP + WebSocket сервера и запуск Telegram-бота.
  - `src/routes.ts` — REST API (`/api/scripts`, `/api/config`, `/api/recordings/*`, `/api/health`).
  - `src/speechProxy.ts` — WebSocket-прокси для стриминга аудио в Deepgram Live API.
  - `src/voiceGuard.ts` — точка расширения для контроля голосовых сессий (в open-source версии всегда разрешает доступ).
  - `src/bot.ts` — Telegram-бот (`grammY`): команды `/start`, `/help` и отправка записанных видео пользователю.
  - `src/db.ts` — инициализация SQLite и CRUD сценариев.
  - `src/auth.ts` — проверка Telegram WebApp `initData` (HMAC-SHA256) с dev-fallback для браузера.
  - `src/videoProcessor.ts` — конвертация/зеркалирование видео через `ffmpeg` (при наличии).

## 2. Ключевые правила разработки

1. **Проверка сборки после изменений:**
   Всегда запускайте `npm run build` в корне — это прогонит `tsc && vite build` для клиента и `tsc` для сервера.
2. **Точки расширения (Open-Core совместимость):**
   - Не добавляйте хардкод лимитов или биллинга напрямую в `speechProxy.ts` — используйте интерфейс `server/src/voiceGuard.ts` (`canStartVoiceSession`, `recordVoiceUsage`).
   - Все настройки и ключи должны читаться из `process.env` (включая `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`, `TELEGRAM_BOT_TOKEN`, `TMA_URL`).
3. **Telegram Mini App и WebSocket:**
   - Внутри Telegram Mini App требуется публичный `HTTPS` URL (`TMA_URL`). Для локального тестирования используйте `ngrok` (или `npm run tunnel`).
   - Vite dev-сервер проксирует `/api` и `/ws/speech` на порт `3001` (`server`), поэтому туннель можно направлять как на `3001` (после `npm run build && npm start`), так и на `5173` (в dev-режиме).
4. **Безопасность:**
   - Никогда не коммитьте `.env`, файлы `*.db` и директорию `data/`.

## 3. Основные команды

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки (client :5173 + server :3001)
npm run dev

# Production сборка (client + server)
npm run build

# Запуск собранного сервера (:3001)
npm start
```
