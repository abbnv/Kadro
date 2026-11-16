import { Script } from '../types';

const PROGRESS_KEY_PREFIX = 'kadro_reading_progress_v1:';

export interface SavedReadingProgress {
  wordIndex: number;
  progressPct: number;
  updatedAt: number;
}

export function saveLocalReadingProgress(
  scriptId: string,
  wordIndex: number,
  progressPct: number
): void {
  if (!scriptId) return;
  try {
    if (wordIndex <= 0 || progressPct <= 0 || progressPct >= 99) {
      localStorage.removeItem(`${PROGRESS_KEY_PREFIX}${scriptId}`);
      return;
    }
    const payload: SavedReadingProgress = {
      wordIndex,
      progressPct: Math.min(99, Math.max(1, Math.round(progressPct))),
      updatedAt: Date.now(),
    };
    localStorage.setItem(`${PROGRESS_KEY_PREFIX}${scriptId}`, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

export function clearLocalReadingProgress(scriptId: string): void {
  if (!scriptId) return;
  try {
    localStorage.removeItem(`${PROGRESS_KEY_PREFIX}${scriptId}`);
  } catch {
    // ignore
  }
}

export function getSavedReadingProgress(script: Script): {
  wordIndex: number;
  progressPct: number;
} {
  try {
    const raw = localStorage.getItem(`${PROGRESS_KEY_PREFIX}${script.id}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedReadingProgress>;
      if (
        typeof parsed.wordIndex === 'number' &&
        parsed.wordIndex > 0 &&
        typeof parsed.progressPct === 'number' &&
        parsed.progressPct > 0 &&
        parsed.progressPct < 99
      ) {
        return {
          wordIndex: parsed.wordIndex,
          progressPct: Math.round(parsed.progressPct),
        };
      }
    }
  } catch {
    // ignore
  }

  const settingsIdx = script.settings?.lastWordIndex ?? 0;
  const settingsPct = script.settings?.readingProgress ?? 0;
  if (settingsIdx > 0 && settingsPct > 0 && settingsPct < 99) {
    return {
      wordIndex: settingsIdx,
      progressPct: Math.round(settingsPct),
    };
  }

  return { wordIndex: 0, progressPct: 0 };
}
