import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { TelegramUser } from './types.js';
import { recordUser, getUserById } from './db.js';

export interface AuthenticatedRequest extends Request {
  tgUser?: TelegramUser;
}

const DEFAULT_DEV_USER: TelegramUser = {
  id: '554433221',
  username: 'aleksandr',
  first_name: 'Александр',
  last_name: 'Бубнов',
  language_code: 'ru',
  first_seen: Date.now(),
  last_seen: Date.now(),
  interactions_count: 1,
};

/**
 * Validates Telegram WebApp initData string using HMAC-SHA256
 */
export function validateTelegramInitData(initData: string, botToken: string): TelegramUser | null {
  if (!initData || !botToken) return null;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return null;

    urlParams.delete('hash');

    // Sort parameters alphabetically
    const paramsList: string[] = [];
    urlParams.forEach((val, key) => {
      paramsList.push(`${key}=${val}`);
    });
    paramsList.sort();
    const dataCheckString = paramsList.join('\n');

    // secret_key = HMAC_SHA256("WebAppData", botToken)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // calculated_hash = HMAC_SHA256(secretKey, dataCheckString)
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      console.warn('[Auth] Invalid initData hash check failed');
      return null;
    }

    const userJson = urlParams.get('user');
    if (!userJson) return null;

    const parsedUser = JSON.parse(userJson);
    if (!parsedUser.id) return null;

    const user: TelegramUser = {
      id: String(parsedUser.id),
      username: parsedUser.username || null,
      first_name: parsedUser.first_name || null,
      last_name: parsedUser.last_name || null,
      language_code: parsedUser.language_code || null,
      first_seen: Date.now(),
      last_seen: Date.now(),
      interactions_count: 1,
    };

    // Auto-record in DB
    recordUser(user);

    return user;
  } catch (err) {
    console.error('[Auth] Error validating initData:', err);
    return null;
  }
}

/**
 * Extracts and validates user from HTTP request or falls back to dev user in development
 */
export function getTelegramUserFromRequest(req: Request): TelegramUser | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const isDev = process.env.NODE_ENV !== 'production' || !botToken || botToken === 'your_telegram_bot_token_here';

  const authHeader = req.headers['authorization'] || req.headers['x-telegram-init-data'];
  let initData = '';

  if (typeof authHeader === 'string') {
    initData = authHeader.replace(/^Bearer\s+/i, '').trim();
  } else if (typeof req.query.initData === 'string') {
    initData = req.query.initData.trim();
  }

  // 1. Try real validation if initData is provided and botToken is configured
  if (initData && botToken && botToken !== 'your_telegram_bot_token_here') {
    const validated = validateTelegramInitData(initData, botToken);
    if (validated) return validated;
  }

  // 2. Dev mode fallback: allow dev testing in browser
  if (isDev) {
    // If dev specified userId in header or query
    const devUserId = (req.headers['x-dev-user-id'] as string) || (req.query.userId as string);
    if (devUserId) {
      const existing = getUserById(devUserId);
      if (existing) return existing;
      return recordUser({ id: devUserId, first_name: 'Dev User' });
    }

    // Default existing user
    const existing = getUserById(DEFAULT_DEV_USER.id);
    if (existing) return existing;
    return recordUser(DEFAULT_DEV_USER);
  }

  return null;
}

/**
 * Express middleware to require an authenticated Telegram user
 */
export function requireTelegramAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = getTelegramUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Telegram authorization required' });
    return;
  }
  req.tgUser = user;
  next();
}

/**
 * Validates user for WebSocket connections
 */
export function authenticateWebSocket(reqUrl: string | undefined): TelegramUser | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const isDev = process.env.NODE_ENV !== 'production' || !botToken || botToken === 'your_telegram_bot_token_here';

  if (!reqUrl) {
    return isDev ? DEFAULT_DEV_USER : null;
  }

  try {
    const url = new URL(reqUrl, 'http://localhost');
    const initData = url.searchParams.get('initData');

    if (initData && botToken && botToken !== 'your_telegram_bot_token_here') {
      const validated = validateTelegramInitData(initData, botToken);
      if (validated) return validated;
    }

    if (isDev) {
      const devUserId = url.searchParams.get('userId');
      if (devUserId) {
        const existing = getUserById(devUserId);
        if (existing) return existing;
        return recordUser({ id: devUserId, first_name: 'Dev User' });
      }
      return DEFAULT_DEV_USER;
    }

    return null;
  } catch {
    return isDev ? DEFAULT_DEV_USER : null;
  }
}
