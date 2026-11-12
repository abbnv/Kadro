import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  RotateCcw,
  CheckCircle2,
  Loader2,
  FlipHorizontal,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Share2,
} from 'lucide-react';
import { sendRecordingToTelegram, prepareRecordingDownload } from '../api';
import { haptic } from '../utils/haptics';

interface CameraReviewModalProps {
  videoBlob: Blob;
  videoUrl: string;
  mode: 'reels' | 'circle';
  durationSeconds: number;
  scriptTitle: string;
  initialMirrorOutput?: boolean;
  onToggleMirrorOutput?: (mirror: boolean) => void;
  onRetake: () => void;
  onClose: () => void;
}

function formatDuration(sec: number): string {
  const safeSec = Math.max(0, isFinite(sec) && !isNaN(sec) ? sec : 0);
  const m = Math.floor(safeSec / 60);
  const s = Math.floor(safeSec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const CameraReviewModal: React.FC<CameraReviewModalProps> = ({
  videoBlob,
  videoUrl,
  mode,
  durationSeconds,
  scriptTitle,
  initialMirrorOutput = true,
  onToggleMirrorOutput,
  onRetake,
  onClose,
}) => {
  const [mirrorOutput, setMirrorOutput] = useState<boolean>(initialMirrorOutput);
  const [isSendingTg, setIsSendingTg] = useState<boolean>(false);
  const [sentToTg, setSentToTg] = useState<boolean>(false);
  const [hasSavedLocally, setHasSavedLocally] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'close' | 'retake' | null>(null);

  // Custom Video Player states (ensures UI is never mirrored & looks perfect in circle mode)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(durationSeconds);

  const effectiveDuration =
    duration && !isNaN(duration) && isFinite(duration) && duration > 0
      ? duration
      : durationSeconds > 0
      ? durationSeconds
      : 1;

  const progressPercent = Math.min(
    100,
    Math.max(0, (currentTime / effectiveDuration) * 100)
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const tryPlay = async () => {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        // Autoplay with sound might be blocked; fallback to muted autoplay
        video.muted = true;
        setIsMuted(true);
        try {
          await video.play();
          setIsPlaying(true);
        } catch {
          setIsPlaying(false);
        }
      }
    };

    tryPlay();

    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [videoUrl]);

  const togglePlay = () => {
    haptic.light();
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic.light();
    const video = videoRef.current;
    if (!video) return;
    const next = !isMuted;
    video.muted = next;
    setIsMuted(next);
  };

  const handleSeek = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>
  ) => {
    e.stopPropagation();
    if (!videoRef.current || !progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX =
      'touches' in e && e.touches.length > 0 ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = ratio * effectiveDuration;
    videoRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const handleToggleMirror = () => {
    haptic.light();
    const next = !mirrorOutput;
    setMirrorOutput(next);
    if (onToggleMirrorOutput) {
      onToggleMirrorOutput(next);
    }
  };

  const handleSendTelegram = async () => {
    if (isSendingTg) return;
    haptic.medium();
    setIsSendingTg(true);
    setErrorMsg(null);

    try {
      await sendRecordingToTelegram(videoBlob, {
        mode,
        mirror: mirrorOutput,
        duration: durationSeconds,
        title: scriptTitle,
      });
      setSentToTg(true);
      haptic.success();
    } catch (err: any) {
      haptic.error();
      setErrorMsg(err.message || 'Не удалось отправить в Telegram');
    } finally {
      setIsSendingTg(false);
    }
  };

  const handleDownloadFile = async () => {
    if (isDownloading) return;
    haptic.medium();
    setIsDownloading(true);
    setErrorMsg(null);

    try {
      // 1. Prepare server-side optimized MP4 (applies horizontal flip if mirrored, 1:1 circle or 9:16 crop, H.264/AAC)
      let fileToShare: File | null = null;
      let downloadUrl = '';
      let filename = `kadro-${mode}-${Date.now()}.mp4`;

      try {
        const prepared = await prepareRecordingDownload(videoBlob, {
          mode,
          mirror: mirrorOutput,
        });
        downloadUrl = prepared.downloadUrl;
        filename = prepared.filename;

        // Fetch converted MP4 blob from server to create a proper File object for native sharing
        const res = await fetch(prepared.downloadUrl);
        if (res.ok) {
          const mp4Blob = await res.blob();
          fileToShare = new File([mp4Blob], filename, { type: 'video/mp4' });
        }
      } catch (prepErr) {
        console.warn('[Review] Server MP4 prep failed, using local blob:', prepErr);
        // Fallback to local recorded blob
        const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
        filename = `kadro-${mode}-${Date.now()}.${ext}`;
        fileToShare = new File([videoBlob], filename, {
          type: videoBlob.type || 'video/mp4',
        });
        downloadUrl = videoUrl;
      }

      // 2. Try Native System Share Sheet (iOS / Android -> "Сохранить видео" в Фото/Галерею)
      let sharedNatively = false;
      if (
        fileToShare &&
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        typeof navigator.share === 'function'
      ) {
        try {
          if (navigator.canShare({ files: [fileToShare] })) {
            await navigator.share({
              files: [fileToShare],
              title: scriptTitle || 'Видео Kadro',
            });
            sharedNatively = true;
            setHasSavedLocally(true);
            haptic.success();
          }
        } catch (shareErr: any) {
          // If user simply closed the native sheet (AbortError), don't treat as error
          if (shareErr?.name === 'AbortError') {
            return;
          }
          console.warn('[Review] Native share failed, falling back:', shareErr);
        }
      }

      // 3. If native share wasn't available or didn't run, fallback to Telegram WebApp download or browser download
      if (!sharedNatively) {
        const tgWebApp = window.Telegram?.WebApp as any;
        const fullUrl = downloadUrl
          ? new URL(downloadUrl, window.location.origin).toString()
          : videoUrl;

        if (tgWebApp && typeof tgWebApp.downloadFile === 'function' && downloadUrl) {
          tgWebApp.downloadFile(
            {
              url: fullUrl,
              file_name: filename,
            },
            (accepted: boolean) => {
              if (!accepted) {
                triggerBrowserDownload(downloadUrl || videoUrl, filename);
              }
            }
          );
        } else {
          triggerBrowserDownload(downloadUrl || videoUrl, filename);
        }
        setHasSavedLocally(true);
        haptic.success();
      }
    } catch (err: any) {
      haptic.error();
      setErrorMsg(err.message || 'Не удалось сохранить видео');
    } finally {
      setIsDownloading(false);
    }
  };

  const triggerBrowserDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 200);
  };

  // Apple Design Principle: Guard irreversible data loss with confirmation sheet
  const isVideoSaved = sentToTg || hasSavedLocally;

  const handleRequestClose = () => {
    if (!isVideoSaved) {
      haptic.warning();
      setConfirmAction('close');
    } else {
      haptic.light();
      onClose();
    }
  };

  const handleRequestRetake = () => {
    if (!isVideoSaved) {
      haptic.warning();
      setConfirmAction('retake');
    } else {
      haptic.medium();
      onRetake();
    }
  };

  const handleConfirmAction = () => {
    haptic.medium();
    const action = confirmAction;
    setConfirmAction(null);
    if (action === 'retake') {
      onRetake();
    } else {
      onClose();
    }
  };

  const handleCancelAction = () => {
    haptic.light();
    setConfirmAction(null);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-2xl flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-md rounded-[32px] bg-neutral-900/90 backdrop-blur-3xl border border-white/15 shadow-[0_28px_80px_rgba(0,0,0,0.85),inset_0_1px_1px_rgba(255,255,255,0.22)] p-5 flex flex-col items-center gap-4 text-white animate-sheet-up">
        {/* Top Header */}
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs font-medium text-neutral-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-white" />
              {mode === 'circle' ? 'Кружок Telegram 1:1' : 'Видео 9:16'}
            </span>
            <span className="text-xs font-mono text-neutral-400">
              {formatDuration(durationSeconds)}
            </span>
          </div>

          <button
            onPointerDown={() => haptic.light()}
            onClick={handleRequestClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-neutral-400 hover:text-white apple-press transition-colors"
            title="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video Preview Container (Click to Play/Pause, mirror effect applies ONLY to video frame) */}
        <div className="relative w-full flex items-center justify-center py-1">
          {mode === 'circle' ? (
            <div
              onClick={togglePlay}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  togglePlay();
                }
              }}
              aria-label={isPlaying ? 'Пауза' : 'Воспроизведение'}
              className="relative w-56 h-56 sm:w-60 sm:h-60 rounded-full overflow-hidden border-2 border-white/25 shadow-[0_16px_48px_rgba(0,0,0,0.75)] bg-black cursor-pointer group select-none active:scale-[0.98] transition-transform"
            >
              <video
                ref={videoRef}
                src={videoUrl}
                playsInline
                loop
                autoPlay
                onTimeUpdate={() => {
                  if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                }}
                onLoadedMetadata={() => {
                  if (
                    videoRef.current &&
                    videoRef.current.duration &&
                    !isNaN(videoRef.current.duration) &&
                    isFinite(videoRef.current.duration)
                  ) {
                    setDuration(videoRef.current.duration);
                  }
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className={`w-full h-full object-cover pointer-events-none transition-transform duration-200 ${
                  mirrorOutput ? 'scale-x-[-1]' : ''
                }`}
              />

              {/* Pause Overlay (Centered in circle) */}
              {!isPlaying && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center transition-opacity">
                  <div className="w-14 h-14 rounded-full bg-white/20 border border-white/30 shadow-2xl flex items-center justify-center text-white backdrop-blur-md">
                    <Play className="w-6 h-6 fill-white ml-0.5" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              onClick={togglePlay}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  togglePlay();
                }
              }}
              aria-label={isPlaying ? 'Пауза' : 'Воспроизведение'}
              className="relative w-full max-w-[210px] aspect-[9/16] max-h-[38vh] rounded-[24px] overflow-hidden border border-white/15 shadow-[0_16px_48px_rgba(0,0,0,0.75)] bg-black cursor-pointer group select-none active:scale-[0.98] transition-transform"
            >
              <video
                ref={videoRef}
                src={videoUrl}
                playsInline
                loop
                autoPlay
                onTimeUpdate={() => {
                  if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                }}
                onLoadedMetadata={() => {
                  if (
                    videoRef.current &&
                    videoRef.current.duration &&
                    !isNaN(videoRef.current.duration) &&
                    isFinite(videoRef.current.duration)
                  ) {
                    setDuration(videoRef.current.duration);
                  }
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className={`w-full h-full object-cover pointer-events-none transition-transform duration-200 ${
                  mirrorOutput ? 'scale-x-[-1]' : ''
                }`}
              />

              {/* Pause Overlay (Centered in reels view) */}
              {!isPlaying && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center transition-opacity">
                  <div className="w-14 h-14 rounded-full bg-white/20 border border-white/30 shadow-2xl flex items-center justify-center text-white backdrop-blur-md">
                    <Play className="w-6 h-6 fill-white ml-0.5" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Custom Video Controls Bar (Separate from video transform, NEVER mirrored) */}
        <div className="w-full max-w-[280px] sm:max-w-[310px] bg-white/[0.06] border border-white/10 rounded-2xl px-3 py-2 flex flex-col gap-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.25)] select-none">
          <div className="flex items-center gap-2.5">
            {/* Play / Pause Toggle Button */}
            <button
              type="button"
              onPointerDown={() => haptic.light()}
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 flex items-center justify-center text-white transition-all shrink-0"
              title={isPlaying ? 'Пауза' : 'Воспроизведение'}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-white" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
              )}
            </button>

            {/* Scrubber / Progress Bar */}
            <div
              ref={progressBarRef}
              onClick={handleSeek}
              className="relative flex-1 h-6 flex items-center cursor-pointer group py-2"
            >
              <div className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden relative">
                <div
                  className="h-full bg-white rounded-full transition-all duration-75"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Sound Mute / Unmute Toggle */}
            <button
              type="button"
              onPointerDown={() => haptic.light()}
              onClick={toggleMute}
              className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 flex items-center justify-center text-white transition-all shrink-0"
              title={isMuted ? 'Включить звук' : 'Выключить звук'}
            >
              {isMuted ? (
                <VolumeX className="w-3.5 h-3.5 text-neutral-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-white" />
              )}
            </button>
          </div>

          {/* Current Time / Total Duration */}
          <div className="flex items-center justify-between text-[11px] font-mono text-neutral-300 px-0.5">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(effectiveDuration)}</span>
          </div>
        </div>

        {/* Mirror Output Quick Toggle */}
        <button
          onPointerDown={() => haptic.light()}
          onClick={handleToggleMirror}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-neutral-300 apple-press-subtle transition-colors"
        >
          <FlipHorizontal className="w-3.5 h-3.5 text-neutral-400" />
          <span>Зеркалить готовое видео:</span>
          <span className="font-semibold text-white">{mirrorOutput ? 'Вкл' : 'Выкл'}</span>
        </button>

        {/* Status / Error Feedback */}
        {errorMsg && (
          <div className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {sentToTg && (
          <div className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>
              {mode === 'circle'
                ? 'Кружок отправлен вам в чат с ботом!'
                : 'Видео отправлено вам в чат с ботом!'}
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="w-full flex flex-col gap-2.5 pt-1">
          {/* Primary Action: Send to Telegram */}
          <button
            onPointerDown={() => haptic.medium()}
            onClick={handleSendTelegram}
            disabled={isSendingTg}
            className="w-full h-12 rounded-2xl bg-white text-black font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(255,255,255,0.2)] apple-press transition-all disabled:opacity-60"
          >
            {isSendingTg ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin stroke-[2.5]" />
                <span>
                  {mode === 'circle' ? 'Сборка кружка 1:1 и отправка...' : 'Отправка в Telegram...'}
                </span>
              </>
            ) : sentToTg ? (
              <>
                <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                <span>Отправить ещё раз в Telegram</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 stroke-[2.2]" />
                <span>
                  {mode === 'circle' ? 'Отправить кружком в Telegram' : 'Отправить видео в Telegram'}
                </span>
              </>
            )}
          </button>

          {/* Secondary Row: Save to Gallery + Retake */}
          <div className="w-full grid grid-cols-2 gap-2.5">
            <button
              onPointerDown={() => haptic.light()}
              onClick={handleDownloadFile}
              disabled={isDownloading}
              className="h-11 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-white font-medium text-xs flex items-center justify-center gap-2 apple-press transition-colors disabled:opacity-60"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Сборка MP4...</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 text-white" />
                  <span>В галерею</span>
                </>
              )}
            </button>

            <button
              onPointerDown={() => haptic.light()}
              onClick={handleRequestRetake}
              className="h-11 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-neutral-200 hover:text-white font-medium text-xs flex items-center justify-center gap-2 apple-press transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Переснять</span>
            </button>
          </div>
        </div>
      </div>

      {/* Apple-style Confirmation Sheet for Unsaved Recording */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            e.stopPropagation();
            handleCancelAction();
          }}
        >
          <div
            className="w-full max-w-[320px] rounded-[28px] bg-neutral-900/95 backdrop-blur-3xl border border-white/20 p-5 flex flex-col items-center text-center gap-3.5 shadow-[0_28px_80px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.25)] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Warning Icon Badge */}
            <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-6 h-6 stroke-[2.2]" />
            </div>

            {/* Title & Description */}
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold text-white tracking-tight">
                {confirmAction === 'retake' ? 'Переснять видео?' : 'Закрыть без сохранения?'}
              </h3>
              <p className="text-xs text-neutral-300/80 leading-relaxed px-1">
                Видео ещё не отправлено в Telegram и не сохранено в галерею. Если продолжить, текущая запись будет безвозвратно удалена.
              </p>
            </div>

            {/* Apple Action Hierarchy: Safe Primary on top, Destructive below */}
            <div className="w-full flex flex-col gap-2 pt-1">
              <button
                type="button"
                onPointerDown={() => haptic.light()}
                onClick={handleCancelAction}
                className="w-full h-11 rounded-2xl bg-white text-black font-semibold text-xs flex items-center justify-center shadow-[0_4px_16px_rgba(255,255,255,0.15)] active:scale-[0.98] transition-all"
              >
                Остаться и сохранить
              </button>

              <button
                type="button"
                onPointerDown={() => haptic.medium()}
                onClick={handleConfirmAction}
                className="w-full h-10 rounded-2xl bg-red-500/15 hover:bg-red-500/20 border border-red-500/25 text-red-300 font-medium text-xs flex items-center justify-center active:scale-[0.98] transition-all"
              >
                {confirmAction === 'retake' ? 'Удалить и переснять' : 'Удалить и закрыть'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
