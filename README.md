# 🎬 Kadro — Телесуфлёр для Telegram (Mini App + Bot)

Open-source телесуфлёр для записи видео (Reels, Shorts, YouTube, Telegram-кружочки) с умным автоскроллом по голосу на базе **Deepgram** и встроенной записью с камеры.

> 🚀 **Не хотите поднимать сервер и настраивать API-ключи?**
> Используйте готового официального бота: **[@kadroapp_bot](https://t.me/kadroapp_bot)** — работает сразу в Telegram.

---

## ✨ Возможности

- **Управление сценариями**: создание, редактирование и удаление текстов, подсчёт слов и расчётного времени чтения (~125 слов/мин).
- **Режим суфлёра**:
  - Настройка размера шрифта (`20–72 px`), скорости скролла (`15–180 px/с`) и боковых отступов (`5–35%`).
  - Отзеркаливание текста (`Mirror Mode`) для работы с оптическими телесуфлёрами.
  - Поддержка портретного и альбомного режимов, OLED-чёрный фон (`#000000`).
- **Умный автоскролл по речи (Deepgram)**:
  - Стриминг аудио в реальном времени через WebSocket в Deepgram (`nova-2` / `nova-3` и др. через `.env`).
  - Плавное следование текста за голосом + выбор внешнего микрофона/петлички.
- **Запись видео прямо в приложении**:
  - Режимы **Reels** и **Видеокружок**, таймер обратного отсчёта, кольцевая подсветка, предпросмотр и отправка видео себе в Telegram-бота.

---

## 🛠 Стек технологий

- **Frontend**: React 18, Vite, TypeScript, TailwindCSS, Lucide Icons
- **Backend**: Node.js, Express, WebSocket (`ws`), SQLite (`better-sqlite3`), `grammY`
- **Speech-to-Text**: Deepgram SDK

---

## 🚀 Локальный запуск

### 1. Клонирование и установка

```bash
git clone https://github.com/abbnv/Kadro.git
cd Kadro
npm install
```

### 2. Настройка `.env`

Скопируйте пример конфигурации и заполните переменные:

```bash
cp .env.example .env
```

Основные параметры `.env`:

| Переменная | Описание | По умолчанию |
| --- | --- | --- |
| `PORT` | Порт Express-сервера | `3001` |
| `TELEGRAM_BOT_TOKEN` | Токен бота от `@BotFather` (без него работает в браузере) | — |
| `TMA_URL` | Публичный HTTPS-адрес для Telegram Mini App | — |
| `DEEPGRAM_API_KEY` | Ключ из [Deepgram Console](https://console.deepgram.com/) | — |
| `DEEPGRAM_MODEL` | Модель распознавания речи (`nova-2`, `nova-3` и т.д.) | `nova-2` |
| `DATA_DIR` | Папка для базы данных SQLite | `./data` |

> **Примечание:** Без `DEEPGRAM_API_KEY` приложение всё равно работает — доступен ручной скролл по заданной скорости.

### 3. Запуск в режиме разработки

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend / WebSocket: `http://localhost:3001`

### 4. Локальный туннель для теста в Telegram (ngrok)

Telegram Mini App открывается только по **HTTPS**, поэтому для теста внутри Telegram локальный сервер нужно пробросить через туннель. Проще всего использовать бесплатный **ngrok**:

1. Установите [ngrok](https://ngrok.com/download) и авторизуйтесь (`ngrok config add-authtoken <TOKEN>`).
2. Соберите и запустите приложение (или используйте dev-порт `5173`):
   ```bash
   npm run build
   npm start
   ```
3. В отдельном терминале запустите туннель на порт `3001`:
   ```bash
   ngrok http 3001
   ```
4. Скопируйте выданный HTTPS-адрес (вида `https://xxxx.ngrok-free.app`) в `TMA_URL` внутри `.env` и перезапустите сервер.
5. В `@BotFather` настройте кнопку меню (`/setmenubutton`) на этот URL или нажмите `/start` в своём боте.

*(Альтернатива без установки софта: `npm run tunnel` через SSH-туннель Pinggy.)*

---

## 🐳 Запуск на сервере (Docker / Production)

### Вариант A: Docker Compose (рекомендуется)

1. Создайте `.env` из `.env.example` и укажите ваш домен в `TMA_URL=https://teleprompter.yourdomain.com`, `TELEGRAM_BOT_TOKEN` и `DEEPGRAM_API_KEY`.
2. Запустите контейнер:
   ```bash
   docker compose up -d --build
   ```
   База данных SQLite будет сохраняться в примонтированную папку `./data`.

### Вариант B: Напрямую через Node.js

```bash
npm install
npm run build
npm start
```

Сервер отдаёт собранный React-фронтенд, REST API и WebSocket на одном порту (`3001` по умолчанию).

---

## 🤖 Для AI-агентов и контрибьюторов

Подробное описание архитектуры, структуры модулей и правил разработки вынесено в отдельный документ:
👉 **[AGENTS.md — Инструкция для AI-агентов и разработчиков](AGENTS.md)**

---

## 📄 Лицензия

Проект распространяется под лицензией **GNU Affero General Public License v3.0 (AGPL-3.0)** — подробности в файле [LICENSE](LICENSE).
