import { WebSocket, WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { getEffectiveDeepgramModel } from './db.js';
import { authenticateWebSocket } from './auth.js';
import { canStartVoiceSession, recordVoiceUsage } from './voiceGuard.js';

// Linear16 PCM at 16,000 Hz, 1 channel: 16000 samples/sec * 2 bytes/sample = 32,000 bytes/sec
const BYTES_PER_SECOND = 32000;
// Flush audio usage to database every 1.5 seconds of audio (48,000 bytes)
const FLUSH_THRESHOLD_BYTES = 48000;

export function setupSpeechProxy(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[SpeechProxy] 🟢 Клиент подключился к WebSocket (${clientIp})`);

    // 1. Authenticate user
    const user = authenticateWebSocket(req.url);
    if (!user) {
      console.warn('[SpeechProxy] ⛔ Подключение отклонено: не авторизован');
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'UNAUTHORIZED',
          message: 'Требуется авторизация через Telegram Mini App',
        })
      );
      ws.close(1008, 'Unauthorized');
      return;
    }

    // 2. Check user's voice limits
    const check = canStartVoiceSession(user.id);
    if (!check.allowed) {
      console.log(`[SpeechProxy] ⏳ У пользователя ${user.id} исчерпан голосовой лимит`);
      ws.send(
        JSON.stringify({
          type: 'limit_exceeded',
          message: check.reason || 'Голосовое время закончилось 🎬',
          remainingSeconds: 0,
          plan: check.plan,
        })
      );
      ws.close(1000, 'Limit exceeded');
      return;
    }

    // Send initial billing status to client
    ws.send(
      JSON.stringify({
        type: 'billing_status',
        remainingSeconds: check.remainingSeconds,
        plan: check.plan,
      })
    );

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      console.warn('[SpeechProxy] ⚠️ DEEPGRAM_API_KEY не задан в .env');
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'DEEPGRAM_API_KEY не задан в .env на сервере. Укажите ключ для включения распознавания речи.',
        })
      );
      ws.close(1008, 'API key missing');
      return;
    }

    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    let dgConnection: any = null;
    let isConnectedToDg = false;
    let totalAudioBytes = 0;
    let pendingAudioBytes = 0;
    let warning5minSent = check.remainingSeconds <= 300;
    let isTerminating = false;

    // Helper: Flush pending audio seconds into DB
    const flushUsage = () => {
      if (pendingAudioBytes <= 0) return;
      const secondsToDeduct = pendingAudioBytes / BYTES_PER_SECOND;
      pendingAudioBytes = 0;

      const result = recordVoiceUsage(user.id, secondsToDeduct, sessionId);

      if (result.warning5min && !warning5minSent) {
        warning5minSent = true;
        console.log(`[SpeechProxy] ⚠️ Предупреждение 5 минут для пользователя ${user.id} (${result.remainingSeconds.toFixed(0)}с осталось)`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'warning_5min',
              remainingSeconds: result.remainingSeconds,
              message: 'Осталось менее 5 минут голосового режима',
            })
          );
        }
      }

      if (result.limitReached && !isTerminating) {
        isTerminating = true;
        console.log(`[SpeechProxy] 🛑 Лимит исчерпан для пользователя ${user.id} в сессии ${sessionId}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'limit_exceeded',
              remainingSeconds: 0,
              message: 'Голосовое время закончилось 🎬',
            })
          );
        }

        if (dgConnection) {
          try {
            dgConnection.finish();
          } catch {
            // ignore
          }
        }
        ws.close(1000, 'Limit reached');
      }
    };

    try {
      const deepgram = createClient(apiKey);
      const selectedModel = getEffectiveDeepgramModel();
      console.log(`[SpeechProxy] 🎙️ Сессия ${sessionId} для пользователя ${user.id} (${selectedModel})`);

      dgConnection = deepgram.listen.live({
        model: selectedModel,
        language: 'ru',
        smart_format: true,
        interim_results: true,
        punctuate: true,
        endpointing: 300,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      });

      dgConnection.on(LiveTranscriptionEvents.Open, () => {
        isConnectedToDg = true;
        console.log('[SpeechProxy] ✅ Deepgram Live подключен и готов принимать аудио (linear16, ru)');
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ready' }));
        }
      });

      dgConnection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const alternatives = data.channel?.alternatives || [];
        const primaryAlt = alternatives[0];
        const transcript = primaryAlt?.transcript || '';
        const words = primaryAlt?.words || [];
        const isFinal = Boolean(data.is_final);

        if (transcript.trim() || words.length > 0) {
          console.log(`[SpeechProxy] 🗣️ Распознано: "${transcript.trim()}" (слов: ${words.length}, final: ${isFinal})`);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'transcript',
                transcript,
                words,
                isFinal,
              })
            );
          }
        }
      });

      dgConnection.on(LiveTranscriptionEvents.Error, (err: any) => {
        console.error('[SpeechProxy] ❌ Ошибка Deepgram:', err);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: err?.message || 'Ошибка Deepgram',
            })
          );
        }
      });

      dgConnection.on(LiveTranscriptionEvents.Close, (event: any) => {
        console.log('[SpeechProxy] 🔴 Deepgram соединение закрыто', event || '');
        isConnectedToDg = false;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'closed' }));
        }
      });
    } catch (err: any) {
      console.error('[SpeechProxy] ❌ Не удалось инициализировать Deepgram клиент:', err);
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Не удалось подключиться к Deepgram: ' + (err?.message || String(err)),
        })
      );
      ws.close();
      return;
    }

    ws.on('message', (message: any, isBinary: boolean) => {
      if (isTerminating) return;

      if (isBinary) {
        const chunkLen = message.length;
        totalAudioBytes += chunkLen;
        pendingAudioBytes += chunkLen;

        // Stream binary chunk to Deepgram
        if (dgConnection && isConnectedToDg) {
          dgConnection.send(message);
        }

        // Flush periodically when buffer accumulates
        if (pendingAudioBytes >= FLUSH_THRESHOLD_BYTES) {
          flushUsage();
        }
      } else {
        try {
          const text = message.toString();
          const parsed = JSON.parse(text);
          if (parsed.type === 'keepalive') {
            if (dgConnection && isConnectedToDg) {
              dgConnection.keepAlive();
            }
          }
        } catch {
          // ignore non-json
        }
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[SpeechProxy] 🔌 Сессия ${sessionId} закрыта (всего передано ${(totalAudioBytes / 1024).toFixed(1)} KB)`);
      flushUsage();
      if (dgConnection) {
        try {
          dgConnection.finish();
        } catch {
          // ignore
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[SpeechProxy] ⚠️ Ошибка сокета клиента:', err);
      flushUsage();
    });
  });
}
