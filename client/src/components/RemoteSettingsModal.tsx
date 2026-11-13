import React from 'react';
import { Gamepad2, RotateCcw, X, Trash2 } from 'lucide-react';
import {
  REMOTE_ACTION_META,
  RemoteAction,
  RemoteBindingsMap,
} from '../hooks/useRemoteControl';
import { haptic } from '../utils/haptics';

interface RemoteSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  bindings: RemoteBindingsMap;
  learningAction: RemoteAction | null;
  connectedGamepadName: string | null;
  onStartLearning: (action: RemoteAction) => void;
  onCancelLearning: () => void;
  onClearBinding: (action: RemoteAction) => void;
  onResetBindings: () => void;
}

export const RemoteSettingsModal: React.FC<RemoteSettingsModalProps> = ({
  isOpen,
  onClose,
  bindings,
  learningAction,
  connectedGamepadName,
  onStartLearning,
  onCancelLearning,
  onClearBinding,
  onResetBindings,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        e.stopPropagation();
        onCancelLearning();
        onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-[28px] bg-neutral-900/95 border border-white/15 shadow-[0_24px_64px_rgba(0,0,0,0.85)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-white">
              <Gamepad2 className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                Bluetooth-пульт / Джойстик
              </h3>
              <p className="text-[11px] text-neutral-400">
                {connectedGamepadName
                  ? `Подключён: ${connectedGamepadName.slice(0, 32)}`
                  : 'Переключите пульт в режим Game/Joystick'}
              </p>
            </div>
          </div>
          <button
            onPointerDown={() => haptic.light()}
            onClick={() => {
              onCancelLearning();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-neutral-300 transition-colors"
            title="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tip Banner */}
        <div className="px-5 pt-3">
          <div className="rounded-2xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-[11px] text-neutral-300 leading-relaxed">
            Нажмите на действие и отклоните стик или нажмите кнопку на пульте, чтобы переназначить.
            Поддерживаются и геймпады (стиком вверх/вниз), и клавиатурные кнопки.
          </div>
        </div>

        {/* Bindings List */}
        <div className="p-5 space-y-2.5 max-h-[55vh] overflow-y-auto">
          {REMOTE_ACTION_META.map(({ action, title, description }) => {
            const isLearning = learningAction === action;
            const current = bindings[action];
            const labels: string[] = [];
            if (current?.gamepad?.label) labels.push(current.gamepad.label);
            if (current?.key?.label) labels.push(current.key.label);

            return (
              <div
                key={action}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 transition-all ${
                  isLearning
                    ? 'bg-amber-500/15 border-amber-400/60'
                    : 'bg-white/[0.04] border-white/10'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate">{title}</div>
                  <div className="text-[11px] text-neutral-400 truncate">{description}</div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onPointerDown={() => haptic.selection()}
                    onClick={() => {
                      if (isLearning) onCancelLearning();
                      else onStartLearning(action);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-medium transition-all apple-press ${
                      isLearning
                        ? 'bg-amber-400 text-black animate-pulse'
                        : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                    }`}
                  >
                    {isLearning
                      ? 'Нажмите кнопку...'
                      : labels.length > 0
                        ? labels.join(' / ')
                        : 'Не задано'}
                  </button>

                  {labels.length > 0 && !isLearning && (
                    <button
                      onPointerDown={() => haptic.light()}
                      onClick={() => onClearBinding(action)}
                      className="w-7 h-7 rounded-xl bg-white/5 hover:bg-red-500/20 text-neutral-400 hover:text-red-300 flex items-center justify-center transition-colors"
                      title="Очистить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/10 bg-black/30">
          <button
            onPointerDown={() => haptic.light()}
            onClick={() => {
              onCancelLearning();
              onResetBindings();
            }}
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Сбросить по умолчанию</span>
          </button>

          <button
            onPointerDown={() => haptic.light()}
            onClick={() => {
              onCancelLearning();
              onClose();
            }}
            className="px-4 py-1.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors apple-press"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
