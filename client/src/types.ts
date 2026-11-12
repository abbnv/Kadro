export type MirrorMode = 'horizontal' | 'vertical' | 'both';

export type CameraMode = 'text' | 'reels' | 'circle';

export type PlanId = 'free' | 'shooting_day' | 'creator_pro';

export interface TariffConfig {
  id: PlanId;
  title: string;
  priceStars: number;
  durationSeconds: number;
  voiceLimitSeconds: number;
  isSubscription: boolean;
  features: string[];
}

export interface BillingStatus {
  plan: PlanId;
  planTitle: string;
  hasActivePaidPlan: boolean;
  totalAvailableSeconds: number;
  remainingSeconds: number;
  usedSeconds: number;
  expiresAt: number | null;
  nextRenewalAt: number | null;
  isAutoRenew: boolean;
  freeRemainingSeconds: number;
}

export interface ScriptSettings {
  fontSize: number;       // in px (18 - 72)
  speed: number;          // in px/sec (10 - 200)
  paddingX: number;       // in percent (5 - 35)
  isMirrored: boolean;
  mirrorMode?: MirrorMode; // 'horizontal' (H-Flip) | 'vertical' (V-Flip) | 'both' (180°)
  mode: 'speed' | 'speech';
  cameraMode?: CameraMode; // 'text' | 'reels' | 'circle'
  ringLight?: boolean;     // Screen Ring Light illumination
  countdownSeconds?: 0 | 3; // Pre-recording countdown
  cameraOverlayOpacity?: number; // Text capsule background opacity in camera mode (10 - 85)
  mirrorOutputVideo?: boolean; // Mirror final recorded video file
}

export interface Script {
  id: string;
  user_id?: string | null;
  title: string;
  content: string;
  settings: ScriptSettings;
  created_at: number;
  updated_at: number;
}

export interface AudioDevice {
  deviceId: string;
  label: string;
  groupId?: string;
}

export interface WordToken {
  index: number;
  raw: string;
  normalized: string;
  stem: string;
  hasNewline?: boolean;
  hasDoubleNewline?: boolean;
}

export interface TelegramUser {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  first_seen: number;
  last_seen: number;
  interactions_count: number;
}

export interface UserActivityLog {
  id: string;
  user_id: string;
  action: string;
  description: string;
  details?: string | null;
  created_at: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

