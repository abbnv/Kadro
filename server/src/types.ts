export type PlanId = 'free' | 'shooting_day' | 'creator_pro';

export type CameraMode = 'text' | 'reels' | 'circle';

export interface ScriptSettings {
  fontSize: number;       // in px (e.g. 36)
  speed: number;          // in px/sec (e.g. 50)
  paddingX: number;       // in percent (e.g. 15%)
  isMirrored: boolean;    // horizontally flipped for prompter glass
  mode: 'speed' | 'speech'; // time-based vs speech recognition
  cameraMode?: CameraMode;
  ringLight?: boolean;
  countdownSeconds?: 0 | 3;
  cameraOverlayOpacity?: number;
  mirrorOutputVideo?: boolean;
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

export interface UserBilling {
  user_id: string;
  free_period_start: number; // ms timestamp
  free_period_index: number; // 1 = first 30 days, >=2 subsequent
  free_seconds_used: number; // seconds (can have decimals)
  active_plan: PlanId;       // 'free' | 'shooting_day' | 'creator_pro'
  paid_plan_expires_at: number | null; // ms timestamp
  paid_seconds_limit: number | null;   // seconds
  paid_seconds_used: number;          // seconds
  subscription_charge_id: string | null;
  subscription_auto_renew: number;     // 1 or 0
  updated_at: number;
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

export interface PaymentRecord {
  id: string;
  user_id: string;
  plan_type: PlanId;
  amount_stars: number;
  telegram_payment_charge_id: string | null;
  provider_payment_charge_id: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  created_at: number;
  payload?: string;
}

export interface UsageLog {
  id: string;
  user_id: string;
  session_id: string;
  duration_seconds: number;
  plan_type: PlanId;
  created_at: number;
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

