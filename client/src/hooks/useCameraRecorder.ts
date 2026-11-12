import { useState, useRef, useCallback, useEffect } from 'react';
import { CameraMode } from '../types';
import { haptic } from '../utils/haptics';

export type RecordingState = 'idle' | 'countdown' | 'recording' | 'paused' | 'review';

interface UseCameraRecorderOptions {
  cameraMode: CameraMode;
  selectedAudioDeviceId?: string;
  countdownSeconds?: 0 | 3;
  onRecordingStarted?: () => void;
  onRecordingPaused?: () => void;
  onRecordingResumed?: () => void;
  onRecordingStopped?: (blob: Blob, durationSec: number) => void;
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    } catch {
      // ignore
    }
  }
  return '';
}

export function useCameraRecorder({
  cameraMode,
  selectedAudioDeviceId,
  countdownSeconds = 3,
  onRecordingStarted,
  onRecordingPaused,
  onRecordingResumed,
  onRecordingStopped,
}: UseCameraRecorderOptions) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(false);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedRef = useRef<number>(0);
  const wakeLockRef = useRef<any>(null);

  const onStartedRef = useRef(onRecordingStarted);
  onStartedRef.current = onRecordingStarted;
  const onPausedRef = useRef(onRecordingPaused);
  onPausedRef.current = onRecordingPaused;
  const onResumedRef = useRef(onRecordingResumed);
  onResumedRef.current = onRecordingResumed;
  const onStoppedRef = useRef(onRecordingStopped);
  onStoppedRef.current = onRecordingStopped;

  // Screen Wake Lock so the phone never dims while reading & recording
  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // WakeLock not supported or denied
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
    }
  }, []);

  // Clear timers helper
  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  // Attach stream to video element whenever either changes
  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [stream, cameraMode, recordingState]);

  // Stop camera and clean up resources
  const stopCamera = useCallback(() => {
    clearTimers();
    releaseWakeLock();

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setStream(null);
    setRecordingState('idle');
    setElapsedSeconds(0);
    elapsedRef.current = 0;
  }, [clearTimers, releaseWakeLock]);

  // Initialize front camera when cameraMode is 'reels' or 'circle'
  const startCamera = useCallback(async () => {
    if (cameraMode === 'text') {
      stopCamera();
      return;
    }

    // If stream is already fully live with both video and audio, keep it running smoothly
    const hasLiveVideo =
      streamRef.current &&
      streamRef.current.active &&
      streamRef.current.getVideoTracks().some((t) => t.readyState === 'live');
    const hasLiveAudio =
      streamRef.current &&
      streamRef.current.getAudioTracks().some((t) => t.readyState === 'live');

    if (hasLiveVideo && hasLiveAudio) {
      if (videoRef.current && videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
      return;
    }

    // Stop and release any existing or stale tracks before opening a fresh hardware camera session
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsCameraLoading(true);
    setCameraError(null);

    try {
      let mediaStream: MediaStream;
      try {
        // Optimal mobile HD constraints (hardware-accelerated on iOS & Android WebViews)
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 },
          },
          audio: selectedAudioDeviceId
            ? {
                deviceId: { exact: selectedAudioDeviceId },
                echoCancellation: true,
                noiseSuppression: true,
              }
            : {
                echoCancellation: true,
                noiseSuppression: true,
              },
        });
      } catch {
        // Fallback if specific device/resolution constraint fails
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        });
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);
      acquireWakeLock();
    } catch (err: any) {
      console.error('[Camera] Failed to access front camera:', err);
      setCameraError(
        'Нет доступа к камере или микрофону. Разрешите доступ в настройках Telegram / браузера.'
      );
    } finally {
      setIsCameraLoading(false);
    }
  }, [cameraMode, selectedAudioDeviceId, stopCamera, acquireWakeLock]);

  useEffect(() => {
    if (cameraMode === 'reels' || cameraMode === 'circle') {
      startCamera();
    } else {
      stopCamera();
    }
  }, [cameraMode, startCamera, stopCamera]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Revoke object URL when replaced or unmounted
  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, [recordedUrl]);

  // Start duration ticker (runs while recordingState === 'recording')
  const startDurationTicker = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
    }
    durationTimerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
    }, 1000);
  }, []);

  // Actually begin MediaRecorder capture
  const beginMediaRecording = useCallback(() => {
    const activeStream = streamRef.current;
    if (
      !activeStream ||
      !activeStream.active ||
      !activeStream.getVideoTracks().some((t) => t.readyState === 'live')
    ) {
      setCameraError('Камера ещё не готова');
      return;
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    elapsedRef.current = 0;
    setElapsedSeconds(0);

    const mimeType = getSupportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(activeStream, {
            mimeType,
            videoBitsPerSecond: 3_500_000,
          })
        : new MediaRecorder(activeStream);
    } catch {
      recorder = new MediaRecorder(activeStream);
    }

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      clearTimers();
      const finalType = recorder.mimeType || mimeType || 'video/mp4';
      const blob = new Blob(chunksRef.current, { type: finalType });
      const url = URL.createObjectURL(blob);

      setRecordedBlob((prevBlob) => {
        if (prevBlob) {
          // old blob replaced
        }
        return blob;
      });
      setRecordedUrl((prevUrl) => {
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        return url;
      });
      setRecordingState('review');

      if (onStoppedRef.current) {
        onStoppedRef.current(blob, elapsedRef.current);
      }
    };

    recorderRef.current = recorder;
    recorder.start(1000); // 1s chunks for smooth memory footprint
    setRecordingState('recording');
    startDurationTicker();
    haptic.success();

    if (onStartedRef.current) {
      onStartedRef.current();
    }
  }, [clearTimers, startDurationTicker]);

  // Initiate recording (with optional 3-2-1 countdown)
  const startRecording = useCallback(async () => {
    const activeStream = streamRef.current;
    const isHealthy =
      activeStream &&
      activeStream.active &&
      activeStream.getVideoTracks().some((t) => t.readyState === 'live');

    if (!isHealthy) {
      await startCamera();
    }

    clearTimers();

    if (!countdownSeconds || countdownSeconds <= 0) {
      beginMediaRecording();
      return;
    }

    let count = countdownSeconds;
    setCountdownValue(count);
    setRecordingState('countdown');
    haptic.medium();

    countdownTimerRef.current = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setCountdownValue(count);
        haptic.medium();
      } else {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        beginMediaRecording();
      }
    }, 1000);
  }, [countdownSeconds, clearTimers, beginMediaRecording, startCamera]);

  // Cancel countdown mid-flight (Apple Interruptibility principle)
  const cancelCountdown = useCallback(() => {
    if (recordingState === 'countdown') {
      clearTimers();
      setRecordingState('idle');
      haptic.light();
    }
  }, [recordingState, clearTimers]);

  // Pause recording (both user-triggered and auto-pause on script end)
  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;

    try {
      recorder.pause();
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
      setRecordingState('paused');
      haptic.medium();
      if (onPausedRef.current) {
        onPausedRef.current();
      }
    } catch (err) {
      console.warn('[Camera] Pause not supported on this browser, stopping instead:', err);
    }
  }, []);

  // Resume recording from paused state
  const resumeRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;

    try {
      recorder.resume();
      setRecordingState('recording');
      startDurationTicker();
      haptic.medium();
      if (onResumedRef.current) {
        onResumedRef.current();
      }
    } catch (err) {
      console.warn('[Camera] Resume error:', err);
    }
  }, [startDurationTicker]);

  // Finish recording and open Review Sheet
  const stopRecording = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
        haptic.heavy();
      } catch (err) {
        console.warn('[Camera] Stop error:', err);
        setRecordingState('idle');
      }
    } else {
      setRecordingState('idle');
    }
  }, [clearTimers]);

  // Auto-pause at 60 seconds when in Telegram Circle (1:1 Video Note) mode
  useEffect(() => {
    if (cameraMode === 'circle' && recordingState === 'recording' && elapsedSeconds >= 60) {
      stopRecording();
    }
  }, [cameraMode, recordingState, elapsedSeconds, stopRecording]);

  // Discard recorded take and return to live camera preview
  const discardRecording = useCallback(() => {
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    setRecordedBlob(null);
    setRecordedUrl(null);
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    setRecordingState('idle');

    // Ensure live camera preview resumes smoothly
    if (videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [recordedUrl]);

  return {
    videoRef,
    stream,
    cameraError,
    isCameraLoading,
    recordingState,
    countdownValue,
    elapsedSeconds,
    recordedBlob,
    recordedUrl,
    startCamera,
    stopCamera,
    startRecording,
    cancelCountdown,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
  };
}
