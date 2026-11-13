import { useEffect, useRef, useState, useCallback } from 'react';

export type RemoteAction =
  | 'playPause'
  | 'scrollUp'
  | 'scrollDown'
  | 'speedDown'
  | 'speedUp'
  | 'reset';

export interface KeyBinding {
  kind: 'key';
  code: string;
  label: string;
}

export type GamepadBinding =
  | {
      kind: 'button';
      index: number;
      label: string;
    }
  | {
      kind: 'axis';
      index: number;
      direction: 1 | -1;
      label: string;
    };

export interface ActionBindings {
  key?: KeyBinding;
  gamepad?: GamepadBinding;
}

export type RemoteBindingsMap = Record<RemoteAction, ActionBindings>;

const STORAGE_KEY = 'kadro_remote_bindings_v1';
const STICK_DEADZONE = 0.28;
const SCROLL_PX_PER_SEC = 480;

export const REMOTE_ACTION_META: Array<{
  action: RemoteAction;
  title: string;
  description: string;
}> = [
  { action: 'playPause', title: 'Старт / Пауза', description: 'Запуск или пауза суфлёра / записи' },
  { action: 'scrollUp', title: 'Листать вверх', description: 'Прокрутка текста назад (можно удерживать)' },
  { action: 'scrollDown', title: 'Листать вниз', description: 'Прокрутка текста вперёд (можно удерживать)' },
  { action: 'speedUp', title: 'Быстрее (+)', description: 'Увеличить скорость прокрутки' },
  { action: 'speedDown', title: 'Медленнее (−)', description: 'Уменьшить скорость прокрутки' },
  { action: 'reset', title: 'В начало', description: 'Сбросить текст в самое начало' },
];

export const DEFAULT_REMOTE_BINDINGS: RemoteBindingsMap = {
  playPause: {
    key: { kind: 'key', code: 'Space', label: 'Space' },
    gamepad: { kind: 'button', index: 0, label: 'Кнопка 1 (A)' },
  },
  scrollUp: {
    key: { kind: 'key', code: 'ArrowUp', label: '↑' },
    gamepad: { kind: 'axis', index: 1, direction: -1, label: 'Стик ↑' },
  },
  scrollDown: {
    key: { kind: 'key', code: 'ArrowDown', label: '↓' },
    gamepad: { kind: 'axis', index: 1, direction: 1, label: 'Стик ↓' },
  },
  speedDown: {
    key: { kind: 'key', code: 'ArrowLeft', label: '←' },
    gamepad: { kind: 'axis', index: 0, direction: -1, label: 'Стик ←' },
  },
  speedUp: {
    key: { kind: 'key', code: 'ArrowRight', label: '→' },
    gamepad: { kind: 'axis', index: 0, direction: 1, label: 'Стик →' },
  },
  reset: {
    key: { kind: 'key', code: 'KeyR', label: 'R' },
    gamepad: { kind: 'button', index: 1, label: 'Кнопка 2 (B)' },
  },
};

function formatKeyLabel(e: KeyboardEvent): string {
  if (e.code === 'Space') return 'Space';
  if (e.code === 'ArrowUp') return '↑';
  if (e.code === 'ArrowDown') return '↓';
  if (e.code === 'ArrowLeft') return '←';
  if (e.code === 'ArrowRight') return '→';
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return 'Enter';
  if (e.key && e.key.length === 1) return e.key.toUpperCase();
  return e.code || e.key || 'Key';
}

function loadBindings(): RemoteBindingsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_REMOTE_BINDINGS;
    const parsed = JSON.parse(raw) as Partial<RemoteBindingsMap>;
    return {
      playPause: parsed.playPause ?? DEFAULT_REMOTE_BINDINGS.playPause,
      scrollUp: parsed.scrollUp ?? DEFAULT_REMOTE_BINDINGS.scrollUp,
      scrollDown: parsed.scrollDown ?? DEFAULT_REMOTE_BINDINGS.scrollDown,
      speedDown: parsed.speedDown ?? DEFAULT_REMOTE_BINDINGS.speedDown,
      speedUp: parsed.speedUp ?? DEFAULT_REMOTE_BINDINGS.speedUp,
      reset: parsed.reset ?? DEFAULT_REMOTE_BINDINGS.reset,
    };
  } catch {
    return DEFAULT_REMOTE_BINDINGS;
  }
}

interface UseRemoteControlOptions {
  enabled: boolean;
  onPlayPause: () => void;
  onNudgeScroll: (deltaPx: number) => void;
  onSpeedDelta: (delta: number) => void;
  onReset: () => void;
  onEscape?: () => void;
}

export function useRemoteControl({
  enabled,
  onPlayPause,
  onNudgeScroll,
  onSpeedDelta,
  onReset,
  onEscape,
}: UseRemoteControlOptions) {
  const [bindings, setBindings] = useState<RemoteBindingsMap>(loadBindings);
  const [learningAction, setLearningAction] = useState<RemoteAction | null>(null);
  const [connectedGamepadName, setConnectedGamepadName] = useState<string | null>(null);

  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const learningActionRef = useRef(learningAction);
  learningActionRef.current = learningAction;

  const callbacksRef = useRef({ onPlayPause, onNudgeScroll, onSpeedDelta, onReset, onEscape });
  callbacksRef.current = { onPlayPause, onNudgeScroll, onSpeedDelta, onReset, onEscape };

  const heldKeysRef = useRef<Set<string>>(new Set());
  const prevGamepadButtonsRef = useRef<Record<number, boolean>>({});
  const prevGamepadAxisDiscreteRef = useRef<Record<string, boolean>>({});
  const learnBaselineAxesRef = useRef<number[]>([]);

  const saveBindings = useCallback((next: RemoteBindingsMap) => {
    setBindings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  const clearActionBinding = useCallback(
    (action: RemoteAction) => {
      const next: RemoteBindingsMap = {
        ...bindingsRef.current,
        [action]: {},
      };
      saveBindings(next);
    },
    [saveBindings]
  );

  const resetBindings = useCallback(() => {
    saveBindings(DEFAULT_REMOTE_BINDINGS);
  }, [saveBindings]);

  const startLearning = useCallback((action: RemoteAction) => {
    // Capture resting axis values to avoid false triggers from slight stick drift
    const gps = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const activeGp = Array.from(gps || []).find((g): g is Gamepad => Boolean(g && g.connected));
    learnBaselineAxesRef.current = activeGp ? [...activeGp.axes] : [];
    setLearningAction(action);
  }, []);

  const cancelLearning = useCallback(() => {
    setLearningAction(null);
  }, []);

  // Track gamepad connection status
  useEffect(() => {
    const syncGamepadStatus = () => {
      if (typeof navigator.getGamepads !== 'function') return;
      const gps = navigator.getGamepads();
      const active = Array.from(gps || []).find((g): g is Gamepad => Boolean(g && g.connected));
      setConnectedGamepadName(active ? active.id : null);
    };

    syncGamepadStatus();
    window.addEventListener('gamepadconnected', syncGamepadStatus);
    window.addEventListener('gamepaddisconnected', syncGamepadStatus);
    return () => {
      window.removeEventListener('gamepadconnected', syncGamepadStatus);
      window.removeEventListener('gamepaddisconnected', syncGamepadStatus);
    };
  }, []);

  // Keyboard listener (handles both normal remote control and key learning)
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      const code = e.code || e.key;
      if (!code) return;

      // Learning mode: bind pressed key to learningAction
      if (learningActionRef.current) {
        if (code === 'Escape') {
          setLearningAction(null);
          return;
        }
        e.preventDefault();
        const action = learningActionRef.current;
        const label = formatKeyLabel(e);
        const next: RemoteBindingsMap = {
          ...bindingsRef.current,
          [action]: {
            ...bindingsRef.current[action],
            key: { kind: 'key', code, label },
          },
        };
        saveBindings(next);
        setLearningAction(null);
        return;
      }

      if (code === 'Escape' && callbacksRef.current.onEscape) {
        callbacksRef.current.onEscape();
        return;
      }

      const map = bindingsRef.current;

      // Check discrete actions
      if (map.playPause.key?.code === code || (code === 'MediaPlayPause' && !map.playPause.key)) {
        e.preventDefault();
        if (!e.repeat) callbacksRef.current.onPlayPause();
        return;
      }
      if (map.reset.key?.code === code) {
        e.preventDefault();
        if (!e.repeat) callbacksRef.current.onReset();
        return;
      }
      if (map.speedUp.key?.code === code) {
        e.preventDefault();
        callbacksRef.current.onSpeedDelta(10);
        return;
      }
      if (map.speedDown.key?.code === code) {
        e.preventDefault();
        callbacksRef.current.onSpeedDelta(-10);
        return;
      }

      // Continuous scroll keys
      if (map.scrollUp.key?.code === code || map.scrollDown.key?.code === code) {
        e.preventDefault();
        heldKeysRef.current.add(code);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const code = e.code || e.key;
      if (code) heldKeysRef.current.delete(code);
    };

    const handleBlur = () => {
      heldKeysRef.current.clear();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      heldKeysRef.current.clear();
    };
  }, [enabled, saveBindings]);

  // Animation loop for continuous held keys + Gamepad polling (stick & buttons)
  useEffect(() => {
    if (!enabled) return;

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const gps = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const gp = Array.from(gps || []).find((g): g is Gamepad => Boolean(g && g.connected)) || null;

      // 1. Learning mode: listen for gamepad button or stick axis tilt
      if (learningActionRef.current && gp) {
        const action = learningActionRef.current;

        // Check buttons first
        for (let i = 0; i < gp.buttons.length; i++) {
          const pressed = gp.buttons[i]?.pressed;
          const wasPressed = prevGamepadButtonsRef.current[i];
          prevGamepadButtonsRef.current[i] = Boolean(pressed);

          if (pressed && !wasPressed) {
            const next: RemoteBindingsMap = {
              ...bindingsRef.current,
              [action]: {
                ...bindingsRef.current[action],
                gamepad: { kind: 'button', index: i, label: `Кнопка ${i + 1}` },
              },
            };
            saveBindings(next);
            setLearningAction(null);
            rafId = requestAnimationFrame(tick);
            return;
          }
        }

        // Check stick axes
        for (let i = 0; i < gp.axes.length; i++) {
          const val = gp.axes[i] ?? 0;
          const base = learnBaselineAxesRef.current[i] ?? 0;
          const delta = val - base;
          if (Math.abs(delta) > 0.55) {
            const direction: 1 | -1 = delta > 0 ? 1 : -1;
            const arrow =
              i % 2 === 1 ? (direction === -1 ? '↑' : '↓') : direction === -1 ? '←' : '→';
            const next: RemoteBindingsMap = {
              ...bindingsRef.current,
              [action]: {
                ...bindingsRef.current[action],
                gamepad: {
                  kind: 'axis',
                  index: i,
                  direction,
                  label: `Стик ${arrow} (ось ${i + 1})`,
                },
              },
            };
            saveBindings(next);
            setLearningAction(null);
            rafId = requestAnimationFrame(tick);
            return;
          }
        }

        rafId = requestAnimationFrame(tick);
        return;
      }

      // 2. Normal operation
      const map = bindingsRef.current;
      let scrollVelocity = 0; // -1..+1

      // Held keyboard scroll keys
      if (map.scrollUp.key && heldKeysRef.current.has(map.scrollUp.key.code)) {
        scrollVelocity -= 1;
      }
      if (map.scrollDown.key && heldKeysRef.current.has(map.scrollDown.key.code)) {
        scrollVelocity += 1;
      }

      // Gamepad inputs
      if (gp) {
        const readBindingStrength = (binding?: GamepadBinding): number => {
          if (!binding) return 0;
          if (binding.kind === 'button') {
            return gp.buttons[binding.index]?.pressed ? 1 : 0;
          }
          const rawAxis = gp.axes[binding.index] ?? 0;
          const signed = rawAxis * binding.direction;
          if (signed <= STICK_DEADZONE) return 0;
          return Math.min(1, (signed - STICK_DEADZONE) / (1 - STICK_DEADZONE));
        };

        // Continuous scroll from gamepad
        scrollVelocity -= readBindingStrength(map.scrollUp.gamepad);
        scrollVelocity += readBindingStrength(map.scrollDown.gamepad);

        // Edge-triggered discrete actions from gamepad
        const checkDiscreteEdge = (action: RemoteAction, cb: () => void) => {
          const b = map[action].gamepad;
          if (!b) return;
          const isActive = readBindingStrength(b) > 0.45;
          const edgeKey = `${action}_${b.kind}_${b.index}_${b.kind === 'axis' ? b.direction : 0}`;
          const wasActive = prevGamepadAxisDiscreteRef.current[edgeKey] ?? false;
          prevGamepadAxisDiscreteRef.current[edgeKey] = isActive;
          if (isActive && !wasActive) {
            cb();
          }
        };

        checkDiscreteEdge('playPause', () => callbacksRef.current.onPlayPause());
        checkDiscreteEdge('reset', () => callbacksRef.current.onReset());
        checkDiscreteEdge('speedUp', () => callbacksRef.current.onSpeedDelta(10));
        checkDiscreteEdge('speedDown', () => callbacksRef.current.onSpeedDelta(-10));

        // Keep button state cache warm for learning mode transitions
        for (let i = 0; i < gp.buttons.length; i++) {
          prevGamepadButtonsRef.current[i] = Boolean(gp.buttons[i]?.pressed);
        }
      }

      if (Math.abs(scrollVelocity) > 0.01) {
        callbacksRef.current.onNudgeScroll(scrollVelocity * SCROLL_PX_PER_SEC * dt);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [enabled, saveBindings]);

  return {
    bindings,
    learningAction,
    connectedGamepadName,
    startLearning,
    cancelLearning,
    clearActionBinding,
    resetBindings,
  };
}
