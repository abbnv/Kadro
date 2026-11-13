import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  FlipHorizontal,
  Type,
  Gauge,
  SlidersHorizontal,
  Home,
  ChevronRight,
  AudioLines,
  Loader2,
  Sun,
  Square,
  Timer,
  Eye,
  X,
  FileText,
  Smartphone,
  CircleDot,
  RotateCw,
  Gamepad2,
} from 'lucide-react';
import { ScriptSettings, AudioDevice, CameraMode } from '../types';
import { RecordingState } from '../hooks/useCameraRecorder';
import { MicSelector } from './MicSelector';
import { haptic } from '../utils/haptics';

interface PrompterControlsProps {
  settings: ScriptSettings;
  onUpdateSettings: (settings: Partial<ScriptSettings>) => void;
  isPlaying: boolean;
  isConnecting?: boolean;
  isCollapsed: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  onExit: () => void;
  onToggleCollapse: () => void;
  devices: AudioDevice[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  hasMicPermission: boolean;
  onRequestMicPermission: () => void;
  getAudioLevel?: () => number;
  audioLevel?: number;
  speechStatus?: string;
  hasDeepgram: boolean;
  // Camera & Recording props
  cameraMode: CameraMode;
  onChangeCameraMode: (mode: CameraMode) => void;
  recordingState: RecordingState;
  elapsedSeconds?: number;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStopRecording: () => void;
  onCancelCountdown: () => void;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  forceLandscape?: boolean;
  onToggleForceLandscape?: () => void;
  onOpenRemoteSettings?: () => void;
  connectedGamepadName?: string | null;
}

export const PrompterControls: React.FC<PrompterControlsProps> = ({
  settings,
  onUpdateSettings,
  isPlaying,
  isConnecting,
  isCollapsed,
  onTogglePlay,
  onReset,
  onExit,
  onToggleCollapse,
  devices,
  selectedDeviceId,
  onSelectDevice,
  hasMicPermission,
  onRequestMicPermission,
  getAudioLevel,
  audioLevel = 0,
  speechStatus,
  hasDeepgram,
  cameraMode,
  onChangeCameraMode,
  recordingState,
  elapsedSeconds = 0,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  onCancelCountdown,
  isExpanded,
  onExpandedChange,
  forceLandscape = false,
  onToggleForceLandscape,
  onOpenRemoteSettings,
  connectedGamepadName,
}) => {

  const isCameraActive = cameraMode === 'reels' || cameraMode === 'circle';
  const isRecordingOrPaused = recordingState === 'recording' || recordingState === 'paused';
  const countdownSeconds = settings.countdownSeconds ?? 3;
  const overlayOpacity = settings.cameraOverlayOpacity ?? 50;

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleCycleCameraMode = () => {
    if (isRecordingOrPaused) return;
    haptic.selection();
    const order: CameraMode[] = ['text', 'reels', 'circle'];
    const nextIdx = (order.indexOf(cameraMode) + 1) % order.length;
    onChangeCameraMode(order[nextIdx]);
  };

  const handleCollapse = () => {
    haptic.light();
    onExpandedChange(false);
    onToggleCollapse();
  };

  const handlePlayToggle = () => {
    haptic.medium();
    onTogglePlay();
  };

  const handleResetClick = () => {
    haptic.success();
    onReset();
  };

  const handleExitClick = () => {
    haptic.light();
    onExit();
  };

  return (
    <>
      {/* 1. Collapsed Mode: Sleek Circular Button docked on the Right with Glide Animation */}
      {isCollapsed && (
        <div
          className="fixed bottom-safe-nav right-4 md:right-8 z-50 pointer-events-auto animate-slide-to-right"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onPointerDown={() => haptic.light()}
            onClick={onToggleCollapse}
            className="w-14 h-14 rounded-full bg-neutral-900/85 backdrop-blur-2xl border border-white/15 shadow-[0_16px_36px_rgba(0,0,0,0.65),inset_0_1px_1px_rgba(255,255,255,0.22)] flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 apple-press transition-colors relative"
            title="Развернуть управление"
          >
            <SlidersHorizontal className="w-5 h-5 stroke-[2]" />
            {recordingState === 'recording' && (
              <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-[#FF3B30] animate-ping" />
            )}
            {recordingState === 'recording' && (
              <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-[#FF3B30]" />
            )}
            {recordingState === 'paused' && (
              <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-amber-400" />
            )}
          </button>
        </div>
      )}

      {/* 2. Expanded Mode: Centered Liquid Glass Pill + Settings Card */}
      {!isCollapsed && (
        <div
          className="fixed bottom-safe-nav left-1/2 -translate-x-1/2 z-50 flex flex-col items-center select-none pointer-events-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Floating Liquid Glass Settings Panel (card above pill when open) */}
          {isExpanded && (
            <div className="w-[92vw] max-w-md mb-3 rounded-[28px] p-5 bg-neutral-900/90 backdrop-blur-3xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.25)] space-y-4 text-xs text-neutral-200 pointer-events-auto animate-sheet-up">
              {/* Camera / View Mode Switcher (Icon-only) */}
              <div className="flex items-center justify-between">
                <span className="text-neutral-400 font-medium">Формат</span>
                <div className="flex items-center gap-1 bg-black/50 p-1 rounded-full border border-white/10 shadow-inner">
                  <button
                    onPointerDown={() => haptic.selection()}
                    onClick={() => onChangeCameraMode('text')}
                    disabled={isRecordingOrPaused}
                    title="Текст"
                    className={`w-9 h-8 rounded-full flex items-center justify-center apple-press-subtle transition-all duration-200 disabled:opacity-40 ${
                      cameraMode === 'text'
                        ? 'bg-white text-black shadow-[0_2px_8px_rgba(255,255,255,0.25)]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <FileText className="w-4 h-4 stroke-[2]" />
                  </button>
                  <button
                    onPointerDown={() => haptic.selection()}
                    onClick={() => onChangeCameraMode('reels')}
                    disabled={isRecordingOrPaused}
                    title="Видео 9:16"
                    className={`w-9 h-8 rounded-full flex items-center justify-center apple-press-subtle transition-all duration-200 disabled:opacity-40 ${
                      cameraMode === 'reels'
                        ? 'bg-white text-black shadow-[0_2px_8px_rgba(255,255,255,0.25)]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 stroke-[2]" />
                  </button>
                  <button
                    onPointerDown={() => haptic.selection()}
                    onClick={() => onChangeCameraMode('circle')}
                    disabled={isRecordingOrPaused}
                    title="Кружок 1:1"
                    className={`w-9 h-8 rounded-full flex items-center justify-center apple-press-subtle transition-all duration-200 disabled:opacity-40 ${
                      cameraMode === 'circle'
                        ? 'bg-white text-black shadow-[0_2px_8px_rgba(255,255,255,0.25)]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <CircleDot className="w-4 h-4 stroke-[2]" />
                  </button>
                </div>
              </div>

              {/* Mode Switch: Speed vs Speech */}
              <div className="flex items-center justify-between">
                <span className="text-neutral-400 font-medium">Режим скролла</span>
                <div className="flex bg-black/50 p-1 rounded-full border border-white/10 shadow-inner">
                  <button
                    onPointerDown={() => haptic.selection()}
                    onClick={() => onUpdateSettings({ mode: 'speed' })}
                    className={`px-3.5 py-1.5 rounded-full apple-press-subtle transition-all duration-200 ${
                      settings.mode === 'speed'
                        ? 'bg-white text-black font-semibold shadow-[0_2px_8px_rgba(255,255,255,0.25)]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    По скорости
                  </button>
                  <button
                    onPointerDown={() => haptic.selection()}
                    onClick={() => {
                      onUpdateSettings({ mode: 'speech' });
                    }}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full apple-press-subtle transition-all duration-200 ${
                      settings.mode === 'speech'
                        ? 'bg-white text-black font-semibold shadow-[0_2px_8px_rgba(255,255,255,0.25)]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                    title={!hasDeepgram ? 'Распознавание речи временно недоступно' : ''}
                  >
                    <AudioLines className="w-3.5 h-3.5 stroke-[2]" />
                    <span>По голосу</span>
                  </button>
                </div>
              </div>

              {/* Microphone Selector (visible in speech mode) */}
              {settings.mode === 'speech' && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-neutral-400 font-medium">Микрофон</span>
                  <MicSelector
                    devices={devices}
                    selectedDeviceId={selectedDeviceId}
                    onSelectDevice={onSelectDevice}
                    hasPermission={hasMicPermission}
                    onRequestPermission={onRequestMicPermission}
                    getAudioLevel={getAudioLevel}
                    audioLevel={audioLevel}
                  />
                </div>
              )}

              {/* Font Size */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-neutral-400 w-28 shrink-0">
                  <Type className="w-4 h-4 stroke-[1.8]" />
                  <span>Шрифт: {settings.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="72"
                  step="2"
                  value={settings.fontSize}
                  onChange={(e) => {
                    haptic.selection();
                    onUpdateSettings({ fontSize: Number(e.target.value) });
                  }}
                  className="w-full"
                />
              </div>

              {/* Speed (active in speed mode) */}
              {settings.mode === 'speed' && (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-neutral-400 w-28 shrink-0">
                    <Gauge className="w-4 h-4 stroke-[1.8]" />
                    <span>Скорость: {settings.speed}</span>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="180"
                    step="5"
                    value={settings.speed}
                    onChange={(e) => {
                      haptic.selection();
                      onUpdateSettings({ speed: Number(e.target.value) });
                    }}
                    className="w-full"
                  />
                </div>
              )}

              {/* Margins / Screen Padding */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-neutral-400 w-28 shrink-0">
                  <SlidersHorizontal className="w-4 h-4 stroke-[1.8]" />
                  <span>Поля: {settings.paddingX}%</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="32"
                  step="1"
                  value={settings.paddingX}
                  onChange={(e) => {
                    haptic.selection();
                    onUpdateSettings({ paddingX: Number(e.target.value) });
                  }}
                  className="w-full"
                />
              </div>

              {/* Manual Landscape Rotation & Bluetooth Remote Settings */}
              <div className="pt-2 border-t border-white/10 flex items-center gap-2">
                {!isCameraActive && onToggleForceLandscape && (
                  <button
                    onPointerDown={() => haptic.light()}
                    onClick={() => {
                      haptic.light();
                      onToggleForceLandscape();
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl border apple-press-subtle transition-all ${
                      forceLandscape
                        ? 'bg-white/15 border-white/25 text-white font-medium'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <RotateCw className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Экран 90°</span>
                  </button>
                )}

                {onOpenRemoteSettings && (
                  <button
                    onPointerDown={() => haptic.light()}
                    onClick={() => {
                      haptic.light();
                      onOpenRemoteSettings();
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl border apple-press-subtle transition-all ${
                      connectedGamepadName
                        ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300 font-medium'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {connectedGamepadName ? 'Пульт (вкл.)' : 'Пульт / Джойстик'}
                    </span>
                  </button>
                )}
              </div>

              {/* Camera-specific settings when in Reels or Circle mode */}
              {isCameraActive && (
                <div className="pt-2 border-t border-white/10 space-y-3.5">
                  {/* Overlay Background Opacity */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-neutral-400 w-28 shrink-0">
                      <Eye className="w-4 h-4 stroke-[1.8]" />
                      <span>Фон текста: {overlayOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="85"
                      step="5"
                      value={overlayOpacity}
                      onChange={(e) => {
                        haptic.selection();
                        onUpdateSettings({ cameraOverlayOpacity: Number(e.target.value) });
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Pre-roll Countdown & Mirror Video Toggles */}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onPointerDown={() => haptic.light()}
                      onClick={() =>
                        onUpdateSettings({
                          countdownSeconds: countdownSeconds === 3 ? 0 : 3,
                        })
                      }
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-2xl border apple-press-subtle transition-all ${
                        countdownSeconds === 3
                          ? 'bg-white/15 border-white/25 text-white font-medium'
                          : 'bg-white/5 border-white/10 text-neutral-400'
                      }`}
                    >
                      <Timer className="w-3.5 h-3.5" />
                      <span>Отсчёт: {countdownSeconds === 3 ? '3 сек' : 'Выкл'}</span>
                    </button>

                    <button
                      onPointerDown={() => haptic.light()}
                      onClick={() =>
                        onUpdateSettings({
                          ringLight: !settings.ringLight,
                        })
                      }
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-2xl border apple-press-subtle transition-all ${
                        settings.ringLight
                          ? 'bg-[#FFF5E1] border-white text-black font-semibold shadow-[0_0_16px_rgba(255,245,225,0.4)]'
                          : 'bg-white/5 border-white/10 text-neutral-400'
                      }`}
                    >
                      <Sun className="w-3.5 h-3.5" />
                      <span>Свет: {settings.ringLight ? 'Вкл' : 'Выкл'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Status info */}
              {speechStatus && (
                <div className="text-[11px] text-neutral-400 text-center pt-1 truncate">
                  {speechStatus}
                </div>
              )}
            </div>
          )}

          {/* Subtle Recording Timer Badge right above the bottom pill */}
          {isRecordingOrPaused && !isExpanded && (
            <div className="mb-2.5 flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900/85 backdrop-blur-2xl border border-white/15 shadow-lg pointer-events-auto animate-sheet-up">
              <span
                className={`w-2 h-2 rounded-full ${
                  recordingState === 'recording'
                    ? 'bg-[#FF3B30] animate-pulse shadow-[0_0_8px_#FF3B30]'
                    : 'bg-amber-400'
                }`}
              />
              <span className="text-[11px] font-mono font-semibold tracking-wider text-white">
                {formatTimer(elapsedSeconds)}
                {cameraMode === 'circle' ? ' / 01:00' : ''}
              </span>
            </div>
          )}

          {/* Centered Liquid Glass Navigation Pill (Comfortable 64px Size) */}
          <div className="h-[64px] flex items-center gap-1.5 sm:gap-2 px-3 rounded-full bg-neutral-900/85 backdrop-blur-2xl border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.22)] pointer-events-auto animate-nav-enter transition-all">
            {/* 1. Home Button (Back to scripts) */}
            {!isRecordingOrPaused && (
              <button
                onPointerDown={() => haptic.light()}
                onClick={handleExitClick}
                className="w-11 h-11 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 apple-press transition-colors"
                title="На главную"
              >
                <Home className="w-5 h-5 stroke-[2]" />
              </button>
            )}

            {/* 2. Rewind Text Button */}
            <button
              onPointerDown={() => haptic.success()}
              onClick={handleResetClick}
              className="w-11 h-11 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 apple-press transition-colors"
              title="Текст в начало"
            >
              <RotateCcw className="w-5 h-5 stroke-[2]" />
            </button>

            {/* 3. Built-in Mode Switcher Button (Cycles: Text -> 9:16 -> 1:1 Circle) */}
            {!isRecordingOrPaused && (
              <button
                onPointerDown={() => haptic.selection()}
                onClick={handleCycleCameraMode}
                className={`relative w-11 h-11 rounded-full flex items-center justify-center apple-press transition-all duration-200 ${
                  isCameraActive
                    ? 'text-white bg-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25)]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/10'
                }`}
                title="Переключить режим (Текст / 9:16 / Кружок 1:1)"
              >
                {cameraMode === 'text' && <FileText className="w-5 h-5 stroke-[2]" />}
                {cameraMode === 'reels' && <Smartphone className="w-5 h-5 stroke-[2]" />}
                {cameraMode === 'circle' && <CircleDot className="w-5 h-5 stroke-[2]" />}
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5 pointer-events-none">
                  <span
                    className={`w-1 h-1 rounded-full ${
                      cameraMode === 'text' ? 'bg-white' : 'bg-white/30'
                    }`}
                  />
                  <span
                    className={`w-1 h-1 rounded-full ${
                      cameraMode === 'reels' ? 'bg-white' : 'bg-white/30'
                    }`}
                  />
                  <span
                    className={`w-1 h-1 rounded-full ${
                      cameraMode === 'circle' ? 'bg-white' : 'bg-white/30'
                    }`}
                  />
                </div>
              </button>
            )}

            {/* 3. Central Action Zone: Text Mode vs Camera Recording Mode */}
            {!isCameraActive ? (
              /* Classic Text Prompter Play / Pause */
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center p-1 transition-all duration-300 ${
                  isPlaying
                    ? 'bg-white/20 ring-4 ring-white/10 animate-halo-pulse shadow-[0_0_24px_rgba(255,255,255,0.25)]'
                    : 'bg-white/10 hover:bg-white/15'
                }`}
              >
                <button
                  onPointerDown={() => haptic.medium()}
                  onClick={handlePlayToggle}
                  disabled={isConnecting}
                  className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-[0_4px_16px_rgba(255,255,255,0.35)] apple-press transition-all duration-200 disabled:opacity-80"
                  title={isConnecting ? 'Подключение к распознаванию...' : isPlaying ? 'Пауза' : 'Старт'}
                >
                  {isConnecting ? (
                    <Loader2 className="w-5 h-5 animate-spin text-black stroke-[2.5]" />
                  ) : isPlaying ? (
                    <Pause className="w-5 h-5 fill-black stroke-none" />
                  ) : (
                    <Play className="w-5 h-5 fill-black stroke-none translate-x-0.5" />
                  )}
                </button>
              </div>
            ) : recordingState === 'idle' ? (
              /* Camera Idle: iOS Camera Record Shutter Button + Rehearsal Play Toggle */
              <div className="flex items-center gap-2">
                {/* iOS Shutter Record Button */}
                <button
                  onPointerDown={() => haptic.medium()}
                  onClick={onStartRecording}
                  disabled={isConnecting}
                  className="w-14 h-14 rounded-full border-[3px] border-white p-1 flex items-center justify-center shadow-[0_0_24px_rgba(255,59,48,0.35)] apple-press transition-all"
                  title="Начать запись видео и суфлёр"
                >
                  <div className="w-full h-full rounded-full bg-[#FF3B30] flex items-center justify-center">
                    {isConnecting && <Loader2 className="w-5 h-5 animate-spin text-white stroke-[2.5]" />}
                  </div>
                </button>
              </div>
            ) : recordingState === 'countdown' ? (
              /* Countdown Cancel Button */
              <button
                onPointerDown={() => haptic.light()}
                onClick={onCancelCountdown}
                className="w-14 h-14 rounded-full bg-white/15 border border-white/25 flex items-center justify-center text-white apple-press transition-all"
                title="Отменить отсчёт"
              >
                <X className="w-6 h-6 stroke-[2.5]" />
              </button>
            ) : (
              /* Recording or Paused: Pause/Resume Button + Finish (Stop) Button */
              <div className="flex items-center gap-2 px-1">
                {/* Pause / Resume Button */}
                <button
                  onPointerDown={() => haptic.medium()}
                  onClick={recordingState === 'recording' ? onPauseRecording : onResumeRecording}
                  className={`w-12 h-12 rounded-full flex items-center justify-center apple-press transition-all shadow-lg ${
                    recordingState === 'paused'
                      ? 'bg-white text-black ring-4 ring-white/20 shadow-[0_0_20px_rgba(255,255,255,0.4)]'
                      : 'bg-amber-400/90 text-black shadow-[0_0_16px_rgba(251,191,36,0.35)]'
                  }`}
                  title={recordingState === 'recording' ? 'Пауза записи и текста' : 'Продолжить запись'}
                >
                  {recordingState === 'recording' ? (
                    <Pause className="w-5 h-5 fill-black stroke-none" />
                  ) : (
                    <Play className="w-5 h-5 fill-black stroke-none translate-x-0.5" />
                  )}
                </button>

                {/* Finish / Stop Recording Button */}
                <button
                  onPointerDown={() => haptic.heavy()}
                  onClick={onStopRecording}
                  className="w-12 h-12 rounded-full border-2 border-white/80 p-1 flex items-center justify-center apple-press transition-all shadow-[0_0_20px_rgba(255,59,48,0.45)]"
                  title="Завершить запись и перейти к сохранению"
                >
                  <div className="w-full h-full rounded-full bg-[#FF3B30] flex items-center justify-center">
                    <Square className="w-4 h-4 fill-white stroke-none rounded-[2px]" />
                  </div>
                </button>
              </div>
            )}

            {/* 4. Secondary Quick Action: Mirror (in Text mode) OR Ring Light (in Camera mode) */}
            {!isCameraActive ? (
              <button
                onPointerDown={() => haptic.light()}
                onClick={() => {
                  haptic.light();
                  onUpdateSettings({ isMirrored: !settings.isMirrored });
                }}
                className={`w-11 h-11 rounded-full flex items-center justify-center apple-press transition-all duration-200 ${
                  settings.isMirrored
                    ? 'text-white bg-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/10'
                }`}
                title="Отзеркалить для оптического суфлера"
              >
                <FlipHorizontal className="w-5 h-5 stroke-[2]" />
              </button>
            ) : (
              <button
                onPointerDown={() => haptic.light()}
                onClick={() => {
                  haptic.light();
                  onUpdateSettings({ ringLight: !settings.ringLight });
                }}
                className={`w-11 h-11 rounded-full flex items-center justify-center apple-press transition-all duration-200 ${
                  settings.ringLight
                    ? 'text-black bg-[#FFF5E1] shadow-[0_0_18px_rgba(255,245,225,0.65)]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/10'
                }`}
                title="Кольцевая подсветка экраном (Ring Light)"
              >
                <Sun className="w-5 h-5 stroke-[2]" />
              </button>
            )}

            {/* 5. Settings Card Toggle */}
            <button
              onPointerDown={() => haptic.light()}
              onClick={() => {
                haptic.light();
                onExpandedChange(!isExpanded);
              }}
              className={`w-11 h-11 rounded-full flex items-center justify-center apple-press transition-all duration-200 ${
                isExpanded
                  ? 'text-white bg-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]'
                  : 'text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
              title="Настройки суфлера"
            >
              <SlidersHorizontal className="w-5 h-5 stroke-[2]" />
            </button>

            {/* 6. Collapse Button (Slides into right-aligned button) */}
            <button
              onPointerDown={() => haptic.light()}
              onClick={handleCollapse}
              className="w-11 h-11 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 apple-press transition-colors"
              title="Свернуть панель"
            >
              <ChevronRight className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
