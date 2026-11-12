import { Script, ScriptSettings } from './types';

const API_BASE = '/api';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) {
    headers['Authorization'] = `Bearer ${initData}`;
  }
  return headers;
}

export async function getConfig(): Promise<{
  hasDeepgram: boolean;
  version: string;
  deepgramModel?: string;
}> {
  const res = await fetch(`${API_BASE}/config`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch config');
  return res.json();
}

export async function syncTelegramUser(user: any): Promise<void> {
  try {
    await fetch(`${API_BASE}/user/sync`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ user }),
    });
  } catch {
    // silent
  }
}

// ---------------- SCRIPTS API ----------------

export async function getScripts(): Promise<Script[]> {
  const res = await fetch(`${API_BASE}/scripts`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch scripts');
  return res.json();
}

export async function getScript(id: string): Promise<Script> {
  const res = await fetch(`${API_BASE}/scripts/${id}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch script');
  return res.json();
}

export async function createScript(data: {
  title: string;
  content: string;
  settings?: Partial<ScriptSettings>;
}): Promise<Script> {
  const res = await fetch(`${API_BASE}/scripts`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create script');
  return res.json();
}

export async function updateScript(
  id: string,
  data: { title?: string; content?: string; settings?: Partial<ScriptSettings> }
): Promise<Script> {
  const res = await fetch(`${API_BASE}/scripts/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update script');
  return res.json();
}

export async function deleteScript(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/scripts/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete script');
  return true;
}

// ---------------- ADMIN API ----------------

// ---------------- CAMERA RECORDING API ----------------

export async function sendRecordingToTelegram(
  videoBlob: Blob,
  options: {
    mode: 'reels' | 'circle';
    mirror?: boolean;
    duration?: number;
    title?: string;
  }
): Promise<{ success: boolean; sentAs?: 'video_note' | 'video'; error?: string }> {
  const params = new URLSearchParams({
    mode: options.mode,
    mirror: options.mirror ? '1' : '0',
    mimeType: videoBlob.type || 'video/webm',
  });
  if (options.duration) params.set('duration', String(Math.round(options.duration)));
  if (options.title) params.set('title', options.title);

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  };
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) {
    headers['Authorization'] = `Bearer ${initData}`;
  }

  const res = await fetch(`${API_BASE}/recordings/send-telegram?${params.toString()}`, {
    method: 'POST',
    headers,
    body: videoBlob,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось отправить видео в Telegram');
  }
  return data;
}

export async function prepareRecordingDownload(
  videoBlob: Blob,
  options: {
    mode: 'reels' | 'circle';
    mirror?: boolean;
  }
): Promise<{ success: boolean; downloadUrl: string; filename: string }> {
  const params = new URLSearchParams({
    mode: options.mode,
    mirror: options.mirror ? '1' : '0',
    mimeType: videoBlob.type || 'video/webm',
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  };
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) {
    headers['Authorization'] = `Bearer ${initData}`;
  }

  const res = await fetch(`${API_BASE}/recordings/prepare-download?${params.toString()}`, {
    method: 'POST',
    headers,
    body: videoBlob,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка подготовки файла для скачивания');
  }
  return data;
}
