
import { z } from 'zod';

export enum Urgency {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum ActionType {
  USE = 'USE',
  FREEZE = 'FREEZE',
  DISCOUNT = 'DISCOUNT',
  INSPECT = 'INSPECT',
  DISCARD = 'DISCARD'
}

export type UserSegment = 'butcher' | 'cafe' | 'grocer';
export type ViewType = 'landing' | 'app';
export type AccessTier = 'beta' | 'lifetime' | 'subscription';
export type AuthStep = 'IDLE' | 'EMAIL_INPUT' | 'CHECK_EMAIL' | 'VERIFYING';

export interface UserProfile {
  id: string;
  email: string;
  createdAt: string;
  accessTier: AccessTier;
}

export interface StockItem {
  id: string;
  plu?: string;
  description: string;
  qty: number;
  unit: string;
  killDate?: string;
  packDate?: string;
  useByDate: string;
  location?: string;
}

export interface ColumnMapping {
  plu?: string;
  description: string;
  qty: string;
  qtyMode: 'single' | 'by_unit';
  qtyKg?: string;
  qtyEach?: string;
  unit?: string;
  kill_date?: string;
  pack_date?: string;
  use_by_date: string;
  location?: string;
}

// --- Zod Schemas for AI Responses ---

export const MappingResultSchema = z.object({
  mapping: z.object({
    plu: z.string().optional(),
    description: z.string(),
    qty: z.string(),
    qtyMode: z.enum(['single', 'by_unit']).optional().default('single'),
    qtyKg: z.string().optional(),
    qtyEach: z.string().optional(),
    unit: z.string().optional(),
    kill_date: z.string().optional(),
    pack_date: z.string().optional(),
    use_by_date: z.string(),
    location: z.string().optional(),
  }),
  confidence_per_field: z.record(z.string(), z.number()),
  reasons_per_field: z.record(z.string(), z.string()),
  required_missing: z.array(z.string()),
  clarification_questions: z.array(z.string()),
  isFallback: z.boolean().optional(),
  isAiGenerated: z.boolean().optional()
});

export const AnalysisResultSchema = z.object({
  buckets: z.object({
    use_today: z.array(z.any()),
    use_this_week: z.array(z.any()),
    at_risk: z.array(z.any()),
    expired: z.array(z.any()),
    safe: z.array(z.any()).optional(),
  }),
  today_actions: z.array(z.object({
    item_ref: z.string(),
    description: z.string(),
    recommended_action: z.nativeEnum(ActionType),
    urgency: z.nativeEnum(Urgency),
    reason: z.string(),
    suggested_note_for_staff: z.string(),
    qty: z.number(),
    unit: z.string(),
    useByDate: z.string()
  })),
  reorder_suggestions: z.array(z.object({
    item_key: z.string(),
    current_qty: z.number(),
    suggested_qty: z.number(),
    unit: z.string(),
    reason: z.string(),
    confidence: z.number()
  })),
  insights: z.array(z.object({
    title: z.string(),
    detail: z.string()
  }))
});

export type MappingResult = z.infer<typeof MappingResultSchema>;

export interface RowIssue {
  row_index: number;
  severity: 'error' | 'warning';
  issue_code: string;
  message: string;
}

export interface NormalizedData {
  normalized_items: StockItem[];
  row_issues: RowIssue[];
  summary_counts: {
    rows_in: number;
    items_out: number;
    errors: number;
    warnings: number;
  };
}

export interface ActionItem {
  item_ref: string;
  description: string;
  recommended_action: ActionType;
  urgency: Urgency;
  reason: string;
  suggested_note_for_staff: string;
  qty: number;
  unit: string;
  useByDate: string;
}

export interface ReorderSuggestion {
  item_key: string;
  current_qty: number;
  suggested_qty: number;
  unit: string;
  reason: string;
  confidence: number;
}

export interface AnalysisResult {
  buckets: {
    use_today: StockItem[];
    use_this_week: StockItem[];
    at_risk: StockItem[];
    expired: StockItem[];
    safe: StockItem[];
  };
  today_actions: ActionItem[];
  zero_stock_items: StockItem[];
  reorder_suggestions: ReorderSuggestion[];
  insights: { title: string; detail: string }[];
}

export interface WasteEvent {
  id: string;
  date: string;
  stockItemDescription: string;
  qtyWasted: number;
  unit: string;
  reason: string;
}

export interface DebugLog {
  timestamp: string;
  type: 'AI_REQUEST' | 'AI_RESPONSE' | 'ERROR' | 'DIAGNOSTIC';
  featureName?: string;
  correlationId?: string;
  content: any;
}

export interface Thresholds {
  useTodayMax: number;
  useThisWeekMax: number;
  atRiskMax: number;
}

export interface ReorderSettings {
  enableReorderSignals: boolean;
  lowStockThresholdKg: number;
  targetStockKg: number;
  minReorderKg: number;
  lowStockThresholdEach: number;
  targetStockEach: number;
  minReorderEach: number;
  wasteRiskReductionEnabled: boolean;
  wasteRiskReductionPercent: number;
  wasteRiskQtyThresholdKg: number;
  wasteRiskQtyThresholdEach: number;
}

export interface RoiSettings {
  defaultValuePerKg?: number;
  defaultValuePerEach?: number;
  currency: string;
}

export interface AppState {
  currentView: ViewType;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  user: UserProfile | null;
  currentBatchId: string | null;
  rawHeaders: string[];
  rawRows: any[];
  mappingResult: MappingResult | null;
  normalizedData: NormalizedData | null;
  analysisResult: AnalysisResult | null;
  wasteLogs: WasteEvent[];
  thresholds: Thresholds;
  reorderSettings: ReorderSettings;
  roiSettings: RoiSettings;
  defaultExpiredAction: ActionType.DISCARD | ActionType.INSPECT;
  hideSafeItems: boolean;
  showZeroStock: boolean;
  isMockMode: boolean;
  debugLogs: DebugLog[];
  dashboardFilter: 'all' | 'expired' | 'use_today' | 'use_this_week' | 'at_risk';
  aiAssistEnabled: boolean;
}
