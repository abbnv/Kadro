import { Bot, InlineKeyboard, InputFile } from 'grammy';
import {
  recordUser,
  defaultStartMessage,
  defaultStartButtonText,
  defaultMenuButtonText,
  getAllUsers,
} from './db.js';

let botInstance: Bot | null = null;

export function getBotInstance(): Bot | null {
  return botInstance;
}

export async function syncBotMenuButton(text?: string): Promise<void> {
  if (!botInstance) return;
  const tmaUrl = process.env.TMA_URL || 'http://localhost:5173';
  if (!tmaUrl.startsWith('https://')) return;
  const menuText =
    (text ?? process.env.BOT_MENU_BUTTON_TEXT ?? defaultMenuButtonText).trim() ||
    defaultMenuButtonText;
  try {
    await botInstance.api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: menuText,
        web_app: { url: tmaUrl },
      },
    });
  } catch (err) {
    console.warn('[Bot] Failed to setChatMenuButton:', err);
  }
}

export async function sendRecordedVideoToUser(
  userId: string,
  filePath: string,
  options: {
    mode: 'reels' | 'circle';
    title?: string;
    duration?: number;
  }
): Promise<{ sentAs: 'video_note' | 'video'; targetChatId: string }> {
  if (!botInstance) {
    throw new Error('Telegram-бот не подключен (проверьте TELEGRAM_BOT_TOKEN в .env)');
  }

  let targetChatId = userId;
  // In dev mode, if userId is the mock dev user, try to find the latest real Telegram user in DB
  if (targetChatId === '554433221') {
    const allUsers = getAllUsers();
    const realUser = allUsers.find((u) => u.id !== '554433221');
    if (realUser) {
      targetChatId = realUser.id;
    }
  }

  const durationSec = options.duration ? Math.min(60, Math.max(1, Math.round(options.duration))) : undefined;

  if (options.mode === 'circle') {
    try {
      await botInstance.api.sendVideoNote(
        targetChatId,
        new InputFile(filePath, 'teleprompter-circle.mp4'),
        {
          length: 640,
          duration: durationSec,
        }
      );
      return { sentAs: 'video_note', targetChatId };
    } catch (noteErr: any) {
      console.warn('[Bot] sendVideoNote fallback to sendVideo:', noteErr.message);
      await botInstance.api.sendVideo(
        targetChatId,
        new InputFile(filePath, 'teleprompter-circle.mp4'),
        {
          caption: options.title ? `⚪ ${options.title}` : '⚪ Кружок из Телесуфлёра',
          supports_streaming: true,
        }
      );
      return { sentAs: 'video', targetChatId };
    }
  }

  await botInstance.api.sendVideo(
    targetChatId,
    new InputFile(filePath, 'teleprompter-reels.mp4'),
    {
      caption: options.title ? `🎬 ${options.title}` : '🎬 Записано в Телесуфлёре',
      supports_streaming: true,
      duration: options.duration ? Math.max(1, Math.round(options.duration)) : undefined,
    }
  );

  return { sentAs: 'video', targetChatId };
}

export function setupTelegramBot(): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') {
    console.warn(
      '[Bot] TELEGRAM_BOT_TOKEN не задан в .env. Polling бота пропущен. TMA можно тестировать напрямую в браузере.'
    );
    return null;
  }

  const bot = new Bot(token);
  botInstance = bot;
  const tmaUrl = process.env.TMA_URL || 'http://localhost:5173';
  syncBotMenuButton();

  // Automatically record every Telegram user who interacts with the bot
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      try {
        recordUser({
          id: String(ctx.from.id),
          username: ctx.from.username || null,
          first_name: ctx.from.first_name || null,
          last_name: ctx.from.last_name || null,
          language_code: ctx.from.language_code || null,
        });
      } catch (e) {
        console.error('[Bot] Ошибка записи пользователя:', e);
      }
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    const buttonText = (process.env.BOT_START_BUTTON_TEXT || defaultStartButtonText).trim();
    const keyboard = new InlineKeyboard().webApp(buttonText, tmaUrl);
    const message = process.env.BOT_START_MESSAGE || defaultStartMessage;

    try {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (parseErr) {
      console.warn('[Bot] Markdown parsing error in start message, falling back to plain text:', parseErr);
      await ctx.reply(message, {
        reply_markup: keyboard,
      });
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📖 *Как пользоваться телесуфлёром:*
1. Нажмите "Открыть Телесуфлёр".
2. Создайте или выберите сценарий.
3. Нажмите на текст, чтобы войти в режим суфлёра.
4. Выберите удобный режим скролла (по скорости или по речи).
5. Нажмите в любую область экрана для запуска и паузы.`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.catch((err) => {
    console.error('[Bot Error]:', err);
  });

  return bot;
}
