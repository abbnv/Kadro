import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { WordToken } from '../types';
import {
  saveLocalReadingProgress,
  clearLocalReadingProgress,
} from '../utils/readingProgress';

function cleanWord(str: string): string {
  return str.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/gi, '');
}

// Russian + English stemmer
function getStem(normalized: string): string {
  if (normalized.length <= 3) return normalized;
  return normalized
    .replace(/(вшись|ившись|ывшись)$/, '')
    .replace(/(овать|евать|нуть|ать|ять|еть|ить|ыть)$/, '')
    .replace(/(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ей)$/, '')
    .replace(/(ов|ев|ей|ам|ям|ах|ях|ом|ем|у|ю|а|я|е|и|ы|о)$/, '');
}

export function tokenizeText(text: string): WordToken[] {
  const regex = /(\S+)(\s*)/g;
  const tokens: WordToken[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    const whitespace = match[2];
    const normalized = cleanWord(raw);
    const hasDoubleNewline = whitespace.includes('\n\n') || whitespace.includes('\r\n\r\n');
    const hasNewline = hasDoubleNewline || whitespace.includes('\n') || whitespace.includes('\r');

    tokens.push({
      index,
      raw,
      normalized,
      stem: getStem(normalized),
      hasNewline,
      hasDoubleNewline,
    });
    index++;
  }

  return tokens;
}

function wordsMatch(tokenNorm: string, spokenRaw: string): boolean {
  const normSpoken = cleanWord(spokenRaw);
  if (!normSpoken || !tokenNorm) return false;
  if (tokenNorm === normSpoken) return true;

  // Short words (<= 3 chars, e.g. "и", "в", "на", "как", "что", "это", "для") MUST be an exact match
  if (tokenNorm.length <= 3 || normSpoken.length <= 3) {
    return tokenNorm === normSpoken;
  }

  // Inflection match for Russian word endings:
  // Both words must have close lengths (diff <= 2) and share a long root
  const minLen = Math.min(tokenNorm.length, normSpoken.length);
  const maxLen = Math.max(tokenNorm.length, normSpoken.length);
  if (maxLen - minLen > 2) return false;

  let commonPrefix = 0;
  while (commonPrefix < minLen && tokenNorm[commonPrefix] === normSpoken[commonPrefix]) {
    commonPrefix++;
  }

  // Common root must be at least 4 letters AND cover almost the entire word (minLen - 2)
  return commonPrefix >= 4 && commonPrefix >= minLen - 2;
}

interface UsePrompterScrollOptions {
  scriptId: string;
  text: string;
  speed: number;            // px / sec
  mode: 'speed' | 'speech';
  isPlaying: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  fontSize?: number;
  paddingX?: number;
  initialWordIndex?: number;
  onReachEnd?: () => void;
  onProgressSave?: (wordIndex: number, progressPct: number) => void;
  onRestoredProgress?: (progressPct: number) => void;
}

function getOffsetTopInContainer(el: HTMLElement, container: HTMLElement): number {
  let top = 0;
  let curr: HTMLElement | null = el;
  while (curr && curr !== container) {
    top += curr.offsetTop;
    curr = curr.offsetParent as HTMLElement | null;
  }
  return top;
}

export function usePrompterScroll({
  scriptId,
  text,
  speed,
  mode,
  isPlaying,
  containerRef,
  fontSize,
  paddingX,
  initialWordIndex = 0,
  onReachEnd,
  onProgressSave,
  onRestoredProgress,
}: UsePrompterScrollOptions) {
  const tokens = useMemo(() => tokenizeText(text), [text]);
  const [activeWordIndex, setActiveWordIndex] = useState<number>(0);

  const activeIndexRef = useRef<number>(0);
  const renderedActiveIndexRef = useRef<number>(0);
  const ignoreUntilRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;

  const modeRef = useRef<'speed' | 'speech'>(mode);
  modeRef.current = mode;

  const scriptIdRef = useRef<string>(scriptId);
  scriptIdRef.current = scriptId;

  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;
  const onProgressSaveRef = useRef(onProgressSave);
  onProgressSaveRef.current = onProgressSave;
  const onRestoredProgressRef = useRef(onRestoredProgress);
  onRestoredProgressRef.current = onRestoredProgress;

  const hasReachedEndRef = useRef<boolean>(false);
  const hasRestoredInitialRef = useRef<boolean>(false);
  const initialWordIndexRef = useRef<number>(initialWordIndex);
  initialWordIndexRef.current = initialWordIndex;

  const targetScrollTopRef = useRef<number>(0);
  const currentScrollTopRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const lastProgressSaveTimeRef = useRef<number>(0);
  const isUserInteractingRef = useRef<boolean>(false);
  const wordOffsetsRef = useRef<number[]>([]);

  const setActiveWordIndexIfChanged = useCallback((nextIdx: number) => {
    activeIndexRef.current = nextIdx;
    if (renderedActiveIndexRef.current !== nextIdx) {
      renderedActiveIndexRef.current = nextIdx;
      setActiveWordIndex(nextIdx);
    }
  }, []);

  const persistProgress = useCallback(
    (wordIndex: number, syncToSettings = false) => {
      const total = tokens.length;
      if (total <= 1 || wordIndex <= 0 || wordIndex >= total - 1) {
        clearLocalReadingProgress(scriptIdRef.current);
        if (syncToSettings) {
          onProgressSaveRef.current?.(0, 0);
        }
        return;
      }

      const pct = Math.min(99, Math.max(1, Math.round((wordIndex / (total - 1)) * 100)));
      saveLocalReadingProgress(scriptIdRef.current, wordIndex, pct);
      if (syncToSettings) {
        onProgressSaveRef.current?.(wordIndex, pct);
      }
    },
    [tokens.length]
  );

  // Binary search over precomputed offsets (O(log N), zero DOM queries)
  const findWordIndexForScrollTop = useCallback(
    (scrollTop: number): number => {
      const container = containerRef.current;
      if (!container || tokens.length === 0) return 0;
      if (scrollTop <= 15) return 0;

      const offsets = wordOffsetsRef.current;
      if (!offsets || offsets.length === 0) return activeIndexRef.current;

      // Focal horizon: 20% from the top of the viewport (leaves 80% below for look-ahead)
      const focalY = scrollTop + container.clientHeight * 0.2;

      let low = 0;
      let high = offsets.length - 1;
      let closestIdx = 0;
      let minDiff = Infinity;

      while (low <= high) {
        const mid = (low + high) >> 1;
        const diff = Math.abs(offsets[mid] - focalY);

        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = mid;
        }

        if (offsets[mid] < focalY) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      return closestIdx;
    },
    [tokens.length, containerRef]
  );

  // Precompute word vertical offsets once to eliminate layout thrashing during animation/scrolling.
  // Uses offsetTop instead of getBoundingClientRect() so CSS transforms (scaleY(-1), rotate(90deg)) never invert coordinates.
  const recomputeWordOffsets = useCallback(() => {
    const container = containerRef.current;
    if (!container || tokens.length === 0) return;

    const wordElements = container.querySelectorAll<HTMLElement>('[data-word-index]');
    if (wordElements.length === 0) return;

    const offsets = new Array<number>(wordElements.length);
    for (let i = 0; i < wordElements.length; i++) {
      offsets[i] = getOffsetTopInContainer(wordElements[i], container);
    }

    wordOffsetsRef.current = offsets;

    // 1. Restore saved reading position on first layout computation
    if (!hasRestoredInitialRef.current && offsets.length > 0) {
      hasRestoredInitialRef.current = true;
      const savedIdx = initialWordIndexRef.current;
      if (savedIdx > 0 && savedIdx < offsets.length - 1) {
        const focalOffset = container.clientHeight * 0.2;
        const restoredTop = Math.max(0, offsets[savedIdx] - focalOffset);
        targetScrollTopRef.current = restoredTop;
        currentScrollTopRef.current = restoredTop;
        container.scrollTop = restoredTop;
        setActiveWordIndexIfChanged(savedIdx);

        const pct = Math.min(99, Math.max(1, Math.round((savedIdx / (offsets.length - 1)) * 100)));
        onRestoredProgressRef.current?.(pct);
        return;
      }
    }

    // 2. Keep scroll position anchored to active word across orientation/font/padding changes while paused
    if (!isPlayingRef.current && activeIndexRef.current > 0 && activeIndexRef.current < offsets.length) {
      const focalOffset = container.clientHeight * 0.2;
      const anchoredTop = Math.max(0, offsets[activeIndexRef.current] - focalOffset);
      targetScrollTopRef.current = anchoredTop;
      currentScrollTopRef.current = anchoredTop;
      container.scrollTop = anchoredTop;
    }
  }, [containerRef, tokens.length, setActiveWordIndexIfChanged]);

  // Recompute offsets on mount, text/font/padding change, and debounced window resize
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = setTimeout(recomputeWordOffsets, 60);

    const scheduleRecompute = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!isUserInteractingRef.current) {
          recomputeWordOffsets();
        }
      }, 150);
    };

    window.addEventListener('resize', scheduleRecompute);
    window.addEventListener('orientationchange', scheduleRecompute);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('resize', scheduleRecompute);
      window.removeEventListener('orientationchange', scheduleRecompute);
    };
  }, [recomputeWordOffsets, fontSize, paddingX]);

  // Synchronize active word index from scroll position
  const updateActiveWordFromScroll = useCallback(
    (scrollTop: number, forceStateSync = false) => {
      if (wordOffsetsRef.current.length === 0) {
        recomputeWordOffsets();
      }
      const closestIdx = findWordIndexForScrollTop(scrollTop);
      activeIndexRef.current = closestIdx;

      // Only trigger React state update when in speech mode or explicitly requested (avoids 60fps DOM tree re-renders in speed mode)
      if (modeRef.current === 'speech' || forceStateSync) {
        setActiveWordIndexIfChanged(closestIdx);
      }
      return closestIdx;
    },
    [findWordIndexForScrollTop, recomputeWordOffsets, setActiveWordIndexIfChanged]
  );

  // Listen for user manual gestures (touch, wheel, scroll)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let interactionTimer: ReturnType<typeof setTimeout> | null = null;

    const handleTouchStart = () => {
      isUserInteractingRef.current = true;
    };

    const handleTouchEnd = () => {
      if (interactionTimer) clearTimeout(interactionTimer);
      interactionTimer = setTimeout(() => {
        isUserInteractingRef.current = false;
        if (containerRef.current) {
          const st = containerRef.current.scrollTop;
          targetScrollTopRef.current = st;
          currentScrollTopRef.current = st;
          const idx = updateActiveWordFromScroll(st, true);
          persistProgress(idx, !isPlayingRef.current);
        }
      }, 150);
    };

    const handleWheel = () => {
      isUserInteractingRef.current = true;
      if (containerRef.current) {
        const st = containerRef.current.scrollTop;
        targetScrollTopRef.current = st;
        currentScrollTopRef.current = st;
      }
      if (interactionTimer) clearTimeout(interactionTimer);
      interactionTimer = setTimeout(() => {
        isUserInteractingRef.current = false;
        if (containerRef.current) {
          const idx = updateActiveWordFromScroll(containerRef.current.scrollTop, true);
          persistProgress(idx, !isPlayingRef.current);
        }
      }, 200);
    };

    let scrollSettleTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      // Whenever user manually scrolls while paused or dragging:
      // Update scroll refs immediately (zero layout/React/storage work during 60-120fps momentum scroll)
      if (!isPlayingRef.current || isUserInteractingRef.current) {
        const st = container.scrollTop;
        targetScrollTopRef.current = st;
        currentScrollTopRef.current = st;

        if (!isPlayingRef.current) {
          if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
          scrollSettleTimer = setTimeout(() => {
            if (!containerRef.current || isPlayingRef.current) return;
            const finalSt = containerRef.current.scrollTop;
            const idx = updateActiveWordFromScroll(finalSt, false);
            persistProgress(idx, false);
          }, 180);
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (interactionTimer) clearTimeout(interactionTimer);
      if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef, updateActiveWordFromScroll, persistProgress]);

  // When starting or pausing playback: sync position and persist reading progress
  useEffect(() => {
    if (!containerRef.current) return;
    const st = containerRef.current.scrollTop;
    targetScrollTopRef.current = st;
    currentScrollTopRef.current = st;
    lastTimeRef.current = null;
    const idx = updateActiveWordFromScroll(st, true);

    if (!isPlaying && hasRestoredInitialRef.current) {
      persistProgress(idx, true);
    }
  }, [isPlaying, containerRef, updateActiveWordFromScroll, persistProgress]);

  // Save current reading progress on unmount (e.g., exiting prompter)
  useEffect(() => {
    return () => {
      if (hasReachedEndRef.current) {
        clearLocalReadingProgress(scriptIdRef.current);
        onProgressSaveRef.current?.(0, 0);
      } else if (activeIndexRef.current > 0) {
        persistProgress(activeIndexRef.current, true);
      }
    };
  }, [persistProgress]);

  // Smooth scroll animator loop — only runs while isPlaying is true
  useEffect(() => {
    if (!isPlaying) {
      lastTimeRef.current = null;
      return;
    }

    const animate = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const dt = Math.min(0.05, (time - lastTimeRef.current) / 1000);
      lastTimeRef.current = time;

      const container = containerRef.current;
      if (container && !isUserInteractingRef.current) {
        if (mode === 'speed') {
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          targetScrollTopRef.current = Math.min(maxScroll, targetScrollTopRef.current + speed * dt);
          currentScrollTopRef.current = targetScrollTopRef.current;
          container.scrollTop = currentScrollTopRef.current;

          // Periodically track word index & save progress to localStorage every ~1s without triggering React re-renders
          if (time - lastProgressSaveTimeRef.current >= 1000) {
            lastProgressSaveTimeRef.current = time;
            const idx = findWordIndexForScrollTop(currentScrollTopRef.current);
            activeIndexRef.current = idx;
            persistProgress(idx, false);
          }

          // Auto-pause when the last word scrolls past the focal horizon
          const offsets = wordOffsetsRef.current;
          if (
            !hasReachedEndRef.current &&
            offsets.length > 0 &&
            currentScrollTopRef.current >= offsets[offsets.length - 1] - container.clientHeight * 0.2
          ) {
            hasReachedEndRef.current = true;
            clearLocalReadingProgress(scriptIdRef.current);
            onProgressSaveRef.current?.(0, 0);
            if (onReachEndRef.current) {
              onReachEndRef.current();
            }
          }
        } else if (mode === 'speech') {
          // Critically damped spring tracking:
          // Smoothly and responsively tracks the spoken line with zero jitter or oscillation
          const diff = targetScrollTopRef.current - currentScrollTopRef.current;

          if (Math.abs(diff) > 0.4) {
            const step = diff * Math.min(1, dt * 14.0);
            currentScrollTopRef.current += step;
            container.scrollTop = currentScrollTopRef.current;
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isPlaying, mode, speed, containerRef, findWordIndexForScrollTop, persistProgress]);

  // Sync scroll target to a specific word index
  const scrollToWord = useCallback(
    (index: number, immediateJump = false) => {
      if (index < 0 || index >= tokens.length) return;
      setActiveWordIndexIfChanged(index);

      // Don't fight the user if they are currently holding/dragging the screen
      if (isUserInteractingRef.current) return;

      const container = containerRef.current;
      if (!container) return;

      const offsets = wordOffsetsRef.current;
      const focalOffset = container.clientHeight * 0.2;

      let wordTop: number;
      if (offsets && offsets[index] !== undefined) {
        wordTop = offsets[index];
      } else {
        const wordEl = container.querySelector(`[data-word-index="${index}"]`) as HTMLElement;
        if (!wordEl) return;
        wordTop = getOffsetTopInContainer(wordEl, container);
      }

      const newTarget = Math.max(0, wordTop - focalOffset);

      if (immediateJump || modeRef.current === 'speed' || !isPlayingRef.current) {
        targetScrollTopRef.current = newTarget;
        currentScrollTopRef.current = newTarget;
        container.scrollTop = newTarget;
      } else if (Math.abs(newTarget - targetScrollTopRef.current) > 4) {
        // Line-stabilization threshold in speech mode:
        // Words on the same horizontal line have nearly identical newTarget values (diff <= 4px).
        targetScrollTopRef.current = newTarget;
      }

      // Check if user reached the final word in speech mode -> trigger auto-pause after natural 700ms cadence
      if (isPlayingRef.current && mode === 'speech' && tokens.length > 1 && index >= tokens.length - 1 && !hasReachedEndRef.current) {
        hasReachedEndRef.current = true;
        clearLocalReadingProgress(scriptIdRef.current);
        onProgressSaveRef.current?.(0, 0);
        setTimeout(() => {
          if (isPlayingRef.current && onReachEndRef.current) {
            onReachEndRef.current();
          }
        }, 700);
      } else if (index < tokens.length - 1) {
        hasReachedEndRef.current = false;
        persistProgress(index, !isPlayingRef.current);
      }
    },
    [tokens.length, containerRef, mode, setActiveWordIndexIfChanged, persistProgress]
  );

  // Called when speech recognition emits spoken words
  const handleSpokenWords = useCallback(
    (spokenWords: Array<{ word: string }>) => {
      if (!isPlayingRef.current || mode !== 'speech' || spokenWords.length === 0) return;
      if (Date.now() < ignoreUntilRef.current) return;

      const curr = activeIndexRef.current;
      const cleanSpoken = spokenWords
        .map((s) => cleanWord(s.word))
        .filter((w) => w.length > 0);

      if (cleanSpoken.length === 0) return;

      // -----------------------------------------------------------------------
      // 1. PRIMARY FORWARD READING HORIZON (curr to curr + 8)
      // The speaker is reading forward. Require multi-word confirmation for
      // jumps beyond +2 words so common 4-6 letter words never skip ahead.
      // -----------------------------------------------------------------------
      const forwardMax = Math.min(tokens.length - 1, curr + 8);
      let bestForwardIdx = -1;

      // Check from the latest spoken words towards the earliest
      for (let sIdx = cleanSpoken.length - 1; sIdx >= 0; sIdx--) {
        const spoken = cleanSpoken[sIdx];
        if (!spoken) continue;

        for (let tIdx = curr; tIdx <= forwardMax; tIdx++) {
          if (wordsMatch(tokens[tIdx].normalized, spoken)) {
            const isImmediate = tIdx <= curr + 2;
            const isVeryDistinctive = tIdx <= curr + 5 && tokens[tIdx].normalized.length >= 7;
            const hasPrevMatch =
              sIdx > 0 &&
              tIdx > 0 &&
              wordsMatch(tokens[tIdx - 1].normalized, cleanSpoken[sIdx - 1]);
            const hasNextMatch =
              sIdx + 1 < cleanSpoken.length &&
              tIdx + 1 < tokens.length &&
              wordsMatch(tokens[tIdx + 1].normalized, cleanSpoken[sIdx + 1]);

            if (isImmediate || isVeryDistinctive || hasPrevMatch || hasNextMatch) {
              const matchedIdx = hasNextMatch ? tIdx + 1 : tIdx;
              if (matchedIdx > bestForwardIdx) {
                bestForwardIdx = matchedIdx;
              }
            }
          }
        }

        // If we found a forward progression beyond curr, advance immediately!
        if (bestForwardIdx > curr) {
          scrollToWord(bestForwardIdx);
          return;
        }
      }

      // If best forward match is at current position
      if (bestForwardIdx === curr) {
        scrollToWord(bestForwardIdx);
        return;
      }

      // -----------------------------------------------------------------------
      // 2. BACKTRACK / STUMBLE RECOVERY (ONLY IF NO FORWARD MATCH WAS FOUND)
      // If the speaker stopped, stumbled, or restarted a phrase 1-5 words back.
      // Strict conditions: Never backtrack on isolated short words.
      // Requires at least 2 consecutive matching words OR 1 long distinctive word (>= 7 chars).
      // -----------------------------------------------------------------------
      const backStart = Math.max(0, curr - 5);
      const backEnd = curr; // exclusive

      for (let sIdx = 0; sIdx < cleanSpoken.length; sIdx++) {
        const spoken = cleanSpoken[sIdx];
        for (let tIdx = backStart; tIdx < backEnd; tIdx++) {
          const token = tokens[tIdx];
          if (wordsMatch(token.normalized, spoken)) {
            let seqCount = 1;
            while (
              sIdx + seqCount < cleanSpoken.length &&
              tIdx + seqCount < backEnd &&
              wordsMatch(tokens[tIdx + seqCount].normalized, cleanSpoken[sIdx + seqCount])
            ) {
              seqCount++;
            }

            const isMultiWord = seqCount >= 2;
            const isVeryLongWord = token.normalized.length >= 7;

            if (isMultiWord || isVeryLongWord) {
              const targetIdx = tIdx + seqCount - 1;
              scrollToWord(targetIdx);
              return;
            }
          }
        }
      }
    },
    [mode, tokens, scrollToWord]
  );

  const resetScroll = useCallback(() => {
    ignoreUntilRef.current = Date.now() + 800;
    hasReachedEndRef.current = false;
    setActiveWordIndexIfChanged(0);
    targetScrollTopRef.current = 0;
    currentScrollTopRef.current = 0;
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    clearLocalReadingProgress(scriptIdRef.current);
    onProgressSaveRef.current?.(0, 0);
  }, [containerRef, setActiveWordIndexIfChanged]);

  const nudgeScroll = useCallback(
    (deltaPx: number) => {
      const container = containerRef.current;
      if (!container) return;
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const next = Math.max(0, Math.min(maxScroll, currentScrollTopRef.current + deltaPx));
      currentScrollTopRef.current = next;
      targetScrollTopRef.current = next;
      container.scrollTop = next;
      const idx = updateActiveWordFromScroll(next, false);
      const now = performance.now();
      if (now - lastProgressSaveTimeRef.current >= 500) {
        lastProgressSaveTimeRef.current = now;
        persistProgress(idx, false);
      }
    },
    [containerRef, updateActiveWordFromScroll, persistProgress]
  );

  return {
    tokens,
    activeWordIndex,
    scrollToWord,
    handleSpokenWords,
    resetScroll,
    nudgeScroll,
    recomputeWordOffsets,
  };
}
