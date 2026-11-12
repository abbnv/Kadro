import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Script, ScriptSettings, TelegramUser, UserBilling, PaymentRecord, UsageLog, UserActivityLog } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'teleprompter.db');
export const db = new Database(dbPath);

// Performance optimizations for SQLite: non-blocking WAL mode and memory temp store
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -32000'); // 32MB cache
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language_code TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    interactions_count INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_billing (
    user_id TEXT PRIMARY KEY,
    free_period_start INTEGER NOT NULL,
    free_period_index INTEGER NOT NULL DEFAULT 1,
    free_seconds_used REAL NOT NULL DEFAULT 0,
    active_plan TEXT NOT NULL DEFAULT 'free',
    paid_plan_expires_at INTEGER,
    paid_seconds_limit INTEGER,
    paid_seconds_used REAL NOT NULL DEFAULT 0,
    subscription_charge_id TEXT,
    subscription_auto_renew INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    amount_stars INTEGER NOT NULL,
    telegram_payment_charge_id TEXT UNIQUE,
    provider_payment_charge_id TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    payload TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    plan_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_created ON user_activity_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_user ON user_activity_logs(user_id);
`);

// Migration: check if scripts table has user_id column
const scriptsColumns = db.prepare("PRAGMA table_info(scripts)").all() as Array<{ name: string }>;
const hasUserIdColumn = scriptsColumns.some((col) => col.name === 'user_id');
if (!hasUserIdColumn) {
  db.exec('ALTER TABLE scripts ADD COLUMN user_id TEXT;');
}

// Backfill existing scripts without user_id: assign to the earliest registered user (or default user)
const defaultUserRow = db.prepare('SELECT id FROM users ORDER BY first_seen ASC LIMIT 1').get() as { id: string } | undefined;
const targetUserId = defaultUserRow?.id || '554433221';
db.prepare("UPDATE scripts SET user_id = ? WHERE user_id IS NULL OR user_id = ''").run(targetUserId);

export const defaultStartMessage = `🎬 *Телесуфлёр для записи видео*

Привет! Это персональный телесуфлёр в виде Telegram Mini App.

✨ *Возможности:*
• Скролл по скорости и *умный автоскролл по голосу*
• Выбор внешнего микрофона (петлички, гарнитуры)
• Настройка шрифта, скорости и отступов от краёв
• Режим отзеркаливания текста для суфлёрного стекла
• Портретный и альбомный режимы

Нажми кнопку ниже для старта:`;

export const defaultStartButtonText = 'Открыть Телесуфлёр 🎬';
export const defaultMenuButtonText = 'Суфлёр';

// Seed app_config defaults
const getConfigStmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
if (!getConfigStmt.get('bot_start_message')) {
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run('bot_start_message', defaultStartMessage);
}
if (!getConfigStmt.get('bot_start_button_text')) {
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run('bot_start_button_text', defaultStartButtonText);
}
if (!getConfigStmt.get('bot_menu_button_text')) {
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run('bot_menu_button_text', defaultMenuButtonText);
}
// Note: deepgram_model is intentionally NOT seeded here so that
// process.env.DEEPGRAM_MODEL is used unless overridden in the admin panel.

export function getEffectiveDeepgramModel(): string {
  const dbModel = getAppConfig('deepgram_model', '').trim();
  if (dbModel) return dbModel;
  return process.env.DEEPGRAM_MODEL?.trim() || 'nova-2';
}

export const defaultSettings: ScriptSettings = {
  fontSize: 40,
  speed: 55,
  paddingX: 12,
  isMirrored: false,
  mode: 'speed',
};

const sampleTitle = 'Добро пожаловать в KADRO 🎬';

const sampleContent = `Привет! Это KADRO — твой AI-суфлёр для записи видео.

Он помогает читать текст уверенно и без запинок, не отводя взгляд от камеры.

Как работают режимы:
• По скорости — текст плавно движется с заданной скоростью, а ты просто идёшь в ритме.
• Голосовой режим — суфлёр слушает твою речь и сам подстраивает прокрутку под темп голоса, останавливаясь на паузах.

Что ещё можно настроить прямо во время съёмки:
• Размер шрифта и отступы от краёв, чтобы текст всегда был на уровне глаз у объектива.
• Отзеркаливание — если снимаешь через профессиональное стекло-суфлёр.
• Встроенную камеру — можно сразу записывать Reels или видеокружочки для Telegram.

Этот сценарий создан для знакомства — смело протестируй его, а потом удали или замени на свой. Удачных дублей!`;

// Seed sample script if empty
const countStmt = db.prepare('SELECT COUNT(*) as count FROM scripts');
const result = countStmt.get() as { count: number };
if (result.count === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO scripts (id, user_id, title, content, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  insertStmt.run(
    'sample-1',
    targetUserId,
    sampleTitle,
    sampleContent,
    JSON.stringify(defaultSettings),
    now,
    now
  );
}

export function seedSampleScriptForUser(userId: string): Script {
  const id = 'script_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO scripts (id, user_id, title, content, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, userId, sampleTitle, sampleContent, JSON.stringify(defaultSettings), now, now);
  return {
    id,
    user_id: userId,
    title: sampleTitle,
    content: sampleContent,
    settings: defaultSettings,
    created_at: now,
    updated_at: now,
  };
}

function markWelcomeSeeded(userId: string): void {
  db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(
    `welcome_seeded:${userId}`,
    '1'
  );
}

export function getAllScripts(userId?: string): Script[] {
  let rows: any[];
  if (userId) {
    const stmt = db.prepare('SELECT * FROM scripts WHERE user_id = ? ORDER BY updated_at DESC');
    rows = stmt.all(userId) as any[];
    // Seed the welcome script only once per user (not after they intentionally delete it)
    if (rows.length === 0) {
      const alreadySeeded = db
        .prepare('SELECT 1 FROM app_config WHERE key = ?')
        .get(`welcome_seeded:${userId}`);
      if (!alreadySeeded) {
        markWelcomeSeeded(userId);
        const welcome = seedSampleScriptForUser(userId);
        return [welcome];
      }
      return [];
    }
  } else {
    const stmt = db.prepare('SELECT * FROM scripts ORDER BY updated_at DESC');
    rows = stmt.all() as any[];
  }

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    content: r.content,
    settings: JSON.parse(r.settings),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function getScriptById(id: string, userId?: string): Script | null {
  let r: any;
  if (userId) {
    const stmt = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?');
    r = stmt.get(id, userId) as any;
  } else {
    const stmt = db.prepare('SELECT * FROM scripts WHERE id = ?');
    r = stmt.get(id) as any;
  }

  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    content: r.content,
    settings: JSON.parse(r.settings),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function createScript(data: {
  userId?: string;
  title: string;
  content: string;
  settings?: Partial<ScriptSettings>;
}): Script {
  const id = 'script_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const now = Date.now();
  const settings: ScriptSettings = { ...defaultSettings, ...(data.settings || {}) };
  const userId = data.userId || targetUserId;

  const stmt = db.prepare(`
    INSERT INTO scripts (id, user_id, title, content, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, userId, data.title, data.content, JSON.stringify(settings), now, now);
  return {
    id,
    user_id: userId,
    title: data.title,
    content: data.content,
    settings,
    created_at: now,
    updated_at: now,
  };
}

export function updateScript(
  id: string,
  data: { title?: string; content?: string; settings?: Partial<ScriptSettings> },
  userId?: string
): Script | null {
  const existing = getScriptById(id, userId);
  if (!existing) return null;

  const title = data.title !== undefined ? data.title : existing.title;
  const content = data.content !== undefined ? data.content : existing.content;
  const settings: ScriptSettings = {
    ...existing.settings,
    ...(data.settings || {}),
  };
  const now = Date.now();

  const stmt = userId
    ? db.prepare(`
        UPDATE scripts
        SET title = ?, content = ?, settings = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
    : db.prepare(`
        UPDATE scripts
        SET title = ?, content = ?, settings = ?, updated_at = ?
        WHERE id = ?
      `);

  if (userId) {
    stmt.run(title, content, JSON.stringify(settings), now, id, userId);
  } else {
    stmt.run(title, content, JSON.stringify(settings), now, id);
  }

  return {
    id,
    user_id: existing.user_id,
    title,
    content,
    settings,
    created_at: existing.created_at,
    updated_at: now,
  };
}

export function deleteScript(id: string, userId?: string): boolean {
  const stmt = userId
    ? db.prepare('DELETE FROM scripts WHERE id = ? AND user_id = ?')
    : db.prepare('DELETE FROM scripts WHERE id = ?');
  const res = userId ? stmt.run(id, userId) : stmt.run(id);
  if (res.changes > 0 && userId) {
    markWelcomeSeeded(userId);
  }
  return res.changes > 0;
}

// App configuration (Start message, Deepgram model, etc.)
export function getAppConfig(key: string, defaultValue = ''): string {
  try {
    const stmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  } catch (err) {
    console.error(`[DB] getAppConfig error for ${key}:`, err);
    return defaultValue;
  }
}

export function setAppConfig(key: string, value: string): void {
  const stmt = db.prepare(`
    INSERT INTO app_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(key, value);
}

// Telegram users tracking
export function recordUser(userData: {
  id: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  language_code?: string | null;
}): TelegramUser {
  const now = Date.now();
  const existingStmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const existing = existingStmt.get(userData.id) as any;

  if (existing) {
    const updateStmt = db.prepare(`
      UPDATE users
      SET username = COALESCE(?, username),
          first_name = COALESCE(?, first_name),
          last_name = COALESCE(?, last_name),
          language_code = COALESCE(?, language_code),
          last_seen = ?,
          interactions_count = interactions_count + 1
      WHERE id = ?
    `);
    updateStmt.run(
      userData.username ?? null,
      userData.first_name ?? null,
      userData.last_name ?? null,
      userData.language_code ?? null,
      now,
      userData.id
    );

    return {
      id: userData.id,
      username: userData.username ?? existing.username,
      first_name: userData.first_name ?? existing.first_name,
      last_name: userData.last_name ?? existing.last_name,
      language_code: userData.language_code ?? existing.language_code,
      first_seen: existing.first_seen,
      last_seen: now,
      interactions_count: existing.interactions_count + 1,
    };
  }

  const insertStmt = db.prepare(`
    INSERT INTO users (id, username, first_name, last_name, language_code, first_seen, last_seen, interactions_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  insertStmt.run(
    userData.id,
    userData.username ?? null,
    userData.first_name ?? null,
    userData.last_name ?? null,
    userData.language_code ?? null,
    now,
    now
  );

  logUserActivity(
    userData.id,
    'user_first_seen',
    `Пользователь ${userData.first_name || userData.username || userData.id} впервые открыл телесуфлёр`,
    { username: userData.username, first_name: userData.first_name }
  );

  return {
    id: userData.id,
    username: userData.username ?? null,
    first_name: userData.first_name ?? null,
    last_name: userData.last_name ?? null,
    language_code: userData.language_code ?? null,
    first_seen: now,
    last_seen: now,
    interactions_count: 1,
  };
}

export function getUserById(id: string): TelegramUser | null {
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return (stmt.get(id) as TelegramUser) || null;
  } catch (err) {
    return null;
  }
}

export function getAllUsers(): TelegramUser[] {
  try {
    const stmt = db.prepare('SELECT * FROM users ORDER BY last_seen DESC');
    return stmt.all() as TelegramUser[];
  } catch (err) {
    console.error('[DB] getAllUsers error:', err);
    return [];
  }
}

export function getUsersCount(): number {
  try {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const res = stmt.get() as { count: number };
    return res.count || 0;
  } catch (err) {
    return 0;
  }
}

// User billing queries
export function getUserBillingRow(userId: string): UserBilling | null {
  try {
    const stmt = db.prepare('SELECT * FROM user_billing WHERE user_id = ?');
    return (stmt.get(userId) as UserBilling) || null;
  } catch (err) {
    console.error('[DB] getUserBillingRow error:', err);
    return null;
  }
}

export function createUserBillingRow(b: UserBilling): void {
  const stmt = db.prepare(`
    INSERT INTO user_billing (
      user_id, free_period_start, free_period_index, free_seconds_used,
      active_plan, paid_plan_expires_at, paid_seconds_limit, paid_seconds_used,
      subscription_charge_id, subscription_auto_renew, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    b.user_id,
    b.free_period_start,
    b.free_period_index,
    b.free_seconds_used,
    b.active_plan,
    b.paid_plan_expires_at,
    b.paid_seconds_limit,
    b.paid_seconds_used,
    b.subscription_charge_id,
    b.subscription_auto_renew,
    b.updated_at
  );
}

export function updateUserBillingRow(b: Partial<UserBilling> & { user_id: string }): void {
  const keys = Object.keys(b).filter((k) => k !== 'user_id');
  if (keys.length === 0) return;

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (b as any)[k]);
  values.push(b.user_id);

  const stmt = db.prepare(`UPDATE user_billing SET ${setClause} WHERE user_id = ?`);
  stmt.run(...values);
}

// Payment records
export function createPaymentRecord(p: PaymentRecord): void {
  const stmt = db.prepare(`
    INSERT INTO payments (
      id, user_id, plan_type, amount_stars,
      telegram_payment_charge_id, provider_payment_charge_id,
      status, created_at, payload
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    p.id,
    p.user_id,
    p.plan_type,
    p.amount_stars,
    p.telegram_payment_charge_id,
    p.provider_payment_charge_id,
    p.status,
    p.created_at,
    p.payload || null
  );
}

export function getPaymentByChargeId(chargeId: string): PaymentRecord | null {
  try {
    const stmt = db.prepare('SELECT * FROM payments WHERE telegram_payment_charge_id = ?');
    return (stmt.get(chargeId) as PaymentRecord) || null;
  } catch (err) {
    return null;
  }
}

export function updatePaymentStatus(id: string, status: string, chargeId?: string): void {
  if (chargeId) {
    const stmt = db.prepare('UPDATE payments SET status = ?, telegram_payment_charge_id = ? WHERE id = ?');
    stmt.run(status, chargeId, id);
  } else {
    const stmt = db.prepare('UPDATE payments SET status = ? WHERE id = ?');
    stmt.run(status, id);
  }
}

// Usage logs
export function createUsageLog(log: UsageLog): void {
  try {
    const stmt = db.prepare(`
      INSERT INTO usage_logs (id, user_id, session_id, duration_seconds, plan_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(log.id, log.user_id, log.session_id, log.duration_seconds, log.plan_type, log.created_at);
  } catch (err) {
    console.error('[DB] createUsageLog error:', err);
  }
}

export function getUserUsageLogs(userId: string): UsageLog[] {
  try {
    const stmt = db.prepare('SELECT * FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50');
    return stmt.all(userId) as UsageLog[];
  } catch (err) {
    return [];
  }
}

// User Activity Logs (Admin Audit Trail & History)
export function logUserActivity(
  userId: string,
  action: string,
  description: string,
  details?: any
): void {
  try {
    const id = 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
    const stmt = db.prepare(`
      INSERT INTO user_activity_logs (id, user_id, action, description, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, String(userId), action, description, detailsStr, Date.now());
  } catch (err) {
    console.error('[DB] logUserActivity error:', err);
  }
}

export function getUserActivityLogs(userId?: string, limit = 150): UserActivityLog[] {
  try {
    let stmt;
    if (userId) {
      stmt = db.prepare(`
        SELECT 
          a.id,
          a.user_id,
          a.action,
          a.description,
          a.details,
          a.created_at,
          u.username,
          u.first_name,
          u.last_name
        FROM user_activity_logs a
        LEFT JOIN users u ON a.user_id = u.id
        WHERE a.user_id = ?
        ORDER BY a.created_at DESC
        LIMIT ?
      `);
      return stmt.all(String(userId), limit) as UserActivityLog[];
    } else {
      stmt = db.prepare(`
        SELECT 
          a.id,
          a.user_id,
          a.action,
          a.description,
          a.details,
          a.created_at,
          u.username,
          u.first_name,
          u.last_name
        FROM user_activity_logs a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC
        LIMIT ?
      `);
      return stmt.all(limit) as UserActivityLog[];
    }
  } catch (err) {
    console.error('[DB] getUserActivityLogs error:', err);
    return [];
  }
}
