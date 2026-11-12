import React, { useState, useRef } from 'react';
import { ArrowLeft, Check, AlignLeft, Clock } from 'lucide-react';
import { Script, ScriptSettings } from '../types';
import { haptic } from '../utils/haptics';

interface ScriptEditorProps {
  initialScript?: Script | null;
  onSave: (data: { title: string; content: string; settings?: Partial<ScriptSettings> }) => Promise<void>;
  onCancel: () => void;
}

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

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  initialScript,
  onSave,
  onCancel,
}) => {
  const [title, setTitle] = useState<string>(initialScript?.title || '');
  const [content, setContent] = useState<string>(initialScript?.content || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const charCount = content.length;
  const readingTime = getReadingTime(content);

  const handleSave = async () => {
    if (!title.trim()) {
      haptic.error();
      setErrorMessage('Введите название сценария');
      titleInputRef.current?.focus();
      return;
    }

    setErrorMessage(null);
    haptic.success();
    setIsSaving(true);
    try {
      await onSave({ title: title.trim(), content });
      onCancel();
    } catch (err: any) {
      haptic.error();
      setErrorMessage(err?.message || 'Не удалось сохранить сценарий');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-neutral-100 px-4 pb-8 max-w-xl mx-auto flex flex-col">
      {/* Translucent Sticky Apple Navigation Bar (stays anchored inside safe area) */}
      <header className="sticky top-0 z-30 -mx-4 px-4 pt-safe-top pb-3 bg-black/80 backdrop-blur-2xl border-b border-white/10 flex items-center justify-between gap-3">
        <button
          onPointerDown={() => haptic.light()}
          onClick={onCancel}
          className="h-9 px-3.5 rounded-full bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-neutral-200 hover:text-white flex items-center gap-1.5 apple-press transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>К сценариям</span>
        </button>

        <button
          onPointerDown={() => haptic.medium()}
          onClick={handleSave}
          disabled={isSaving}
          className="h-9 px-4 rounded-full bg-gradient-to-b from-[#FFB32C] via-[#FF6B00] to-[#FF4500] text-white text-xs font-semibold flex items-center gap-1.5 border-t border-white/50 shadow-[0_4px_18px_rgba(255,107,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.5)] hover:brightness-110 apple-press transition-all disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5 stroke-[2.75]" />
          <span>{isSaving ? 'Сохранение...' : 'Сохранить'}</span>
        </button>
      </header>

      {/* Title Input */}
      <div className="mt-5 mb-3">
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (errorMessage) setErrorMessage(null);
          }}
          placeholder="Название сценария"
          className={`w-full bg-transparent font-inter text-2xl font-bold tracking-[-0.02em] leading-tight text-white placeholder-neutral-600 outline-none pb-2.5 border-b transition-colors ${
            errorMessage
              ? 'border-red-500/70 focus:border-red-400'
              : 'border-white/10 focus:border-white/30'
          }`}
        />
        {errorMessage && (
          <p className="text-xs text-red-400 font-medium mt-1.5">
            {errorMessage}
          </p>
        )}
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-4 mb-4 font-inter text-xs font-medium text-neutral-400 tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-neutral-500 stroke-[1.8]" />
          <span>~{readingTime} чтения</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <AlignLeft className="w-3.5 h-3.5 text-neutral-500 stroke-[1.8]" />
          <span>{charCount.toLocaleString('ru-RU')} симв.</span>
        </span>
      </div>

      {/* Compact Liquid Glass Textarea (fits cleanly above mobile keyboard) */}
      <div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Напишите или вставьте текст сценария для суфлёра..."
          className="w-full h-[210px] sm:h-[260px] p-4 bg-neutral-900/65 backdrop-blur-xl text-neutral-100 text-[15px] leading-relaxed placeholder-neutral-600 outline-none resize-none focus:border-white/25 transition-colors font-inter rounded-[22px] border border-white/10 shadow-[0_8px_28px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.08)]"
        />
      </div>
    </div>
  );
};
