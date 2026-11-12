/**
 * Universal Haptic Feedback utility for Telegram Mini App and Web.
 * Provides micro-vibrations matching Apple iOS tactile sensations.
 */
export const haptic = {
  /**
   * Light impact for normal button taps (Home, Mirror, Settings, Collapse).
   */
  light: () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
        return;
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(8);
      }
    } catch {
      // Ignore vibration errors if unsupported or blocked
    }
  },

  /**
   * Medium impact for primary actions (Play, Pause).
   */
  medium: () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
        return;
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(18);
      }
    } catch {
      // Ignore
    }
  },

  /**
   * Heavy impact for finishing recording or decisive actions.
   */
  heavy: () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('heavy');
        return;
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(28);
      }
    } catch {
      // Ignore
    }
  },

  /**
   * Selection feedback for sliders, segmented tabs, word jumping.
   */
  selection: () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.selectionChanged();
        return;
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(6);
      }
    } catch {
      // Ignore
    }
  },

  /**
   * Success notification impact (e.g. mic permission granted, rewound to start).
   */
  success: () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
        return;
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([10, 30, 15]);
      }
    } catch {
      // Ignore
    }
  },

  /**
   * Error notification impact (e.g. payment failed, mic error).
   */
  error: () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('error');
        return;
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([20, 40, 20]);
      }
    } catch {
      // Ignore
    }
  },

  /**
   * Warning notification impact.
   */
  warning: () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('warning');
        return;
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([15, 30]);
      }
    } catch {
      // Ignore
    }
  },
};
