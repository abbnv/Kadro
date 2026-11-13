import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { WordToken } from '../types';

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
  text: string;
  speed: number;            // px / sec
  mode: 'speed' | 'speech';
  isPlaying: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  fontSize?: number;
  paddingX?: number;
  onReachEnd?: () => void;
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
  text,
  speed,
  mode,
  isPlaying,
  containerRef,
  fontSize,
  paddingX,
  onReachEnd,
}: UsePrompterScrollOptions) {
  const tokens = useMemo(() => tokenizeText(text), [text]);
  const [activeWordIndex, setActiveWordIndex] = useState<number>(0);

  const activeIndexRef = useRef<number>(0);
  const ignoreUntilRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;

  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;
  const hasReachedEndRef = useRef<boolean>(false);

  const targetScrollTopRef = useRef<number>(0);
  const currentScrollTopRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const isUserInteractingRef = useRef<boolean>(false);
  const wordOffsetsRef = useRef<number[]>([]);

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
  }, [containerRef, tokens.length]);

  // Recompute offsets on mount, text/font/padding change, container resize, and window resize
  useEffect(() => {
    const timer = setTimeout(recomputeWordOffsets, 60);
    window.addEventListener('resize', recomputeWordOffsets);
    window.addEventListener('orientationchange', recomputeWordOffsets);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        recomputeWordOffsets();
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', recomputeWordOffsets);
      window.removeEventListener('orientationchange', recomputeWordOffsets);
      resizeObserver?.disconnect();
    };
  }, [recomputeWordOffsets, containerRef, fontSize, paddingX]);

  // Synchronize active word index using binary search over precomputed offsets (O(log N), zero DOM queries)
  const updateActiveWordFromScroll = useCallback(
    (scrollTop: number) => {
      const container = containerRef.current;
      if (!container || tokens.length === 0) return;

      if (scrollTop <= 15) {
        activeIndexRef.current = 0;
        setActiveWordIndex(0);
        return;
      }

      const offsets = wordOffsetsRef.current;
      if (!offsets || offsets.length === 0) {
        recomputeWordOffsets();
        return;
      }

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

      activeIndexRef.current = closestIdx;
      setActiveWordIndex(closestIdx);
    },
    [tokens.length, containerRef, recomputeWordOffsets]
  );

  // Listen for user manual gestures (touch, wheel, scroll)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let interactionTimer: NodeJS.Timeout | null = null;

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
          updateActiveWordFromScroll(st);
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
          updateActiveWordFromScroll(containerRef.current.scrollTop);
        }
      }, 200);
    };

    const handleScroll = () => {
      // Whenever user manually scrolls while paused or dragging
      if (!isPlayingRef.current || isUserInteractingRef.current) {
        const st = container.scrollTop;
        targetScrollTopRef.current = st;
        currentScrollTopRef.current = st;
        if (!isPlayingRef.current) {
          updateActiveWordFromScroll(st);
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
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef, updateActiveWordFromScroll]);

  // When unpausing / starting playback:
  // ALWAYS sync start position and active word to where the container is currently scrolled
  useEffect(() => {
    if (isPlaying && containerRef.current) {
      const st = containerRef.current.scrollTop;
      targetScrollTopRef.current = st;
      currentScrollTopRef.current = st;
      lastTimeRef.current = null;
      updateActiveWordFromScroll(st);
    }
  }, [isPlaying, updateActiveWordFromScroll]);

  // Smooth scroll animator loop
  useEffect(() => {
    const animate = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const dt = Math.min(0.05, (time - lastTimeRef.current) / 1000);
      lastTimeRef.current = time;

      const container = containerRef.current;
      if (container && !isUserInteractingRef.current) {
        if (isPlaying && mode === 'speed') {
          // Continuous constant speed scroll
          targetScrollTopRef.current += speed * dt;
          currentScrollTopRef.current = targetScrollTopRef.current;
          container.scrollTop = currentScrollTopRef.current;

          // Auto-pause when the last word scrolls past the focal horizon
          const offsets = wordOffsetsRef.current;
          if (
            !hasReachedEndRef.current &&
            offsets.length > 0 &&
            currentScrollTopRef.current >= offsets[offsets.length - 1] - container.clientHeight * 0.2
          ) {
            hasReachedEndRef.current = true;
            if (onReachEndRef.current) {
              onReachEndRef.current();
            }
          }
        } else if (isPlaying && mode === 'speech') {
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
      }
    };
  }, [isPlaying, mode, speed, containerRef]);

  // Sync scroll target to a specific word index
  const scrollToWord = useCallback(
    (index: number) => {
      if (index < 0 || index >= tokens.length) return;
      activeIndexRef.current = index;
      setActiveWordIndex(index);

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

      // Line-stabilization threshold:
      // Words on the same horizontal line have nearly identical newTarget values (diff <= 4px).
      // Only update target when moving to a new line, preventing all horizontal word tracking jitter!
      if (Math.abs(newTarget - targetScrollTopRef.current) > 4) {
        targetScrollTopRef.current = newTarget;
      }

      // Check if user reached the final word in speech mode -> trigger auto-pause after natural 700ms cadence
      if (isPlayingRef.current && mode === 'speech' && tokens.length > 1 && index >= tokens.length - 1 && !hasReachedEndRef.current) {
        hasReachedEndRef.current = true;
        setTimeout(() => {
          if (isPlayingRef.current && onReachEndRef.current) {
            onReachEndRef.current();
          }
        }, 700);
      } else if (index < tokens.length - 1) {
        hasReachedEndRef.current = false;
      }
    },
    [tokens.length, containerRef, mode]
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
      // 1. PRIMARY FORWARD READING HORIZON (curr to curr + 12)
      // The speaker is reading forward. Prioritize finding the furthest matching
      // token in the forward window to eliminate speech lag and ensure snappy tracking.
      // -----------------------------------------------------------------------
      const forwardMax = Math.min(tokens.length - 1, curr + 12);
      let bestForwardIdx = -1;

      // Check from the latest spoken words towards the earliest
      for (let sIdx = cleanSpoken.length - 1; sIdx >= 0; sIdx--) {
        const spoken = cleanSpoken[sIdx];
        if (!spoken) continue;

        for (let tIdx = curr; tIdx <= forwardMax; tIdx++) {
          if (wordsMatch(tokens[tIdx].normalized, spoken)) {
            // Check reliability of the forward match:
            // - Immediate next words (tIdx <= curr + 1) are always valid.
            // - For words further ahead (tIdx > curr + 1), require either:
            //     a) A word with length >= 4 (not an isolated preposition), OR
            //     b) A 2-word sequence match with adjacent spoken/token word.
            const isImmediate = tIdx <= curr + 1;
            const isDistinctive = tokens[tIdx].normalized.length >= 4;
            const hasPrevMatch =
              sIdx > 0 &&
              tIdx > 0 &&
              wordsMatch(tokens[tIdx - 1].normalized, cleanSpoken[sIdx - 1]);
            const hasNextMatch =
              sIdx + 1 < cleanSpoken.length &&
              tIdx + 1 < tokens.length &&
              wordsMatch(tokens[tIdx + 1].normalized, cleanSpoken[sIdx + 1]);

            if (isImmediate || isDistinctive || hasPrevMatch || hasNextMatch) {
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
    activeIndexRef.current = 0;
    setActiveWordIndex(0);
    targetScrollTopRef.current = 0;
    currentScrollTopRef.current = 0;
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [containerRef]);

  return {
    tokens,
    activeWordIndex,
    scrollToWord,
    handleSpokenWords,
    resetScroll,
    recomputeWordOffsets,
  };
}
