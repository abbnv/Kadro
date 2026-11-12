import express, { Router, Request, Response } from 'express';
import fs from 'fs';
import {
  getAllScripts,
  getScriptById,
  createScript,
  updateScript,
  deleteScript,
  recordUser,
  getEffectiveDeepgramModel,
} from './db.js';
import { requireTelegramAuth, AuthenticatedRequest } from './auth.js';
import { sendRecordedVideoToUser, getBotInstance } from './bot.js';
import { processRecordedVideo } from './videoProcessor.js';

export const apiRouter = Router();

// Health check endpoint for container monitoring & Coolify
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// User sync (called on TMA launch)
apiRouter.post('/user/sync', (req: Request, res: Response) => {
  try {
    const { user } = req.body;
    if (user && user.id) {
      const recorded = recordUser({
        id: String(user.id),
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        language_code: user.language_code || null,
      });
      res.json({ success: true, user: recorded });
      return;
    }
    res.json({ success: false, message: 'No user data provided' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- SCRIPTS ROUTES (USER-ISOLATED) ----------------

apiRouter.get('/scripts', requireTelegramAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.tgUser?.id;
    const scripts = getAllScripts(userId);
    res.json(scripts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/scripts/:id', requireTelegramAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.tgUser?.id;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const script = getScriptById(id, userId);
    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }
    res.json(script);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/scripts', requireTelegramAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.tgUser?.id;
    const { title, content, settings } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'Title is required' });
      return;
    }
    const newScript = createScript({
      userId,
      title: title.trim(),
      content: content || '',
      settings,
    });
    res.status(201).json(newScript);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/scripts/:id', requireTelegramAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.tgUser?.id;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { title, content, settings } = req.body;
    const updated = updateScript(
      id,
      {
        title,
        content,
        settings,
      },
      userId
    );
    if (!updated) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/scripts/:id', requireTelegramAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.tgUser?.id;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const success = deleteScript(id, userId);
    if (!success) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Config route
apiRouter.get('/config', (_req: Request, res: Response) => {
  res.json({
    hasDeepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    hasBot: Boolean(getBotInstance()),
    version: '1.2.0',
    deepgramModel: getEffectiveDeepgramModel(),
  });
});

// ---------------- CAMERA RECORDING & DELIVERY ROUTES ----------------

interface TempDownloadEntry {
  filePath: string;
  filename: string;
  cleanup: () => void;
  expiresAt: number;
}

const tempDownloads = new Map<string, TempDownloadEntry>();

// Periodically clean up expired temporary downloads
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tempDownloads.entries()) {
    if (now > entry.expiresAt) {
      entry.cleanup();
      tempDownloads.delete(token);
    }
  }
}, 60_000);

const rawVideoMiddleware = express.raw({
  type: ['video/*', 'application/octet-stream'],
  limit: '150mb',
});

// 1. Send recorded video or Video Note (circle) directly to user's Telegram chat
apiRouter.post(
  '/recordings/send-telegram',
  requireTelegramAuth,
  rawVideoMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.tgUser!.id;
      const bodyBuffer = req.body as Buffer;

      if (!bodyBuffer || !Buffer.isBuffer(bodyBuffer) || bodyBuffer.length === 0) {
        res.status(400).json({ error: 'Пустой видеофайл' });
        return;
      }

      const mode = req.query.mode === 'circle' ? 'circle' : 'reels';
      const mirror = req.query.mirror === '1' || req.query.mirror === 'true';
      const duration = req.query.duration ? Number(req.query.duration) : undefined;
      const title = typeof req.query.title === 'string' ? req.query.title : undefined;
      const mimeType = typeof req.query.mimeType === 'string' ? req.query.mimeType : req.headers['content-type'];

      const processed = await processRecordedVideo(bodyBuffer, {
        mode,
        mirror,
        inputMimeType: mimeType,
      });

      try {
        const result = await sendRecordedVideoToUser(userId, processed.outputPath, {
          mode,
          title,
          duration,
        });

        res.json({
          success: true,
          sentAs: result.sentAs,
          wasConverted: processed.wasConverted,
        });
      } finally {
        processed.cleanup();
      }
    } catch (err: any) {
      console.error('[API] /recordings/send-telegram error:', err);
      res.status(500).json({
        error: err.message || 'Не удалось отправить видео в Telegram',
      });
    }
  }
);

// 2. Convert & prepare a downloadable MP4 file (for saving to smartphone files / WebView download)
apiRouter.post(
  '/recordings/prepare-download',
  requireTelegramAuth,
  rawVideoMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const bodyBuffer = req.body as Buffer;

      if (!bodyBuffer || !Buffer.isBuffer(bodyBuffer) || bodyBuffer.length === 0) {
        res.status(400).json({ error: 'Пустой видеофайл' });
        return;
      }

      const mode = req.query.mode === 'circle' ? 'circle' : 'reels';
      const mirror = req.query.mirror === '1' || req.query.mirror === 'true';
      const mimeType = typeof req.query.mimeType === 'string' ? req.query.mimeType : req.headers['content-type'];

      const processed = await processRecordedVideo(bodyBuffer, {
        mode,
        mirror,
        inputMimeType: mimeType,
      });

      const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const filename =
        mode === 'circle'
          ? `teleprompter-circle-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`
          : `teleprompter-reels-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`;

      tempDownloads.set(token, {
        filePath: processed.outputPath,
        filename,
        cleanup: processed.cleanup,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      });

      res.json({
        success: true,
        downloadUrl: `/api/recordings/download/${token}`,
        filename,
      });
    } catch (err: any) {
      console.error('[API] /recordings/prepare-download error:', err);
      res.status(500).json({
        error: err.message || 'Ошибка подготовки MP4 файла',
      });
    }
  }
);

// 3. Serve prepared MP4 download
apiRouter.get('/recordings/download/:token', (req: Request, res: Response) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const entry = tempDownloads.get(token);

  if (!entry || !fs.existsSync(entry.filePath)) {
    res.status(404).send('Файл не найден или срок ссылки истек');
    return;
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);

  const stream = fs.createReadStream(entry.filePath);
  stream.pipe(res);
});
