import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Script, ScriptSettings, AudioDevice, CameraMode } from '../types';
import { PrompterControls } from './PrompterControls';
import { CameraReviewModal } from './CameraReviewModal';
import { usePrompterScroll } from '../hooks/usePrompterScroll';
import { useSpeechRecognition, SpeechTranscriptEvent } from '../hooks/useSpeechRecognition';
import { useCameraRecorder } from '../hooks/useCameraRecorder';
import { useWakeLock } from '../hooks/useWakeLock';
import { haptic } from '../utils/haptics';
import {
  AlertCircle,
  CheckCircle2,
  VideoOff,
  RefreshCw,
} from 'lucide-react';

interface PrompterViewProps {
  script: Script;
  onUpdateScriptSettings: (settings: Partial<ScriptSettings>) => void;
  onExit: () => void;
  devices: AudioDevice[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  hasMicPermission: boolean;
  onRequestMicPermission: () => void;
  onPermissionGranted?: () => void;
  hasDeepgram: boolean;
}

// Isolated Progress Bar subcomponent: animates without re-rendering the heavy prompter DOM tree
interface ReadingProgressBarProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  mode: 'speed' | 'speech';
  activeWordIndex: number;
  totalTokens: number;
}

const ReadingProgressBar: React.FC<ReadingProgressBarProps> = ({
  containerRef,
  mode,
  activeWordIndex,
  totalTokens,
}) => {
  const barRef = useRef<HTMLDivElement>(null);

  // In speech mode: update progress when activeWordIndex advances
  useEffect(() => {
    if (mode === 'speech') {
      const pct = totalTokens > 1 ? Math.min(100, Math.round((activeWordIndex / (totalTokens - 1)) * 100)) : 0;
      if (barRef.current) {
        barRef.current.style.width = `${pct}%`;
      }
    }
  }, [mode, activeWordIndex, totalTokens]);

  // In speed mode: listen to scroll on container directly without re-rendering PrompterView
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mode !== 'speed') return;

    const handleScroll = () => {
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll > 0 && barRef.current) {
        const pct = Math.min(100, Math.max(0, (container.scrollTop / maxScroll) * 100));
        barRef.current.style.width = `${pct}%`;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerRef, mode]);

  return (
    <div className="fixed top-0 left-0 right-0 h-[2.5px] bg-white/10 z-50 overflow-hidden pointer-events-none">
      <div
        ref={barRef}
        className="h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)] transition-all duration-150 ease-out"
        style={{ width: '0%' }}
      />
    </div>
  );
};

export const PrompterView: React.FC<PrompterViewProps> = ({
  script,
  onUpdateScriptSettings,
  onExit,
  devices,
  selectedDeviceId,
  onSelectDevice,
  hasMicPermission,
  onRequestMicPermission,
  onPermissionGranted,
  hasDeepgram,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [show5minToast, setShow5minToast] = useState<boolean>(false);
  const [autoPausedToast, setAutoPausedToast] = useState<boolean>(false);
  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );
  const [forceLandscape, setForceLandscape] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useWakeLock(true);

  const cameraMode: CameraMode = script.settings.cameraMode || 'text';
  const isCameraActive = cameraMode === 'reels' || cameraMode === 'circle';
  const effectiveIsLandscape = isLandscape || (forceLandscape && !isCameraActive);
  const isMirroredLandscape = !isCameraActive && script.settings.isMirrored && effectiveIsLandscape;
  const ringLight = Boolean(script.settings.ringLight);
  const overlayOpacity = script.settings.cameraOverlayOpacity ?? 50;
  const countdownSeconds = script.settings.countdownSeconds ?? 3;

  // Monitor device orientation: portrait vs landscape
  useEffect(() => {
    let orientationTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    const handleOrientationChange = () => {
      handleResize();
      // Android WebView often updates innerWidth/innerHeight slightly after orientationchange fires
      if (orientationTimer) clearTimeout(orientationTimer);
      orientationTimer = setTimeout(handleResize, 150);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    window.Telegram?.WebApp?.onEvent?.('viewportChanged', handleResize);
    return () => {
      if (orientationTimer) clearTimeout(orientationTimer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.Telegram?.WebApp?.offEvent?.('viewportChanged', handleResize);
    };
  }, []);

  // Portrait mode: horizontal flip on inner wrapper (scaleX); Landscape mode: vertical flip on scroll viewport (scaleY)
  const mirrorContainerClass = useMemo(() => {
    if (isCameraActive || !script.settings.isMirrored) return '';
    return !effectiveIsLandscape ? 'prompter-mirrored-x' : '';
  }, [isCameraActive, script.settings.isMirrored, effectiveIsLandscape]);

  const mirrorViewportClass = useMemo(() => {
    return isMirroredLandscape ? 'prompter-mirrored-y' : '';
  }, [isMirroredLandscape]);

  // Ref for pauseRecording so handleReachEnd can call it without circular dependency
  const pauseRecordingRef = useRef<() => void>(() => {});
  const stopListeningRef = useRef<() => void>(() => {});
  const recordingStateRef = useRef<string>('idle');

  // Auto-pause when user finishes reading the script
  const handleReachEnd = useCallback(() => {
    stopListeningRef.current();
    setIsPlaying(false);
    setControlsVisible(true);

    if (recordingStateRef.current === 'recording') {
      pauseRecordingRef.current();
    }

    haptic.success();
    setAutoPausedToast(true);
    setTimeout(() => setAutoPausedToast(false), 4500);
  }, []);

  const {
    tokens,
    activeWordIndex,
    scrollToWord,
    handleSpokenWords,
    resetScroll,
    recomputeWordOffsets,
  } = usePrompterScroll({
    text: script.content,
    speed: script.settings.speed,
    mode: script.settings.mode,
    isPlaying,
    containerRef,
    fontSize: script.settings.fontSize,
    paddingX: script.settings.paddingX,
    onReachEnd: handleReachEnd,
  });

  // Recompute word offsets whenever cameraMode changes container layout
  useEffect(() => {
    const timer = setTimeout(() => {
      recomputeWordOffsets();
    }, 100);
    return () => clearTimeout(timer);
  }, [cameraMode, recomputeWordOffsets]);

  // Speech Recognition callbacks
  const onTranscript = useCallback(
    (event: SpeechTranscriptEvent) => {
      if (event.words && event.words.length > 0) {
        handleSpokenWords(event.words);
      }
    },
    [handleSpokenWords]
  );

  const onReady = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handleLimitExceeded = useCallback(() => {
    setIsPlaying(false);
    onUpdateScriptSettings({ mode: 'speed' });
  }, [onUpdateScriptSettings]);

  const handleWarning5min = useCallback(() => {
    setShow5minToast(true);
    setTimeout(() => setShow5minToast(false), 7000);
  }, []);

  // Start prompter playback helper (used both standalone and when camera recording starts/resumes)
  const startPrompterPlayback = useCallback(
    (startSpeechFn: () => void) => {
      if (script.settings.mode === 'speech') {
        startSpeechFn();
      } else {
        setIsPlaying(true);
      }
    },
    [script.settings.mode]
  );

  const pausePrompterPlayback = useCallback((stopSpeechFn: () => void) => {
    stopSpeechFn();
    setIsPlaying(false);
  }, []);

  const startSpeechRef = useRef<() => void>(() => {});

  // Camera Recorder hook
  const {
    videoRef,
    stream: cameraStream,
    cameraError,
    isCameraLoading,
    recordingState,
    countdownValue,
    elapsedSeconds,
    recordedBlob,
    recordedUrl,
    startCamera,
    startRecording,
    cancelCountdown,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
  } = useCameraRecorder({
    cameraMode,
    selectedAudioDeviceId: selectedDeviceId,
    countdownSeconds,
    onRecordingStarted: () => {
      startPrompterPlayback(startSpeechRef.current);
    },
    onRecordingPaused: () => {
      pausePrompterPlayback(stopListeningRef.current);
    },
    onRecordingResumed: () => {
      startPrompterPlayback(startSpeechRef.current);
    },
    onRecordingStopped: () => {
      pausePrompterPlayback(stopListeningRef.current);
      setControlsVisible(true);
    },
  });

  pauseRecordingRef.current = pauseRecording;
  recordingStateRef.current = recordingState;

  const {
    start: startListening,
    stop: stopListening,
    statusMessage: speechStatus,
    getAudioLevel,
    isConnecting,
  } = useSpeechRecognition({
    deviceId: selectedDeviceId,
    externalStream: cameraStream,
    onTranscript,
    onReady,
    onPermissionGranted,
    onLimitExceeded: handleLimitExceeded,
    onWarning5min: handleWarning5min,
  });

  startSpeechRef.current = startListening;
  stopListeningRef.current = stopListening;

  // Toggle Play / Pause (in text mode or rehearsal)
  const handleTogglePlay = useCallback(() => {
    if (script.settings.mode === 'speech') {
      if (isPlaying || isConnecting) {
        stopListening();
        setIsPlaying(false);
      } else {
        startListening();
      }
    } else {
      setIsPlaying((prev) => !prev);
    }
  }, [script.settings.mode, isPlaying, isConnecting, startListening, stopListening]);

  // Switch between 'text' | 'reels' | 'circle'
  const handleChangeCameraMode = useCallback(
    (nextMode: CameraMode) => {
      if (recordingState === 'recording' || recordingState === 'paused') return;
      haptic.selection();
      stopListening();
      setIsPlaying(false);
      onUpdateScriptSettings({ cameraMode: nextMode });
    },
    [recordingState, stopListening, onUpdateScriptSettings]
  );

  // Clean up listening when unmounting
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  // Request fullscreen & unlock orientation by default on enter
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const unlock = () => {
      try {
        if (tg && typeof tg.unlockOrientation === 'function') {
          tg.unlockOrientation();
        }
        screen.orientation?.unlock?.();
      } catch {
        // ignore
      }
    };

    try {
      if (tg && typeof tg.requestFullscreen === 'function') {
        tg.requestFullscreen();
      }
    } catch {
      // ignore
    }

    unlock();
    const t1 = setTimeout(unlock, 150);
    const t2 = setTimeout(unlock, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const handleExit = useCallback(() => {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    onExit();
  }, [onExit]);

  // Keyboard shortcuts (Space = Play/Pause, Esc = Exit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (isCameraActive) {
          if (recordingState === 'idle') startRecording();
          else if (recordingState === 'recording') pauseRecording();
          else if (recordingState === 'paused') resumeRecording();
        } else {
          handleTogglePlay();
        }
      } else if (e.code === 'Escape') {
        handleExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isCameraActive,
    recordingState,
    startRecording,
    pauseRecording,
    resumeRecording,
    handleTogglePlay,
    handleExit,
  ]);

  const handleCanvasClick = (e: React.MouseEvent) => {
    // If settings drawer is open, first tap closes it before any other interaction
    if (isSettingsOpen) {
      haptic.light();
      setIsSettingsOpen(false);
      return;
    }
    // If user clicked directly on a word token to jump to it, don't toggle panel
    if ((e.target as HTMLElement).closest('[data-word-index]')) {
      return;
    }
    if (!window.Telegram?.WebApp?.initData && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    haptic.light();
    setControlsVisible((prev) => !prev);
  };

  const handleReset = () => {
    stopListening();
    setIsPlaying(false);
    resetScroll();
  };

  const handleRetake = () => {
    discardRecording();
    handleReset();
  };

  // Render token spans helper (shared across Text, Reels, and Circle layouts)
  const renderScriptTokens = () =>
    tokens.map((token) => {
      const isSpoken = script.settings.mode === 'speech' && token.index < activeWordIndex;

      return (
        <React.Fragment key={token.index}>
          <span
            data-word-index={token.index}
            onPointerDown={() => haptic.selection()}
            className={`inline-block mr-[0.25em] align-middle cursor-pointer transition-colors duration-150 ${
              isSpoken ? 'text-neutral-400/45' : 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              if (isSettingsOpen) {
                haptic.light();
                setIsSettingsOpen(false);
                return;
              }
              scrollToWord(token.index);
            }}
          >
            {token.raw}
          </span>
          {token.hasDoubleNewline && <div className="h-5 w-full" />}
          {token.hasNewline && !token.hasDoubleNewline && <br />}
        </React.Fragment>
      );
    });

  // Circle 60s progress math
  const circleRadius = 146;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circleProgressRatio = Math.min(1, elapsedSeconds / 60);
  const circleDashOffset = circleCircumference * (1 - circleProgressRatio);

  const isForcedCssLandscape = forceLandscape && !isLandscape && !isCameraActive;

  return (
    <div
      className={`fixed select-none overflow-hidden flex flex-col transition-colors duration-300 ${
        isForcedCssLandscape ? '' : 'inset-0'
      } ${
        cameraMode === 'circle' && ringLight
          ? 'bg-[#FFF8EB] text-white'
          : 'bg-black text-white'
      }`}
      style={
        isForcedCssLandscape
          ? {
              width: '100vh',
              height: '100vw',
              top: 0,
              left: '100vw',
              transform: 'rotate(90deg)',
              transformOrigin: 'top left',
            }
          : undefined
      }
      onClick={handleCanvasClick}
    >
      {/* Top Reading Progress Bar with Apple Glow */}
      <ReadingProgressBar
        containerRef={containerRef}
        mode={script.settings.mode}
        activeWordIndex={activeWordIndex}
        totalTokens={tokens.length}
      />

      {/* ==================== MODE 1: CLASSIC FULLSCREEN TEXT ==================== */}
      {cameraMode === 'text' && (
        <>
          {/* Top Soft Vignette for seamless fade-in */}
          <div className="pointer-events-none fixed top-0 left-0 right-0 h-28 bg-gradient-to-b from-black via-black/80 to-transparent z-20" />

          {/* Apple HIG Eye Contact Horizon Line (20% optical reading level) */}
          <div
            className="pointer-events-none fixed left-0 right-0 z-20 flex items-center justify-between px-6 transition-opacity duration-300"
            style={isMirroredLandscape ? { bottom: '20%' } : { top: '20%' }}
          >
            <div className="flex items-center gap-1.5 opacity-30">
              <div className="w-5 h-[1.5px] bg-gradient-to-r from-transparent to-white rounded-full" />
              <div className="w-1.5 h-1.5 rounded-full border border-white/60" />
            </div>
            <div className="flex items-center gap-1.5 opacity-30">
              <div className="w-1.5 h-1.5 rounded-full border border-white/60" />
              <div className="w-5 h-[1.5px] bg-gradient-to-l from-transparent to-white rounded-full" />
            </div>
          </div>

          {/* Main Text Scroll Area */}
          <div
            ref={containerRef}
            className={`relative flex-1 w-full overflow-y-scroll overflow-x-hidden hide-scrollbar ${mirrorViewportClass}`}
          >
            <div className={`w-full min-h-full transition-transform duration-200 ${mirrorContainerClass}`}>
              <div style={{ height: 'max(20vh, calc(var(--safe-area-top) + 12vh))' }} />

              <div
                className="w-full mx-auto py-4 font-normal tracking-wide box-border"
                style={{
                  paddingLeft: `${Math.max(2, Math.min(32, script.settings.paddingX))}%`,
                  paddingRight: `${Math.max(2, Math.min(32, script.settings.paddingX))}%`,
                  fontSize: `${script.settings.fontSize}px`,
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                }}
              >
                {renderScriptTokens()}
              </div>

              <div style={{ height: '70vh' }} />
            </div>
          </div>

          {/* Bottom Cinematic Gradient Vignette */}
          <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-black via-black/80 to-transparent z-30" />
        </>
      )}

      {/* ==================== MODE 2: 9:16 REELS / SHORTS CAMERA ==================== */}
      {cameraMode === 'reels' && (
        <div className="relative flex-1 w-full h-full overflow-hidden">
          {/* Hardware-accelerated Fullscreen Front Camera Video */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="fixed inset-0 w-full h-full object-cover scale-x-[-1] z-0 pointer-events-none"
          />

          {/* Screen Ring Light Frame (when enabled) */}
          {ringLight && (
            <div className="fixed inset-0 z-30 pointer-events-none border-[18px] sm:border-[26px] border-[#FFF8EB] shadow-[inset_0_0_70px_rgba(255,248,235,0.9)] transition-all duration-300" />
          )}

          {/* Soft Top Semi-Transparent Dark Gradient Prompter (Right under front camera lens) */}
          <div
            className="fixed top-0 left-0 right-0 z-20 transition-all duration-200"
            style={{
              height: '44vh',
              background: `linear-gradient(to bottom, rgba(0, 0, 0, ${Math.min(0.9, (overlayOpacity / 100) * 1.15)}) 0%, rgba(0, 0, 0, ${(overlayOpacity / 100) * 0.72}) 55%, rgba(0, 0, 0, 0) 100%)`,
            }}
          >
            {/* Subtle Focal Reading Horizon (30% from top - directly under camera lens) */}
            <div
              className="pointer-events-none absolute left-0 right-0 z-20 flex items-center justify-between px-5 opacity-35"
              style={{ top: '30%' }}
            >
              <div className="w-3.5 h-[1.5px] bg-white rounded-full" />
              <div className="w-3.5 h-[1.5px] bg-white rounded-full" />
            </div>

            <div
              ref={containerRef}
              className="relative w-full h-full overflow-y-scroll overflow-x-hidden hide-scrollbar"
              style={{
                maskImage:
                  'linear-gradient(to bottom, transparent 0%, black 14%, black 75%, transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, transparent 0%, black 14%, black 75%, transparent 100%)',
              }}
            >
              <div style={{ height: 'max(10vh, calc(var(--safe-area-top) + 3.5vh))' }} />
              <div
                className="w-full max-w-lg mx-auto py-1 font-medium tracking-wide box-border"
                style={{
                  paddingLeft: `${Math.max(5, Math.min(28, script.settings.paddingX))}%`,
                  paddingRight: `${Math.max(5, Math.min(28, script.settings.paddingX))}%`,
                  fontSize: `${Math.min(44, Math.max(20, script.settings.fontSize))}px`,
                  lineHeight: 1.38,
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                }}
              >
                {renderScriptTokens()}
              </div>
              <div style={{ height: '30vh' }} />
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODE 3: 1:1 TELEGRAM CIRCLE (VIDEO NOTE) ==================== */}
      {cameraMode === 'circle' && (
        <div className="relative flex-1 w-full h-full flex flex-col items-center justify-start overflow-hidden">
          {/* Soft Top Semi-Transparent Gradient Prompter (Right under front camera lens, above circle) */}
          <div
            className="w-full z-20 shrink-0 relative transition-all duration-200"
            style={{
              height: '32vh',
              minHeight: '175px',
              maxHeight: '245px',
              background: ringLight
                ? 'linear-gradient(to bottom, rgba(0, 0, 0, 0.82) 0%, rgba(0, 0, 0, 0.56) 65%, rgba(0, 0, 0, 0) 100%)'
                : `linear-gradient(to bottom, rgba(0, 0, 0, ${Math.min(0.9, (overlayOpacity / 100) * 1.15)}) 0%, rgba(0, 0, 0, ${(overlayOpacity / 100) * 0.7}) 62%, rgba(0, 0, 0, 0) 100%)`,
            }}
          >
            {/* Focal Reading Horizon (30% from top - right under camera lens) */}
            <div
              className="pointer-events-none absolute left-0 right-0 z-20 flex items-center justify-between px-5 opacity-35"
              style={{ top: '30%' }}
            >
              <div className="w-3.5 h-[1.5px] bg-white rounded-full" />
              <div className="w-3.5 h-[1.5px] bg-white rounded-full" />
            </div>

            <div
              ref={containerRef}
              className="relative w-full h-full overflow-y-scroll overflow-x-hidden hide-scrollbar"
              style={{
                maskImage:
                  'linear-gradient(to bottom, transparent 0%, black 15%, black 76%, transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, transparent 0%, black 15%, black 76%, transparent 100%)',
              }}
            >
              <div style={{ height: 'max(7vh, calc(var(--safe-area-top) + 2vh))' }} />
              <div
                className="w-full max-w-md mx-auto py-1 font-medium tracking-wide box-border"
                style={{
                  paddingLeft: `${Math.max(5, Math.min(25, script.settings.paddingX))}%`,
                  paddingRight: `${Math.max(5, Math.min(25, script.settings.paddingX))}%`,
                  fontSize: `${Math.min(38, Math.max(20, script.settings.fontSize))}px`,
                  lineHeight: 1.35,
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                }}
              >
                {renderScriptTokens()}
              </div>
              <div style={{ height: '21vh' }} />
            </div>
          </div>

          {/* 1:1 Circular Viewfinder with 60s Progress Ring */}
          <div className="relative mt-2 sm:mt-3 flex items-center justify-center">
            <div className="relative w-[70vw] h-[70vw] max-w-[296px] max-h-[296px] flex items-center justify-center">
              {/* Circular Video Mask */}
              <div
                className={`w-full h-full rounded-full overflow-hidden bg-neutral-900 relative z-10 ${
                  ringLight
                    ? 'shadow-[0_0_60px_rgba(255,248,235,0.95),0_20px_50px_rgba(0,0,0,0.45)] ring-4 ring-white'
                    : 'shadow-[0_24px_60px_rgba(0,0,0,0.85)] ring-2 ring-white/20'
                }`}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
              </div>

              {/* SVG 60-Second Progress Ring around the Circle */}
              <svg
                className="absolute -inset-2.5 w-[calc(100%+20px)] h-[calc(100%+20px)] -rotate-90 pointer-events-none z-20"
                viewBox="0 0 312 312"
              >
                <circle
                  cx="156"
                  cy="156"
                  r={circleRadius}
                  fill="none"
                  stroke={ringLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'}
                  strokeWidth="4"
                />
                {(recordingState === 'recording' || recordingState === 'paused') && (
                  <circle
                    cx="156"
                    cy="156"
                    r={circleRadius}
                    fill="none"
                    stroke={
                      elapsedSeconds >= 50
                        ? '#F59E0B'
                        : recordingState === 'paused'
                        ? '#FBBF24'
                        : '#FF3B30'
                    }
                    strokeWidth="4.5"
                    strokeLinecap="round"
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={circleDashOffset}
                    className="transition-all duration-500 ease-linear"
                  />
                )}
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Camera Error / Loading Overlay */}
      {isCameraActive && (cameraError || isCameraLoading) && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-6 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {cameraError ? (
            <div className="max-w-xs rounded-[28px] bg-neutral-900/95 backdrop-blur-2xl border border-white/15 p-5 text-center space-y-3 shadow-2xl">
              <div className="w-11 h-11 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center mx-auto">
                <VideoOff className="w-5 h-5" />
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed">{cameraError}</p>
              <button
                onPointerDown={() => haptic.light()}
                onClick={startCamera}
                className="w-full py-2.5 rounded-2xl bg-white text-black font-semibold text-xs flex items-center justify-center gap-1.5 apple-press"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Повторить подключение</span>
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* 3-2-1 Countdown Overlay */}
      {recordingState === 'countdown' && (
        <div
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[4px] flex flex-col items-center justify-center pointer-events-auto"
          onClick={(e) => {
            e.stopPropagation();
            cancelCountdown();
          }}
        >
          <div
            key={countdownValue}
            className="w-28 h-28 rounded-full bg-neutral-900/80 backdrop-blur-2xl border border-white/20 flex items-center justify-center shadow-[0_24px_60px_rgba(0,0,0,0.7)] animate-sheet-up"
          >
            <span className="text-6xl font-bold tracking-tight text-white">{countdownValue}</span>
          </div>
          <span className="mt-3 text-xs font-medium text-white/80 bg-black/50 px-3 py-1 rounded-full backdrop-blur-md">
            Нажмите на экран для отмены
          </span>
        </div>
      )}

      {/* Auto-Paused at End of Script Toast */}
      {autoPausedToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-sheet-up">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-neutral-900/95 border border-white/20 text-white font-medium text-xs shadow-[0_12px_32px_rgba(0,0,0,0.7)]">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Пауза: сценарий прочитан до конца</span>
          </div>
        </div>
      )}

      {/* 5-minute Warning Toast Banner */}
      {show5minToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-500/95 text-black font-semibold text-xs shadow-[0_8px_24px_rgba(245,158,11,0.4)]">
            <AlertCircle className="w-4 h-4 shrink-0 stroke-[2.5]" />
            <span>Осталось менее 5 минут голосового режима</span>
          </div>
        </div>
      )}

      {/* Floating Liquid Glass Navigation */}
      <PrompterControls
        settings={script.settings}
        onUpdateSettings={onUpdateScriptSettings}
        isPlaying={isPlaying}
        isConnecting={isConnecting}
        isCollapsed={!controlsVisible}
        isExpanded={isSettingsOpen}
        onExpandedChange={setIsSettingsOpen}
        onTogglePlay={handleTogglePlay}
        onReset={handleReset}
        onExit={handleExit}
        onToggleCollapse={() => setControlsVisible((prev) => !prev)}
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={onSelectDevice}
        hasMicPermission={hasMicPermission}
        onRequestMicPermission={onRequestMicPermission}
        getAudioLevel={getAudioLevel}
        speechStatus={speechStatus}
        hasDeepgram={hasDeepgram}
        cameraMode={cameraMode}
        onChangeCameraMode={handleChangeCameraMode}
        recordingState={recordingState}
        elapsedSeconds={elapsedSeconds}
        onStartRecording={startRecording}
        onPauseRecording={pauseRecording}
        onResumeRecording={resumeRecording}
        onStopRecording={stopRecording}
        onCancelCountdown={cancelCountdown}
        forceLandscape={forceLandscape}
        onToggleForceLandscape={() => setForceLandscape((prev) => !prev)}
      />

      {/* Camera Review & Export Modal */}
      {recordingState === 'review' && recordedBlob && recordedUrl && isCameraActive && (
        <CameraReviewModal
          videoBlob={recordedBlob}
          videoUrl={recordedUrl}
          mode={cameraMode === 'circle' ? 'circle' : 'reels'}
          durationSeconds={elapsedSeconds}
          scriptTitle={script.title}
          initialMirrorOutput={script.settings.mirrorOutputVideo ?? true}
          onToggleMirrorOutput={(mirror) => onUpdateScriptSettings({ mirrorOutputVideo: mirror })}
          onRetake={handleRetake}
          onClose={discardRecording}
        />
      )}
    </div>
  );
};
