import { useEffect, useRef } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

/**
 * Keeps the device screen awake while `enabled` is true using the Screen Wake Lock API.
 * Automatically re-acquires the lock when returning to the foreground or after a user gesture.
 */
export function useWakeLock(enabled: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let isCancelled = false;

    const requestLock = async () => {
      if (isCancelled || document.visibilityState !== 'visible') return;
      if (sentinelRef.current && !sentinelRef.current.released) return;

      try {
        const wakeLockApi = (navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        }).wakeLock;
        if (!wakeLockApi) return;

        const sentinel = await wakeLockApi.request('screen');
        if (isCancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Ignore if battery saver / WebView policy temporarily blocks wake lock
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestLock();
      }
    };

    const handleUserGesture = () => {
      requestLock();
    };

    requestLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pointerdown', handleUserGesture, { passive: true });

    return () => {
      isCancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pointerdown', handleUserGesture);
      if (sentinelRef.current && !sentinelRef.current.released) {
        sentinelRef.current.release().catch(() => {});
      }
      sentinelRef.current = null;
    };
  }, [enabled]);
}
