import { useState, useRef, useCallback, useEffect } from 'react';

export interface SpeechTranscriptEvent {
  transcript: string;
  words: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  isFinal: boolean;
}

interface UseSpeechRecognitionOptions {
  deviceId?: string;
  externalStream?: MediaStream | null;
  onTranscript: (event: SpeechTranscriptEvent) => void;
  onReady?: () => void;
  onPermissionGranted?: () => void;
  onError?: (error: string) => void;
  onLimitExceeded?: (message: string) => void;
  onWarning5min?: (remainingSeconds: number) => void;
  onBillingStatus?: (remainingSeconds: number, plan: string) => void;
}

// Resamples Float32 audio to 16kHz 16-bit Linear PCM for Deepgram
function downsampleAndConvertToPCM16(
  inputData: Float32Array,
  inputSampleRate: number,
  outputSampleRate = 16000
): ArrayBuffer {
  if (outputSampleRate === inputSampleRate) {
    const pcm = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm.buffer;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(inputData.length / ratio);
  const result = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputData.length; i++) {
      accum += inputData[i];
      count++;
    }
    const sample = count > 0 ? accum / count : inputData[offsetBuffer] || 0;
    const s = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result.buffer;
}

export function useSpeechRecognition({
  deviceId,
  externalStream,
  onTranscript,
  onReady,
  onPermissionGranted,
  onError,
  onLimitExceeded,
  onWarning5min,
  onBillingStatus,
}: UseSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const isSelfOwnedStreamRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const isReadyRef = useRef<boolean>(false);
  const keepAliveIntervalRef = useRef<any>(null);

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const onPermissionGrantedRef = useRef(onPermissionGranted);
  onPermissionGrantedRef.current = onPermissionGranted;

  const onLimitExceededRef = useRef(onLimitExceeded);
  onLimitExceededRef.current = onLimitExceeded;

  const onWarning5minRef = useRef(onWarning5min);
  onWarning5minRef.current = onWarning5min;

  const onBillingStatusRef = useRef(onBillingStatus);
  onBillingStatusRef.current = onBillingStatus;

  // On-demand audio level query to prevent continuous 60 FPS React re-renders of the entire prompter
  const getAudioLevel = useCallback((): number => {
    if (!analyserRef.current) return 0;
    const analyser = analyserRef.current;
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);
    let sum = 0;
    for (let i = 0; i < freqData.length; i++) {
      sum += freqData[i];
    }
    const avg = sum / freqData.length;
    return Math.min(100, Math.round((avg / 85) * 100));
  }, []);

  const stop = useCallback(() => {
    isReadyRef.current = false;
    setIsListening(false);
    setIsConnecting(false);
    setIsReady(false);
    setStatusMessage('');

    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (e) {
        // ignore
      }
      processorRef.current = null;
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch (e) {
        // ignore
      }
      analyserRef.current = null;
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch (e) {
        // ignore
      }
      sourceRef.current = null;
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try {
        audioCtxRef.current.close();
      } catch (e) {
        // ignore
      }
      audioCtxRef.current = null;
    }

    if (isSelfOwnedStreamRef.current && mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    mediaStreamRef.current = null;
    isSelfOwnedStreamRef.current = false;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {
        // ignore
      }
      wsRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    stop();
    isReadyRef.current = false;
    setIsConnecting(true);
    setIsReady(false);
    setStatusMessage('Инициализация микрофона...');

    try {
      // 1. Get audio stream: reuse from active camera stream if available (prevents iOS WebView dual-stream crash),
      // otherwise request standalone microphone stream with custom device
      let stream: MediaStream;
      const liveExternalAudio = externalStream
        ?.getAudioTracks()
        .find((t) => t.readyState === 'live');

      if (liveExternalAudio) {
        // Borrow the existing live audio track without owning or terminating it
        stream = new MediaStream([liveExternalAudio]);
        isSelfOwnedStreamRef.current = false;
      } else {
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        isSelfOwnedStreamRef.current = true;
      }
      mediaStreamRef.current = stream;

      // Permission granted! Notify caller to unlock mic selector in UI
      if (onPermissionGrantedRef.current) {
        onPermissionGrantedRef.current();
      }

      // 2. Open WebSocket to backend proxy with Telegram initData
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const initData = window.Telegram?.WebApp?.initData || '';
      const wsUrl = `${protocol}//${window.location.host}/ws/speech?initData=${encodeURIComponent(initData)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        setStatusMessage('Подключение к распознаванию речи...');

        // Keepalive ping every 10s
        keepAliveIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'keepalive' }));
          }
        }, 10000);

        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          let audioCtx: AudioContext;
          try {
            // Prefer native 16kHz context so modern browser does hardware-accelerated resampling in C++
            audioCtx = new AudioContextClass({ sampleRate: 16000 });
          } catch {
            audioCtx = new AudioContextClass();
          }
          audioCtxRef.current = audioCtx;

          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }

          const source = audioCtx.createMediaStreamSource(stream);
          sourceRef.current = source;

          // Audio Analyser for live voice volume meter (queried on demand)
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
          analyser.smoothingTimeConstant = 0.3;
          source.connect(analyser);
          analyserRef.current = analyser;

          // 4096 samples buffer for streaming to Deepgram
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          // Silent gain to prevent self-feedback in phone speakers
          const silentGain = audioCtx.createGain();
          silentGain.gain.value = 0;

          processor.onaudioprocess = (e) => {
            // Only stream audio when Deepgram is officially ready!
            if (isReadyRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm16Buffer = downsampleAndConvertToPCM16(inputData, audioCtx.sampleRate, 16000);
              wsRef.current.send(pcm16Buffer);
            }
          };

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(audioCtx.destination);
        } catch (audioErr: any) {
          console.error('Audio processing setup error:', audioErr);
          setStatusMessage('Ошибка настройки звука: ' + (audioErr?.message || audioErr));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'ready') {
            // Deepgram is fully open and ready to receive streaming audio
            isReadyRef.current = true;
            setIsReady(true);
            setIsConnecting(false);
            setIsListening(true);
            setStatusMessage('Готов! Ожидаю речь...');
            if (onReadyRef.current) onReadyRef.current();
          } else if (data.type === 'billing_status') {
            if (onBillingStatusRef.current) {
              onBillingStatusRef.current(data.remainingSeconds, data.plan);
            }
          } else if (data.type === 'warning_5min') {
            if (onWarning5minRef.current) {
              onWarning5minRef.current(data.remainingSeconds);
            }
          } else if (data.type === 'limit_exceeded') {
            setStatusMessage(data.message || 'Голосовое время закончилось 🎬');
            stop();
            if (onLimitExceededRef.current) {
              onLimitExceededRef.current(data.message);
            }
          } else if (data.type === 'transcript') {
            const transcript = data.transcript || '';
            let words = data.words || [];
            if (words.length === 0 && transcript.trim()) {
              words = transcript.trim().split(/\s+/).filter(Boolean).map((w: string) => ({ word: w }));
            }
            if (onTranscriptRef.current) {
              onTranscriptRef.current({
                transcript,
                words,
                isFinal: data.isFinal,
              });
            }
          } else if (data.type === 'error') {
            console.error('WebSocket Deepgram error:', data.message);
            setStatusMessage(`Ошибка: ${data.message}`);
            setIsConnecting(false);
            setIsReady(false);
            if (onError) onError(data.message);
          }
        } catch (e) {
          // ignore parsing error
        }
      };

      ws.onerror = (err) => {
        console.error('Speech WebSocket error:', err);
        setStatusMessage('Ошибка WebSocket соединения');
        setIsConnecting(false);
        setIsReady(false);
        if (onError) onError('Ошибка WebSocket соединения');
        stop();
      };

      ws.onclose = () => {
        setIsListening(false);
        setIsConnecting(false);
        setIsReady(false);
      };
    } catch (err: any) {
      console.error('Failed to start speech recognition:', err);
      const msg = err?.message || 'Не удалось получить доступ к микрофону';
      setStatusMessage(msg);
      setIsConnecting(false);
      setIsReady(false);
      if (onError) onError(msg);
      stop();
    }
  }, [deviceId, onError, stop]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isListening,
    isConnecting,
    isReady,
    statusMessage,
    getAudioLevel,
    start,
    stop,
  };
}
