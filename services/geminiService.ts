
import { GoogleGenAI, Type } from "@google/genai";
import { 
  ColumnMapping, 
  MappingResult, 
  NormalizedData, 
  StockItem, 
  RowIssue, 
  AnalysisResult,
  Urgency,
  ActionType,
  ActionItem,
  MappingResultSchema,
  DebugLog,
  Thresholds,
  ReorderSettings
} from "../types";

const HAS_API_KEY = !!process.env.API_KEY && process.env.API_KEY.length > 5;

// AI Guard State
let sessionCallCount = 0;
let lastCallTimestamp = 0;
const SESSION_MAX_CALLS = 3;
const CALL_COOLDOWN_MS = 10000;

// Caching
const mappingCache: Record<string, MappingResult> = {};

export class GeminiService {
  private onDebugLog?: (log: DebugLog) => void;

  constructor() {}

  setDebugLogger(logger: (log: DebugLog) => void) {
    this.onDebugLog = logger;
  }

  private log(type: DebugLog['type'], content: any, featureName?: string, correlationId?: string) {
    if (this.onDebugLog) {
      this.onDebugLog({
        timestamp: new Date().toISOString(),
        type,
        featureName,
        correlationId,
        content
      });
    }
  }

  private getCorrelationId() {
    return Math.random().toString(36).substring(2, 9).toUpperCase();
  }

  private canMakeAiCall(): { allowed: boolean; reason?: string } {
    if (!HAS_API_KEY) return { allowed: false, reason: "Missing API Key" };
    if (sessionCallCount >= SESSION_MAX_CALLS) return { allowed: false, reason: `Budget reached (${SESSION_MAX_CALLS}/session)` };
    
    const now = Date.now();
    const elapsed = now - lastCallTimestamp;
    if (elapsed < CALL_COOLDOWN_MS) return { allowed: false, reason: `Cooldown active (${Math.ceil((CALL_COOLDOWN_MS - elapsed) / 1000)}s left)` };

    return { allowed: true };
  }

  private recordAiCall() {
    sessionCallCount++;
    lastCallTimestamp = Date.now();
  }

  async testConnection(): Promise<{ success: boolean; message: string; details: any }> {
    const correlationId = this.getCorrelationId();
    const featureName = "diagnosticTest";
    
    if (!HAS_API_KEY) {
      const msg = "Gemini not configured: Missing API Key.";
      this.log('ERROR', { msg, keyPresent: false }, featureName, correlationId);
      return { success: false, message: msg, details: { status: "MISSING_KEY", fix: "Check environment variables." } };
    }

    this.log('AI_REQUEST', { prompt: "Return OK", model: "gemini-3-flash-preview" }, featureName, correlationId);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "Return the string 'OK' if you are working."
      });

      if (response.text?.includes('OK')) {
        this.log('AI_RESPONSE', { text: response.text }, featureName, correlationId);
        return { success: true, message: "Connection Successful", details: { text: response.text } };
      }
      throw new Error("Unexpected response content");
    } catch (e: any) {
      const errInfo = this.parseGeminiError(e);
      this.log('ERROR', errInfo, featureName, correlationId);
      return { success: false, message: "Diagnostic Failed", details: errInfo };
    }
  }

  private parseGeminiError(e: any) {
    const message = e.message || "Unknown Error";
    let status: string | number = "UNKNOWN";
    let suggestedFix = "AI Assist unavailable. Using standard rules.";

    if (message.includes("401")) {
      status = 401;
    } else if (message.includes("403")) {
      status = 403;
    } else if (message.includes("429")) {
      status = 429;
    } else if (message.includes("fetch") || message.includes("Network")) {
      status = "NETWORK";
    }

    return {
      status,
      message: message.substring(0, 200),
      suggestedFix,
      originalError: String(e).substring(0, 500)
    };
  }

  async mapColumns(headers: string[], sampleRows: any[], aiAssistEnabled: boolean): Promise<MappingResult> {
    const correlationId = this.getCorrelationId();
    const featureName = "autoMapOnUpload";
    
    // Header Signature for Caching
    const signature = headers.join('|').toLowerCase();
    if (mappingCache[signature]) {
      this.log('DIAGNOSTIC', { msg: "Using cached mapping", signature }, featureName, correlationId);
      return mappingCache[signature];
    }

    const guard = this.canMakeAiCall();
    if (!aiAssistEnabled || !guard.allowed) {
      this.log('DIAGNOSTIC', { reason: aiAssistEnabled ? guard.reason : "AI Assist Disabled", feature: featureName }, featureName, correlationId);
      const mock = this.mockMapColumns(headers, sampleRows);
      const result = { ...mock, isFallback: true };
      // Cache the deterministic fallback too
      mappingCache[signature] = result;
      return result;
    }

    this.log('AI_REQUEST', { headers, model: "gemini-3-flash-preview" }, featureName, correlationId);
    this.recordAiCall();
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      // Redact/Trim sample rows for token efficiency
      const safeSamples = sampleRows.slice(0, 3).map(r => {
        const entry: any = {};
        Object.entries(r).forEach(([k, v]) => {
          entry[k] = typeof v === 'string' ? v.substring(0, 50) : v;
        });
        return entry;
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Identify column mappings for an inventory sheet.
        Headers: ${headers.join(', ')}
        Sample Data: ${JSON.stringify(safeSamples)}
        
        Fields to map: sku/plu, description, qty, unit, use_by_date, kill_date, pack_date, location.
        Return qtyMode: 'by_unit' if separate Weight and Each columns exist.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mapping: {
                type: Type.OBJECT,
                properties: {
                  plu: { type: Type.STRING },
                  description: { type: Type.STRING },
                  qty: { type: Type.STRING },
                  qtyMode: { type: Type.STRING },
                  qtyKg: { type: Type.STRING },
                  qtyEach: { type: Type.STRING },
                  unit: { type: Type.STRING },
                  kill_date: { type: Type.STRING },
                  pack_date: { type: Type.STRING },
                  use_by_date: { type: Type.STRING },
                  location: { type: Type.STRING },
                },
                required: ["description", "qty", "use_by_date"]
              },
              confidence_per_field: { type: Type.OBJECT },
              reasons_per_field: { type: Type.OBJECT },
              required_missing: { type: Type.ARRAY, items: { type: Type.STRING } },
              clarification_questions: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          }
        }
      });

      const parsed = JSON.parse(response.text || "{}");
      const validated = MappingResultSchema.parse(parsed);
      const result = { ...validated, isAiGenerated: true };
      this.log('AI_RESPONSE', result, featureName, correlationId);
      mappingCache[signature] = result;
      return result;
    } catch (e) {
      const errInfo = this.parseGeminiError(e);
      this.log('ERROR', { ...errInfo, feature: featureName, fallback: 'Deterministic Mapping' }, featureName, correlationId);
      const mock = this.mockMapColumns(headers, sampleRows);
      const result = { ...mock, isFallback: true };
      mappingCache[signature] = result;
      return result;
    }
  }

  async generateDashboardInsights(summary: any, aiAssistEnabled: boolean): Promise<{ title: string; detail: string }[]> {
    const correlationId = this.getCorrelationId();
    const featureName = "dashboardInsights";

    const guard = this.canMakeAiCall();
    if (!aiAssistEnabled || !guard.allowed) {
      this.log('DIAGNOSTIC', { reason: aiAssistEnabled ? guard.reason : "AI Assist Disabled", feature: featureName }, featureName, correlationId);
      return [];
    }

    this.log('AI_REQUEST', { summary, model: "gemini-3-flash-preview" }, featureName, correlationId);
    this.recordAiCall();

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate 1-3 short operational insights bullets based on these inventory stats:
        - Expired: ${summary.expired}
        - Use Today: ${summary.use_today}
        - Use This Week: ${summary.use_this_week}
        - Total Analyzed: ${summary.total}
        - Stock Quality Errors: ${summary.errors}
        
        Keep tone professional and action-oriented.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                detail: { type: Type.STRING }
              },
              required: ["title", "detail"]
            }
          }
        }
      });

      const validated = JSON.parse(response.text || "[]");
      this.log('AI_RESPONSE', validated, featureName, correlationId);
      return validated;
    } catch (e) {
      const errInfo = this.parseGeminiError(e);
      this.log('ERROR', { ...errInfo, feature: featureName }, featureName, correlationId);
      return [];
    }
  }

  private mockMapColumns(headers: string[], sampleRows: any[]): MappingResult {
    const mapping: Partial<ColumnMapping> = {
      qtyMode: 'single'
    };
    const confidence: Record<string, number> = {};
    const reasons: Record<string, string> = {};

    const findMatch = (keys: string[]) => {
      return headers.find(h => keys.some(k => h.toLowerCase().includes(k.toLowerCase())));
    };

    mapping.plu = findMatch(['plu', 'sku', 'code', 'item id', 'part no']);
    mapping.description = findMatch(['desc', 'item', 'name', 'product', 'material']) || headers[0];
    mapping.qty = findMatch(['qty', 'quantity', 'weight', 'net', 'count', 'amount']) || headers[1];
    mapping.unit = findMatch(['unit', 'uom', 'measure', 'type', 'stockuom', 'unit of measure']);
    mapping.kill_date = findMatch(['kill', 'slaughter', 'sltr']);
    mapping.pack_date = findMatch(['pack', 'produced', 'mfg']);
    mapping.use_by_date = findMatch(['use by', 'expiry', 'exp', 'best before', 'expires', 'useby']);
    mapping.location = findMatch(['loc', 'bin', 'fridge', 'room', 'aisle']);

    const weightCol = findMatch(['net weight', 'netweight', 'net_weight', 'weight', 'nw', 'kg weight']);
    const countCol = findMatch(['quantity', 'qty', 'count', 'units', 'each qty']);
    
    let unitColumnIsReliable = false;
    if (mapping.unit) {
      unitColumnIsReliable = sampleRows.some(row => {
        const val = this.normalizeUnitValue(row[mapping.unit!]);
        return val === 'kg' || val === 'each';
      });
    }

    if (mapping.unit && unitColumnIsReliable && weightCol && countCol) {
      mapping.qtyMode = 'by_unit';
      mapping.qtyKg = weightCol;
      mapping.qtyEach = countCol;
      confidence.qtyMode = 1.0;
    } else {
      mapping.qtyMode = 'single';
      confidence.qtyMode = 0.5;
    }

    Object.keys(mapping).forEach(k => {
      if (k !== 'qtyMode') {
        confidence[k] = (mapping as any)[k] ? 0.8 : 0.1;
      }
      reasons[k] = (mapping as any)[k] ? `Keyword match: ${k}` : `No deterministic match for ${k}`;
    });

    return {
      mapping: mapping as ColumnMapping,
      confidence_per_field: confidence,
      reasons_per_field: reasons,
      required_missing: !mapping.use_by_date ? ['use_by_date'] : [],
      clarification_questions: []
    };
  }

  private normalizeUnitValue(val: any): 'kg' | 'each' | null {
    if (val === null || val === undefined) return null;
    const s = String(val).toLowerCase().trim();
    if (['kg', 'kilo', 'kilograms', 'kilogram', 'kgs'].includes(s)) return 'kg';
    if (['each', 'ea', 'pcs', 'piece', 'unit', 'units', 'eachs'].includes(s)) return 'each';
    return null;
  }

  async normalizeRows(mapping: ColumnMapping, rows: any[]): Promise<NormalizedData> {
    const normalized_items: StockItem[] = [];
    const row_issues: RowIssue[] = [];
    let errors = 0;
    let warnings = 0;

    const qtyHeader = (mapping.qty && mapping.qty !== '__none__') ? mapping.qty.toLowerCase() : '';
    const defaultUnit = (qtyHeader.includes('weight') || qtyHeader.includes('kg') || qtyHeader.includes('grams')) ? 'kg' : 'ea';

    rows.forEach((row, index) => {
      if (!row || Object.values(row).every(v => v === null || v === undefined || String(v).trim() === '')) {
        return;
      }

      const desc = mapping.description !== '__none__' ? row[mapping.description] : null;
      const useByRaw = mapping.use_by_date !== '__none__' ? row[mapping.use_by_date] : null;

      if (!desc || String(desc).trim() === '') {
        row_issues.push({ row_index: index, severity: 'error', issue_code: 'MISSING_DESC', message: 'Missing description' });
        errors++;
        return;
      }

      const useByDate = this.parseDate(useByRaw);
      if (!useByDate) {
        row_issues.push({ row_index: index, severity: 'error', issue_code: 'INVALID_DATE', message: `Invalid Use By Date: ${useByRaw}` });
        errors++;
        return;
      }

      let qtyValRaw: any;
      let finalUnit = mapping.unit !== '__none__' ? row[mapping.unit] : defaultUnit;
      const normUnit = this.normalizeUnitValue(finalUnit);

      if (mapping.qtyMode === 'by_unit') {
        if (!normUnit) {
           row_issues.push({ row_index: index, severity: 'error', issue_code: 'INVALID_UNIT', message: `Unknown unit: ${finalUnit}` });
           errors++;
           return;
        }
        const targetCol = normUnit === 'kg' ? mapping.qtyKg : mapping.qtyEach;
        qtyValRaw = targetCol && targetCol !== '__none__' ? row[targetCol] : null;
      } else {
        qtyValRaw = mapping.qty !== '__none__' ? row[mapping.qty] : null;
      }

      const qty = parseFloat(qtyValRaw);
      if (isNaN(qty)) {
        row_issues.push({ row_index: index, severity: 'error', issue_code: 'INVALID_QTY', message: `Invalid quantity: ${qtyValRaw}` });
        errors++;
        return;
      }

      normalized_items.push({
        id: `row-${index}-${Date.now()}`,
        description: String(desc).trim(),
        qty: qty,
        unit: normUnit || String(finalUnit || defaultUnit).trim(),
        useByDate: useByDate.toISOString().split('T')[0],
        plu: mapping.plu && mapping.plu !== '__none__' ? row[mapping.plu] : undefined,
        killDate: this.parseDate(mapping.kill_date && mapping.kill_date !== '__none__' ? row[mapping.kill_date] : null)?.toISOString().split('T')[0],
        packDate: this.parseDate(mapping.pack_date && mapping.pack_date !== '__none__' ? row[mapping.pack_date] : null)?.toISOString().split('T')[0],
        location: mapping.location && mapping.location !== '__none__' ? row[mapping.location] : undefined
      });
    });

    return {
      normalized_items,
      row_issues,
      summary_counts: { rows_in: rows.length, items_out: normalized_items.length, errors, warnings }
    };
  }

  public parseDate(val: any): Date | null {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') {
      if (val > 30000 && val < 60000) {
        return new Date(Math.round((val - 25569) * 864e5));
      }
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed) return null;
      const parts = trimmed.split(/[/-]/);
      if (parts.length === 3) {
        let d, m, y;
        if (parts[0].length === 4) {
          y = parseInt(parts[0]);
          m = parseInt(parts[1]) - 1;
          d = parseInt(parts[2]);
        } else {
          d = parseInt(parts[0]);
          m = parseInt(parts[1]) - 1;
          y = parts[2].length === 2 ? 2000 + parseInt(parts[2]) : parseInt(parts[2]);
        }
        
        // Month and day range validation to catch heuristic mismatches (like 05/20/2025)
        if (isNaN(d) || isNaN(m) || isNaN(y) || m < 0 || m > 11 || d < 1 || d > 31) return null;
        
        const dt = new Date(Date.UTC(y, m, d));
        // Check if date creation overflowed (e.g. Feb 30th)
        return (!isNaN(dt.getTime()) && dt.getUTCDate() === d) ? dt : null;
      }
      const dt = new Date(trimmed);
      return !isNaN(dt.getTime()) ? dt : null;
    }
    return null;
  }

  async analyze(
    items: StockItem[], 
    thresholds: Thresholds, 
    reorderSettings: ReorderSettings,
    expiredAction: ActionType.DISCARD | ActionType.INSPECT,
    hideSafe: boolean,
    forceMock: boolean = false
  ): Promise<AnalysisResult> {
    return this.mockAnalyze(items, thresholds, reorderSettings, expiredAction, hideSafe);
  }

  private mockAnalyze(
    items: StockItem[], 
    thresholds: Thresholds,
    reorderSettings: ReorderSettings,
    expiredAction: ActionType.DISCARD | ActionType.INSPECT,
    hideSafe: boolean
  ): AnalysisResult {
    const today = new Date();
    today.setHours(0,0,0,0);
    const buckets = { expired: [], use_today: [], use_this_week: [], at_risk: [], safe: [] } as any;
    const zero_stock_items: StockItem[] = [];

    items.forEach(item => {
      if (item.qty <= 0) { zero_stock_items.push(item); return; }
      const expiry = new Date(item.useByDate);
      expiry.setHours(0,0,0,0);
      const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 3600 * 24));
      if (diffDays < 0) buckets.expired.push(item);
      else if (diffDays <= thresholds.useTodayMax) buckets.use_today.push(item);
      else if (diffDays <= thresholds.useThisWeekMax) buckets.use_this_week.push(item);
      else if (diffDays <= thresholds.atRiskMax) buckets.at_risk.push(item);
      else buckets.safe.push(item);
    });

    const today_actions: ActionItem[] = [];
    const prioritized = [...buckets.expired, ...buckets.use_today, ...buckets.use_this_week, ...buckets.at_risk]
      .sort((a, b) => new Date(a.useByDate).getTime() - new Date(b.useByDate).getTime()).slice(0, 50);

    prioritized.forEach(item => {
      const expiry = new Date(item.useByDate);
      expiry.setHours(0,0,0,0);
      const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 3600 * 24));
      let action: ActionType = ActionType.USE;
      let urgency: Urgency = Urgency.LOW;
      let reason = '';
      let note = '';

      if (diffDays < 0) {
        action = expiredAction; urgency = Urgency.HIGH; reason = `Expired ${Math.abs(diffDays)}d ago.`;
        note = action === ActionType.DISCARD ? "CRITICAL: Dispose now." : "Inspect before use.";
      } else if (diffDays <= thresholds.useTodayMax) {
        action = ActionType.USE; urgency = Urgency.HIGH; reason = diffDays === 0 ? "Expires today." : "Near expiry.";
        note = "PRIORITY: Use in prep today.";
      } else if (diffDays <= thresholds.useThisWeekMax) {
        action = ActionType.DISCOUNT; urgency = Urgency.MEDIUM; reason = "Expires this week.";
        note = "Discount or process.";
      } else {
        action = ActionType.INSPECT; urgency = Urgency.LOW; reason = "Short remaining life.";
        note = "Check rotation.";
      }

      today_actions.push({
        item_ref: item.id, description: item.description, recommended_action: action,
        urgency, reason, suggested_note_for_staff: note, qty: item.qty, unit: item.unit, useByDate: item.useByDate
      });
    });

    return {
      buckets, today_actions, zero_stock_items,
      reorder_suggestions: [],
      insights: [
        { title: "Manual Check Required", detail: `${buckets.expired.length} expired items were identified in current stock.` },
        { title: "High Urgency", detail: `${buckets.use_today.length} items are due for production or use today.` }
      ]
    };
  }
}

export const geminiService = new GeminiService();
