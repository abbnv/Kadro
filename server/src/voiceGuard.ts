export interface VoiceSessionCheck {
  allowed: boolean;
  remainingSeconds: number;
  plan: string;
  reason?: string;
}

export function canStartVoiceSession(_userId: string): VoiceSessionCheck {
  return {
    allowed: true,
    remainingSeconds: 999999,
    plan: 'self_hosted',
  };
}

export function recordVoiceUsage(
  _userId: string,
  _secondsUsed: number,
  _sessionId?: string
): {
  remainingSeconds: number;
  warning5min: boolean;
  limitReached: boolean;
} {
  return {
    remainingSeconds: 999999,
    warning5min: false,
    limitReached: false,
  };
}
