import React, { useState } from 'react';
import { Home, Plus, Play, Edit3, Trash2, Clock, FileText } from 'lucide-react';
import { Script } from '../types';
import { haptic } from '../utils/haptics';

interface ScriptListProps {
  scripts: Script[];
  onSelectScript: (script: Script) => void;
  onEditScript: (script: Script) => void;
  onCreateScript: () => void;
  onDeleteScript: (id: string) => void;
}

// Calculate reading time: ~125 words per minute
function getReadingTime(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return '0 сек';
  const totalSeconds = Math.ceil((words / 125) * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} сек`;
  if (seconds === 0) return `${minutes} мин`;
  return `${minutes} мин ${seconds} сек`;
}

export const ScriptList: React.FC<ScriptListProps> = ({
  scripts,
  onSelectScript,
  onEditScript,
  onCreateScript,
  onDeleteScript,
}) => {
  const [scriptToDelete, setScriptToDelete] = useState<Script | null>(null);

  return (
    <div className="min-h-screen bg-black text-neutral-100 px-4 pt-safe-top pb-32 max-w-xl mx-auto flex flex-col">
      {/* 1. Apple Large Title Header with Plus Button aligned to Logo */}
      <div className="pt-2 pb-5 mb-3 border-b border-white/10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-5xl font-display font-bold tracking-[-0.02em] leading-none text-white">
            KADRO
          </h1>

          {/* Top-Right Plus Button (Vibrant Apple Orange Accent, optically aligned to cap height) */}
          <button
            onPointerDown={() => haptic.medium()}
            onClick={onCreateScript}
            className="-mt-1.5 w-10 h-10 rounded-full bg-gradient-to-b from-[#FFB32C] via-[#FF6B00] to-[#FF4500] text-white flex items-center justify-center border-t border-white/50 shadow-[0_4px_22px_rgba(255,107,0,0.55),inset_0_1px_1px_rgba(255,255,255,0.55),0_1px_2px_rgba(0,0,0,0.4)] hover:brightness-110 apple-press transition-all shrink-0"
            title="Создать сценарий"
          >
            <Plus className="w-5 h-5 stroke-[2.75]" />
          </button>
        </div>
        <p className="font-inter font-semibold text-xs tracking-[0.01em] text-neutral-400 mt-1.5">
          AI-суфлёр для записи видео
        </p>
      </div>

      {/* 2. Empty State (No scripts yet) */}
      {scripts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-20 px-4">
          <div className="w-16 h-16 rounded-3xl bg-neutral-900/80 border border-white/15 flex items-center justify-center mb-4 shadow-[0_12px_32px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.2)]">
            <FileText className="w-7 h-7 text-neutral-300 stroke-[1.5]" />
          </div>
          <h2 className="text-base font-semibold text-white tracking-tight">Нет сохранённых сценариев</h2>
          <p className="text-xs text-neutral-400 max-w-xs mt-1.5 leading-relaxed">
            Создайте первый сценарий или вставьте готовый текст для чтения перед камерой.
          </p>
          <button
            onPointerDown={() => haptic.medium()}
            onClick={onCreateScript}
            className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-b from-white via-neutral-100 to-neutral-200 text-black text-xs font-semibold hover:brightness-105 apple-press transition-all border-t border-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.35),inset_0_1px_1px_rgba(255,255,255,0.9)]"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Создать сценарий</span>
          </button>
        </div>
      ) : (
        /* 3. List of Script Cards */
        <div className="space-y-3">
          {scripts.map((script) => {
            const readingTime = getReadingTime(script.content);
            const wordsCount = script.content.trim().split(/\s+/).filter(Boolean).length;
            const previewText = script.content.trim().slice(0, 110) || 'Пустой сценарий...';

            return (
              <div
                key={script.id}
                onPointerDown={() => haptic.light()}
                onClick={() => onSelectScript(script)}
                className="group relative rounded-[24px] bg-neutral-900/50 backdrop-blur-xl border border-white/10 hover:border-white/20 p-4 transition-colors duration-200 cursor-pointer shadow-[0_8px_24px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.08)] active:bg-neutral-900/80"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <h3 className="font-semibold text-sm text-white tracking-tight truncate flex-1 group-hover:text-neutral-200 transition-colors">
                    {script.title || 'Без названия'}
                  </h3>

                  <div className="flex items-center gap-1.5">
                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        haptic.medium();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectScript(script);
                      }}
                      className="p-1.5 rounded-full bg-gradient-to-b from-white via-neutral-100 to-neutral-200 text-black border-t border-white/90 shadow-[0_2px_10px_rgba(255,255,255,0.2)] hover:brightness-105 apple-press transition-all"
                      title="В суфлёр"
                    >
                      <Play className="w-3.5 h-3.5 fill-black stroke-none" />
                    </button>

                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        haptic.light();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditScript(script);
                      }}
                      className="p-1.5 text-neutral-400 hover:text-white rounded-full hover:bg-white/10 apple-press transition-colors"
                      title="Редактировать текст"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        haptic.medium();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setScriptToDelete(script);
                      }}
                      className="p-1.5 text-neutral-400 hover:text-red-400 rounded-full hover:bg-red-500/10 apple-press transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed mb-3">
                  {previewText}
                </p>

                <div className="flex items-center gap-3 text-[11px] text-neutral-400 font-medium">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-neutral-400" />
                    ~{readingTime}
                  </span>
                  <span>•</span>
                  <span>{wordsCount} слов</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Floating Liquid Glass Bottom Navbar */}
      <div className="fixed bottom-safe-nav left-1/2 -translate-x-1/2 z-50 flex items-center select-none pointer-events-auto">
        <div className="h-[60px] flex items-center gap-3 px-4 rounded-full bg-neutral-900/85 backdrop-blur-2xl border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.22)] animate-nav-enter">
          <button
            onPointerDown={() => haptic.light()}
            className="w-11 h-11 rounded-full flex items-center justify-center text-white bg-gradient-to-b from-white/25 to-white/15 border border-white/30 border-t-white/50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_4px_12px_rgba(0,0,0,0.4)] apple-press transition-colors"
            title="Сценарии (активно)"
          >
            <Home className="w-5 h-5 stroke-[2]" />
          </button>
        </div>
      </div>

      {/* 6. Apple-style Delete Confirmation Modal */}
      {scriptToDelete && (
        <div
          onClick={() => setScriptToDelete(null)}
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-[26px] bg-neutral-900/95 backdrop-blur-2xl border border-white/15 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.85),inset_0_1px_1px_rgba(255,255,255,0.18)] text-center"
          >
            <h2 className="text-base font-semibold text-white tracking-tight">
              Удалить сценарий?
            </h2>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
              «{scriptToDelete.title || 'Без названия'}» будет удалён без возможности восстановления.
            </p>

            <div className="grid grid-cols-2 gap-2.5 mt-5">
              <button
                onPointerDown={() => haptic.light()}
                onClick={() => setScriptToDelete(null)}
                className="py-2.5 px-3 rounded-2xl text-sm font-medium bg-white/10 hover:bg-white/15 text-white apple-press transition-colors"
              >
                Отмена
              </button>
              <button
                onPointerDown={() => haptic.heavy()}
                onClick={() => {
                  onDeleteScript(scriptToDelete.id);
                  setScriptToDelete(null);
                }}
                className="py-2.5 px-3 rounded-2xl text-sm font-semibold bg-red-500/90 hover:bg-red-500 text-white shadow-[0_4px_16px_rgba(239,68,68,0.35)] apple-press transition-colors"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
