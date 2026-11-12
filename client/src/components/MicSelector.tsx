import React, { useRef, useEffect } from 'react';
import { Mic, AlertCircle } from 'lucide-react';
import { AudioDevice } from '../types';
import { haptic } from '../utils/haptics';

interface MicSelectorProps {
  devices: AudioDevice[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  hasPermission: boolean;
  onRequestPermission: () => void;
  getAudioLevel?: () => number;
  audioLevel?: number;
  error?: string | null;
}

export const MicSelector: React.FC<MicSelectorProps> = ({
  devices,
  selectedDeviceId,
  onSelectDevice,
  hasPermission,
  onRequestPermission,
  getAudioLevel,
  audioLevel = 0,
  error,
}) => {
  // Only unlocked if permission is truly granted AND devices have actual non-empty labels
  const isUnlocked = hasPermission && devices.length > 0 && devices.some((d) => Boolean(d.label && d.label.trim().length > 0));

  const bar1Ref = useRef<HTMLDivElement>(null);
  const bar2Ref = useRef<HTMLDivElement>(null);
  const bar3Ref = useRef<HTMLDivElement>(null);

  // Directly animate equalizer DOM nodes without triggering parent React re-renders
  useEffect(() => {
    if (!isUnlocked || !getAudioLevel) return;

    let animId: number;
    const updateBars = () => {
      const lvl = getAudioLevel();
      const b1 = bar1Ref.current;
      const b2 = bar2Ref.current;
      const b3 = bar3Ref.current;

      if (b1 && b2 && b3) {
        const isActive = lvl > 10;
        b1.style.height = `${Math.max(3, Math.min(14, (lvl / 100) * 14))}px`;
        b2.style.height = `${Math.max(3, Math.min(14, (lvl / 100) * 18 * 0.85))}px`;
        b3.style.height = `${Math.max(3, Math.min(14, (lvl / 100) * 12 * 0.9))}px`;

        if (isActive) {
          b1.className = 'w-[2.5px] rounded-full transition-all duration-75 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]';
          b2.className = 'w-[2.5px] rounded-full transition-all duration-75 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]';
          b3.className = 'w-[2.5px] rounded-full transition-all duration-75 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]';
        } else {
          b1.className = 'w-[2.5px] rounded-full transition-all duration-75 bg-neutral-600';
          b2.className = 'w-[2.5px] rounded-full transition-all duration-75 bg-neutral-600';
          b3.className = 'w-[2.5px] rounded-full transition-all duration-75 bg-neutral-600';
        }
      }
      animId = requestAnimationFrame(updateBars);
    };

    animId = requestAnimationFrame(updateBars);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isUnlocked, getAudioLevel]);

  if (!isUnlocked) {
    return (
      <div className="flex items-center gap-2">
        <button
          onPointerDown={() => haptic.light()}
          onClick={onRequestPermission}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-medium tracking-wide apple-press transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
        >
          <Mic className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>Разрешить микрофон</span>
        </button>
        {error && (
          <span className="text-xs text-red-400 flex items-center gap-1" title={error}>
            <AlertCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-xs shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
      <Mic className="w-3.5 h-3.5 text-neutral-300 shrink-0" />

      {/* Live Voice Activity Equalizer Bars */}
      <div className="flex items-end gap-[2px] h-3.5 px-0.5" title="Уровень голоса">
        <div
          ref={bar1Ref}
          className={`w-[2.5px] rounded-full transition-all duration-75 ${
            audioLevel > 10 ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-neutral-600'
          }`}
          style={{ height: `${Math.max(3, Math.min(14, (audioLevel / 100) * 14))}px` }}
        />
        <div
          ref={bar2Ref}
          className={`w-[2.5px] rounded-full transition-all duration-75 ${
            audioLevel > 10 ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-neutral-600'
          }`}
          style={{ height: `${Math.max(3, Math.min(14, (audioLevel / 100) * 18 * 0.85))}px` }}
        />
        <div
          ref={bar3Ref}
          className={`w-[2.5px] rounded-full transition-all duration-75 ${
            audioLevel > 10 ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-neutral-600'
          }`}
          style={{ height: `${Math.max(3, Math.min(14, (audioLevel / 100) * 12 * 0.9))}px` }}
        />
      </div>

      <select
        value={selectedDeviceId}
        onChange={(e) => {
          haptic.selection();
          onSelectDevice(e.target.value);
        }}
        className="bg-transparent text-neutral-200 text-xs outline-none cursor-pointer max-w-[170px] truncate hover:text-white transition-colors"
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId} className="bg-neutral-900 text-neutral-200">
            {device.label || `Микрофон (${device.deviceId.slice(0, 5)}...)`}
          </option>
        ))}
      </select>
    </div>
  );
};
