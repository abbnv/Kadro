import { useEffect, useCallback } from 'react';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: any;
        version: string;
        platform: string;
        colorScheme: string;
        themeParams: any;
        isExpanded: boolean;
        viewportHeight: number;
        viewportStableHeight: number;
        headerColor: string;
        backgroundColor: string;
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        enableClosingConfirmation: () => void;
        openInvoice?: (url: string, callback?: (status: string) => void) => void;
        disableVerticalSwipes?: () => void;
        requestFullscreen?: () => void;
        exitFullscreen?: () => void;
        isFullscreen?: boolean;
        lockOrientation?: () => void;
        unlockOrientation?: () => void;
        isOrientationLocked?: boolean;
        safeAreaInset?: { top: number; bottom: number; left: number; right: number };
        contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        onEvent?: (eventType: string, cb: () => void) => void;
        offEvent?: (eventType: string, cb: () => void) => void;
      };
    };
  }
}

export function useTelegram() {
  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    if (!tg) return;

    try {
      tg.ready();
      tg.expand();
      if (typeof tg.requestFullscreen === 'function') {
        tg.requestFullscreen();
      }
      if (typeof tg.unlockOrientation === 'function') {
        tg.unlockOrientation();
      }
      tg.setHeaderColor('#000000');
      tg.setBackgroundColor('#000000');
      if (typeof tg.disableVerticalSwipes === 'function') {
        tg.disableVerticalSwipes();
      }

      const updateSafeAreas = () => {
        const topSafe = tg.safeAreaInset?.top || 0;
        const bottomSafe = tg.safeAreaInset?.bottom || 0;
        const contentTop = tg.contentSafeAreaInset?.top || 0;
        const contentBottom = tg.contentSafeAreaInset?.bottom || 0;

        if (topSafe > 0) {
          document.documentElement.style.setProperty('--tg-safe-area-inset-top', `${topSafe}px`);
        }
        if (contentTop > 0) {
          document.documentElement.style.setProperty('--tg-content-safe-area-inset-top', `${contentTop}px`);
        }
        if (bottomSafe > 0) {
          document.documentElement.style.setProperty('--tg-safe-area-inset-bottom', `${bottomSafe}px`);
        }
        if (contentBottom > 0) {
          document.documentElement.style.setProperty('--tg-content-safe-area-inset-bottom', `${contentBottom}px`);
        }

        const totalTop = topSafe + contentTop;
        if (totalTop > 0) {
          document.documentElement.style.setProperty('--safe-area-top', `${totalTop}px`);
        }
        const totalBottom = bottomSafe + contentBottom;
        if (totalBottom > 0) {
          document.documentElement.style.setProperty('--safe-area-bottom', `${totalBottom}px`);
        }
      };

      updateSafeAreas();

      // Native fullscreen transitions in Telegram are asynchronous.
      // Poll multiple times right after mounting to ensure safe areas are caught
      // as soon as the Telegram native client reports them.
      const timer1 = setTimeout(updateSafeAreas, 80);
      const timer2 = setTimeout(updateSafeAreas, 250);
      const timer3 = setTimeout(updateSafeAreas, 600);
      const timer4 = setTimeout(updateSafeAreas, 1200);

      const handleFullscreenChanged = () => {
        updateSafeAreas();
        if (tg.isOrientationLocked && typeof tg.unlockOrientation === 'function') {
          tg.unlockOrientation();
        }
      };

      if (typeof tg.onEvent === 'function') {
        tg.onEvent('safeAreaChanged', updateSafeAreas);
        tg.onEvent('contentSafeAreaChanged', updateSafeAreas);
        tg.onEvent('fullscreenChanged', handleFullscreenChanged);
        tg.onEvent('viewportChanged', updateSafeAreas);
      }

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
        clearTimeout(timer4);
        if (typeof tg.offEvent === 'function') {
          tg.offEvent('safeAreaChanged', updateSafeAreas);
          tg.offEvent('contentSafeAreaChanged', updateSafeAreas);
          tg.offEvent('fullscreenChanged', handleFullscreenChanged);
          tg.offEvent('viewportChanged', updateSafeAreas);
        }
      };
    } catch (e) {
      console.warn('Telegram WebApp init error', e);
    }
  }, [tg]);

  const setBackButton = useCallback(
    (visible: boolean, onClick?: () => void) => {
      if (!tg?.BackButton) return;
      if (visible && onClick) {
        tg.BackButton.show();
        tg.BackButton.onClick(onClick);
      } else {
        tg.BackButton.hide();
      }
    },
    [tg]
  );

  return {
    tg,
    isTelegram: Boolean(tg?.initData),
    setBackButton,
  };
}
