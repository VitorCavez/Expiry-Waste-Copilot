import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  AppState, 
  MappingResult, 
  NormalizedData, 
  AnalysisResult, 
  StockItem, 
  ActionType, 
  Urgency,
  WasteEvent,
  DebugLog,
  ColumnMapping, 
  Thresholds, 
  ReorderSettings,
  RoiSettings,
  ViewType,
  UserSegment,
  UserProfile,
  AuthStep
} from './types';
import { 
  DEFAULT_THRESHOLDS, 
  DEFAULT_REORDER_SETTINGS,
  MAPPING_FIELDS, 
  WASTE_REASONS, 
  SAMPLE_CSV_CONTENT, 
  ONBOARDING_STEPS, 
  FINANCIAL_ASSUMPTIONS 
} from './constants';
import { fileService } from './services/fileService';
import { geminiService } from './services/geminiService';
import { authService } from './services/authService';
import { runAutomatedTests } from './services/testService';

// --- Icons ---
const IconUpload = () => <svg className="w-12 h-12 mb-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>;
const IconSettings = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 00-1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543 0.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
const IconPlay = () => <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>;

const StepIndicator: React.FC<{ current: number }> = ({ current }) => {
  const steps = ["Upload", "Map", "Verify", "Dashboard"];
  return (
    <div className="flex items-center justify-center space-x-4 mb-8 no-print">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div className={`flex items-center space-x-2 ${i <= current ? 'text-indigo-600' : 'text-slate-400'}`}>
            <span className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${i <= current ? 'border-indigo-600 bg-indigo-50 font-bold' : 'border-slate-300'}`}>
              {i + 1}
            </span>
            <span className="hidden md:inline font-medium">{s}</span>
          </div>
          {i < steps.length - 1 && <div className={`w-12 h-0.5 ${i < current ? 'bg-indigo-600' : 'bg-slate-200'}`} />}
        </React.Fragment>
      ))}
    </div>
  );
};

export default function App() {
  const [step, setStep] = useState(0); 
  const [state, setState] = useState<AppState>(() => {
    const logs = localStorage.getItem('copilot_waste_logs');
    const storedSettings = localStorage.getItem('copilot_settings');
    const user = authService.getSession();
    const hasKey = !!process.env.API_KEY && process.env.API_KEY.length > 5;
    
    const settings = storedSettings ? JSON.parse(storedSettings) : {
      thresholds: DEFAULT_THRESHOLDS,
      reorderSettings: DEFAULT_REORDER_SETTINGS,
      roiSettings: {
        defaultValuePerKg: FINANCIAL_ASSUMPTIONS.avgValuePerKg,
        defaultValuePerEach: FINANCIAL_ASSUMPTIONS.avgValuePerEa,
        currency: "€"
      },
      defaultExpiredAction: ActionType.DISCARD,
      hideSafeItems: true,
      showZeroStock: false,
      isMockMode: !hasKey,
      dashboardFilter: 'all',
      aiAssistEnabled: false
    };

    return {
      currentView: 'landing', 
      isAuthenticated: !!user,
      isDemoMode: false,
      user: user,
      currentBatchId: null,
      rawHeaders: [],
      rawRows: [],
      mappingResult: null,
      normalizedData: null,
      analysisResult: null,
      wasteLogs: logs ? JSON.parse(logs) : [],
      thresholds: settings.thresholds || DEFAULT_THRESHOLDS,
      reorderSettings: settings.reorderSettings || DEFAULT_REORDER_SETTINGS,
      roiSettings: settings.roiSettings || {
        defaultValuePerKg: FINANCIAL_ASSUMPTIONS.avgValuePerKg,
        defaultValuePerEach: FINANCIAL_ASSUMPTIONS.avgValuePerEa,
        currency: "€"
      },
      defaultExpiredAction: settings.defaultExpiredAction || ActionType.DISCARD,
      hideSafeItems: settings.hideSafeItems !== undefined ? settings.hideSafeItems : true,
      showZeroStock: settings.showZeroStock !== undefined ? settings.showZeroStock : false,
      isMockMode: settings.isMockMode !== undefined ? settings.isMockMode : !hasKey,
      dashboardFilter: settings.dashboardFilter || 'all',
      debugLogs: [],
      aiAssistEnabled: settings.aiAssistEnabled || false
    };
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [wasteModalItem, setWasteModalItem] = useState<any>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [generatingInsights, setGeneratingInsights] = useState(false);
  
  // Auth State
  const [authModal, setAuthModal] = useState<{ isOpen: boolean; step: AuthStep; email: string; error: string; resendTimer: number }>({
    isOpen: false,
    step: 'EMAIL_INPUT',
    email: '',
    error: '',
    resendTimer: 0
  });

  const [mappingErrors, setMappingErrors] = useState<Record<string, string>>({});
  
  // Undo State
  const [lastLoggedWasteId, setLastLoggedWasteId] = useState<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Landing Page Personalization State
  const [utmSource, setUtmSource] = useState<string | null>(() => localStorage.getItem('last_utm_source'));
  const [segment, setSegment] = useState<UserSegment>(() => (localStorage.getItem('last_segment') as UserSegment) || 'butcher');

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const utm = params.get('utm_source') || params.get('ref');
    if (utm) {
      setUtmSource(utm);
      localStorage.setItem('last_utm_source', utm);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('last_segment', segment);
  }, [segment]);

  useEffect(() => {
    geminiService.setDebugLogger((log) => {
      setState(prev => ({ ...prev, debugLogs: [log, ...prev.debugLogs].slice(0, 50) }));
    });
    runAutomatedTests();
  }, []);

  useEffect(() => {
    localStorage.setItem('copilot_waste_logs', JSON.stringify(state.wasteLogs));
  }, [state.wasteLogs]);

  useEffect(() => {
    const settings = {
      thresholds: state.thresholds,
      reorderSettings: state.reorderSettings,
      roiSettings: state.roiSettings,
      defaultExpiredAction: state.defaultExpiredAction,
      hideSafeItems: state.hideSafeItems,
      showZeroStock: state.showZeroStock,
      isMockMode: state.isMockMode,
      dashboardFilter: state.dashboardFilter,
      aiAssistEnabled: state.aiAssistEnabled
    };
    localStorage.setItem('copilot_settings', JSON.stringify(settings));
  }, [state.thresholds, state.reorderSettings, state.roiSettings, state.defaultExpiredAction, state.hideSafeItems, state.showZeroStock, state.isMockMode, state.dashboardFilter, state.aiAssistEnabled]);

  useEffect(() => {
    if (state.mappingResult && state.rawHeaders.length > 0) {
      const updatedMapping = { ...state.mappingResult.mapping };
      let changed = false;

      MAPPING_FIELDS.forEach(field => {
        const currentHeader = (updatedMapping as any)[field.key];
        const isHeaderValid = currentHeader && state.rawHeaders.includes(currentHeader);
        
        if (currentHeader && !isHeaderValid) {
          (updatedMapping as any)[field.key] = field.required ? '' : '__none__';
          changed = true;
        } else if (!currentHeader) {
          (updatedMapping as any)[field.key] = field.required ? '' : '__none__';
          changed = true;
        }
      });

      if (changed) {
        setState(prev => ({
          ...prev,
          mappingResult: {
            ...prev.mappingResult!,
            mapping: updatedMapping as ColumnMapping
          }
        }));
      }
    }
  }, [state.rawHeaders]);

  const validateMapping = useCallback(() => {
    const errors: Record<string, string> = {};
    if (!state.mappingResult) return false;

    const mapping = state.mappingResult.mapping as any;

    MAPPING_FIELDS.forEach(f => {
      if (f.key === 'qty') return;
      const val = mapping[f.key];
      if (f.required && (!val || val === '__none__')) {
        errors[f.key] = 'Required field missing mapping';
      }
    });

    if (mapping.qtyMode === 'single') {
       if (!mapping.qty || mapping.qty === '__none__') errors['qty'] = 'Column required for Single Mode';
    } else {
       if (mapping.unit === '__none__' || !mapping.unit) errors['unit'] = 'Unit column required for Smart Mode';
       if (!mapping.qtyKg || mapping.qtyKg === '__none__') errors['qtyKg'] = 'Weight column required';
       if (!mapping.qtyEach || mapping.qtyEach === '__none__') errors['qtyEach'] = 'Count column required';
    }

    const useByHeader = mapping['use_by_date'];
    if (useByHeader && useByHeader !== '__none__') {
      const sampleValues = state.rawRows.slice(0, 5).map(r => r[useByHeader]);
      const hasValidDate = sampleValues.some(v => geminiService.parseDate(v) !== null);
      if (!hasValidDate) {
        errors['use_by_date'] = `Selected column '${useByHeader}' doesn't appear to contain valid dates.`;
      }
    }

    setMappingErrors(errors);
    return Object.keys(errors).length === 0;
  }, [state.mappingResult, state.rawRows]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | null, sampleData?: string, forceMockOverride?: boolean) => {
    let file: File | null = null;
    if (sampleData) {
      file = new File([sampleData], "sample_stock.csv", { type: 'text/csv' });
    } else {
      file = e?.target.files?.[0] || null;
    }
    if (!file) return;
    setIsProcessing(true);
    try {
      const { headers, rows } = await fileService.parseFile(file);
      // Gemini mapping uses AI Assist toggle and internal budgeting
      const mapping = await geminiService.mapColumns(headers, rows.slice(0, 5), state.aiAssistEnabled);
      setState(prev => ({ ...prev, rawHeaders: headers, rawRows: rows, mappingResult: mapping }));
      setStep(1);
    } catch (err: any) {
      showToast("Error processing file structure: " + err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateMapping = (field: string, header: any) => {
    if (!state.mappingResult) return;
    const newMapping = { ...state.mappingResult.mapping, [field]: header };
    setState(prev => ({ ...prev, mappingResult: { ...prev.mappingResult!, mapping: newMapping as ColumnMapping } }));
    setMappingErrors(prev => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  };

  const proceedToNormalization = async () => {
    if (!validateMapping()) return;
    
    setIsProcessing(true);
    const normalized = await geminiService.normalizeRows(state.mappingResult!.mapping, state.rawRows);
    setState(prev => ({ ...prev, normalizedData: normalized }));
    setStep(2);
    setIsProcessing(false);
  };

  const proceedToDashboard = async () => {
    if (!state.normalizedData) return;
    setIsProcessing(true);
    const analysis = await geminiService.analyze(
      state.normalizedData.normalized_items, 
      state.thresholds, 
      state.reorderSettings,
      state.defaultExpiredAction,
      state.hideSafeItems,
      state.isMockMode
    );
    setState(prev => ({ ...prev, analysisResult: analysis }));
    setStep(3);
    setIsProcessing(false);
  };

  const handleGenerateAiInsights = async () => {
    if (!state.analysisResult) return;
    setGeneratingInsights(true);
    const summary = {
      expired: state.analysisResult.buckets.expired.length,
      use_today: state.analysisResult.buckets.use_today.length,
      use_this_week: state.analysisResult.buckets.use_this_week.length,
      total: state.normalizedData?.summary_counts.items_out || 0,
      errors: state.normalizedData?.summary_counts.errors || 0
    };
    const aiInsights = await geminiService.generateDashboardInsights(summary, state.aiAssistEnabled);
    if (aiInsights.length > 0) {
      setState(prev => ({
        ...prev,
        analysisResult: {
          ...prev.analysisResult!,
          insights: [...aiInsights, ...prev.analysisResult!.insights].slice(0, 5)
        }
      }));
      showToast("AI Insights refreshed", "success");
    } else if (state.aiAssistEnabled) {
      showToast("AI Assist unavailable. Budget reached or cooldown active.", "info");
    }
    setGeneratingInsights(false);
  };

  const handleMarkWasted = (item: any, reason: string, qty: number) => {
    const eventId = `waste-${Date.now()}`;
    const newEvent: WasteEvent = {
      id: eventId,
      date: new Date().toISOString(),
      stockItemDescription: item.description,
      qtyWasted: qty,
      unit: item.unit,
      reason
    };
    
    setState(prev => ({ ...prev, wasteLogs: [newEvent, ...prev.wasteLogs] }));
    setLastLoggedWasteId(eventId);
    
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      setLastLoggedWasteId(null);
    }, 10000);

    setWasteModalItem(null);
  };

  const handleUndoWaste = () => {
    if (!lastLoggedWasteId) return;
    setState(prev => ({
      ...prev,
      wasteLogs: prev.wasteLogs.filter(l => l.id !== lastLoggedWasteId)
    }));
    setLastLoggedWasteId(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  };

  const roiValue = useMemo(() => {
    if (!state.analysisResult) return null;
    const allItems = Object.values(state.analysisResult.buckets).flat() as StockItem[];
    const { defaultValuePerKg, defaultValuePerEach } = state.roiSettings;
    
    if (!defaultValuePerKg && !defaultValuePerEach) return null;

    let total = 0;
    let hasValidCalculation = false;

    allItems.forEach(item => {
      const unit = item.unit.toLowerCase();
      const isKg = unit.includes('kg') || unit.includes('kilo');
      const isEa = unit.includes('ea') || unit.includes('each') || unit.includes('unit') || unit.includes('pack');
      
      if (isKg && defaultValuePerKg !== undefined && !isNaN(defaultValuePerKg) && defaultValuePerKg > 0) {
        total += item.qty * defaultValuePerKg;
        hasValidCalculation = true;
      } else if (isEa && defaultValuePerEach !== undefined && !isNaN(defaultValuePerEach) && defaultValuePerEach > 0) {
        total += item.qty * defaultValuePerEach;
        hasValidCalculation = true;
      }
    });

    return hasValidCalculation && total > 0 ? total : null;
  }, [state.analysisResult, state.roiSettings]);

  const qualityMetrics = useMemo(() => {
    if (!state.normalizedData || !state.analysisResult) return null;
    
    const total = state.normalizedData.summary_counts.rows_in;
    const normalizationErrors = state.normalizedData.row_issues;
    const zeroStock = state.analysisResult.zero_stock_items;
    
    const buckets = state.analysisResult.buckets;
    const included = (buckets.expired?.length || 0) + 
                     (buckets.use_today?.length || 0) + 
                     (buckets.use_this_week?.length || 0) + 
                     (buckets.at_risk?.length || 0) + 
                     (buckets.safe?.length || 0);
    
    const excluded = total - included;
    const excludedPercent = total > 0 ? (excluded / total) * 100 : 0;
    
    let statusLabel = "Needs Review";
    let statusColor = "text-red-600 bg-red-50 border-red-100";
    if (excludedPercent <= 2) {
      statusLabel = "Great";
      statusColor = "text-green-600 bg-green-50 border-green-100";
    } else if (excludedPercent <= 10) {
      statusLabel = "OK";
      statusColor = "text-amber-600 bg-amber-50 border-amber-100";
    }

    const breakdown = {
      missingDesc: normalizationErrors.filter(e => e.issue_code === 'MISSING_DESC').length,
      invalidQty: normalizationErrors.filter(e => e.issue_code === 'INVALID_QTY' || e.issue_code === 'INVALID_QTY_FOR_UNIT').length,
      invalidDate: normalizationErrors.filter(e => e.issue_code === 'INVALID_DATE').length,
      zeroStock: zeroStock.length,
    };

    return { total, included, excluded, excludedPercent, statusLabel, statusColor, breakdown, normalizationErrors, zeroStock };
  }, [state.normalizedData, state.analysisResult]);

  const getBucketLabel = (b: string) => {
    if (b === 'at_risk') return 'Use next week';
    return b.replace('_', ' ');
  };

  const focusedTotals = useMemo(() => {
    if (!state.analysisResult) return null;
    const filter = state.dashboardFilter;
    let items: StockItem[] = [];
    
    if (filter === 'all') {
      items = [
        ...state.analysisResult.buckets.expired,
        ...state.analysisResult.buckets.use_today,
        ...state.analysisResult.buckets.use_this_week,
        ...state.analysisResult.buckets.at_risk,
        ...state.analysisResult.buckets.safe
      ];
    } else {
      items = (state.analysisResult.buckets as any)[filter] || [];
    }

    const totals: Record<string, number> = {};
    items.forEach(item => {
      const u = (item.unit || 'unit').toLowerCase();
      totals[u] = (totals[u] || 0) + item.qty;
    });
    return totals;
  }, [state.analysisResult, state.dashboardFilter]);

  const focusedValue = useMemo(() => {
    if (!state.analysisResult) return 0;
    const filter = state.dashboardFilter;
    let items: StockItem[] = [];
    if (filter === 'all') {
      items = Object.values(state.analysisResult.buckets).flat() as StockItem[];
    } else {
      items = (state.analysisResult.buckets as any)[filter] || [];
    }
    const { defaultValuePerKg, defaultValuePerEach } = state.roiSettings;
    let total = 0;
    items.forEach(item => {
      const unit = item.unit.toLowerCase();
      const isKg = unit.includes('kg') || unit.includes('kilo');
      const isEa = unit.includes('ea') || unit.includes('each') || unit.includes('unit') || unit.includes('pack');
      if (isKg && defaultValuePerKg) total += item.qty * defaultValuePerKg;
      else if (isEa && defaultValuePerEach) total += item.qty * defaultValuePerEach;
    });
    return total;
  }, [state.analysisResult, state.dashboardFilter, state.roiSettings]);

  const handleReturn = () => {
    if (step === 1 || step === 2) setStep(step - 1);
    else if (step === 4 || step === 5) setStep(3);
  };

  const handlePrint = () => {
    if (!state.analysisResult || state.analysisResult.today_actions.length === 0) {
      showToast("No items to print.", 'info');
      return;
    }
    window.print();
  };

  const handleExportPickerCSV = () => {
    if (!state.analysisResult || state.analysisResult.today_actions.length === 0) {
      showToast("No items to export.", 'info');
      return;
    }

    const getBucketForItem = (itemRef: string) => {
      if (!state.analysisResult) return 'N/A';
      const { buckets } = state.analysisResult;
      if (buckets.expired.some(i => i.id === itemRef)) return 'Expired';
      if (buckets.use_today.some(i => i.id === itemRef)) return 'Use Today';
      if (buckets.use_this_week.some(i => i.id === itemRef)) return 'Use This Week';
      if (buckets.at_risk.some(i => i.id === itemRef)) return 'Use Next Week';
      if (buckets.safe?.some(i => i.id === itemRef)) return 'Safe';
      return 'N/A';
    };

    const actionsToExport = state.showZeroStock 
      ? state.analysisResult.today_actions 
      : state.analysisResult.today_actions.filter(a => a.qty > 0);

    const csvData = actionsToExport.map(a => ({
      'Item Description': a.description,
      'Location': state.normalizedData?.normalized_items.find(ni => ni.id === a.item_ref)?.location || 'N/A',
      'Qty': a.qty,
      'Unit': a.unit,
      'Expiry Date': a.useByDate,
      'Bucket': getBucketForItem(a.item_ref),
      'Recommended Action': a.recommended_action,
      'Staff Note': a.suggested_note_for_staff
    }));

    const todayStr = new Date().toISOString().split('T')[0];
    fileService.downloadCSV(`expiry_copilot_picker_list_${todayStr}.csv`, csvData);
  };

  const handleExportWasteCSV = () => {
    if (state.wasteLogs.length === 0) {
      showToast("No waste logs to export.", 'info');
      return;
    }

    const csvData = state.wasteLogs.map(l => ({
      'Date': new Date(l.date).toLocaleString(),
      'Item Description': l.stockItemDescription,
      'Qty': l.qtyWasted,
      'Unit': l.unit,
      'Reason': l.reason
    }));

    const todayStr = new Date().toISOString().split('T')[0];
    fileService.downloadCSV(`expiry_copilot_waste_log_${todayStr}.csv`, csvData);
  };

  const handleTestConnection = async () => {
    showToast("Testing Gemini Connection...", "info");
    const result = await geminiService.testConnection();
    if (result.success) {
      showToast("Gemini Connection Successful", "success");
    } else {
      showToast("Diagnostic Failed: " + result.message, "error");
      setState(prev => ({ ...prev, isMockMode: true }));
    }
  };

  const updateThreshold = (key: keyof Thresholds, value: string) => {
    let num = parseInt(value);
    if (isNaN(num)) return;
    if (num < 0) num = 0;

    setState(prev => {
      const nextThresholds = { ...prev.thresholds, [key]: num };
      if (key === 'useTodayMax') {
        if (nextThresholds.useThisWeekMax < num) nextThresholds.useThisWeekMax = num;
        if (nextThresholds.atRiskMax < nextThresholds.useThisWeekMax) nextThresholds.atRiskMax = nextThresholds.useThisWeekMax;
      } else if (key === 'useThisWeekMax') {
        if (num < nextThresholds.useTodayMax) nextThresholds.useTodayMax = num;
        if (nextThresholds.atRiskMax < num) nextThresholds.atRiskMax = num;
      } else if (key === 'atRiskMax') {
        if (num < nextThresholds.useThisWeekMax) nextThresholds.useThisWeekMax = num;
        if (nextThresholds.useThisWeekMax < nextThresholds.useTodayMax) nextThresholds.useTodayMax = nextThresholds.useThisWeekMax;
      }
      return { ...prev, thresholds: nextThresholds };
    });
  };

  const updateReorderSetting = (key: keyof ReorderSettings, value: any) => {
    setState(prev => ({
      ...prev,
      reorderSettings: { ...prev.reorderSettings, [key]: value }
    }));
  };

  const updateRoiSetting = (key: keyof RoiSettings, value: any) => {
    setState(prev => ({
      ...prev,
      roiSettings: { ...prev.roiSettings, [key]: value }
    }));
  };

  const handleLogout = () => {
    authService.logout();
    setState(prev => ({ ...prev, isAuthenticated: false, user: null, isDemoMode: false, currentView: 'landing' }));
  };

  const handleGetStarted = () => {
    if (state.isAuthenticated) {
      setState(prev => ({ ...prev, currentView: 'app', isDemoMode: false }));
    } else {
      setAuthModal(prev => ({ ...prev, isOpen: true, error: '' }));
    }
  };

  const handleRequestOtp = async (email: string) => {
    if (!email) {
      setAuthModal(prev => ({ ...prev, error: 'Please enter your email.' }));
      return;
    }
    setAuthModal(prev => ({ ...prev, step: 'VERIFYING', error: '' }));
    const res = await authService.sendMagicLink(email);
    if (res.success) {
      setAuthModal(prev => ({ ...prev, step: 'CHECK_EMAIL', email, resendTimer: 30 }));
    } else {
      setAuthModal(prev => ({ ...prev, step: 'EMAIL_INPUT', error: res.message }));
    }
  };

  const handleVerifyOtp = async (otp: string) => {
    setAuthModal(prev => ({ ...prev, step: 'VERIFYING', error: '' }));
    const res = await authService.verifyOtp(authModal.email, otp);
    if (res.success && res.user) {
      setState(prev => ({ ...prev, isAuthenticated: true, user: res.user!, currentView: 'app', isDemoMode: false }));
      setAuthModal(prev => ({ ...prev, isOpen: false, step: 'EMAIL_INPUT', email: '' }));
    } else {
      setAuthModal(prev => ({ ...prev, step: 'CHECK_EMAIL', error: res.error || 'Invalid code.' }));
    }
  };

  const handleDevSignIn = async () => {
    const user = await authService.devSignIn();
    setState(prev => ({ ...prev, isAuthenticated: true, user, currentView: 'app', isDemoMode: false }));
    setAuthModal(prev => ({ ...prev, isOpen: false }));
  };

  const handleTryDemo = () => {
    setState(prev => ({ ...prev, currentView: 'app', isDemoMode: true, isMockMode: true }));
    handleFileUpload(null, SAMPLE_CSV_CONTENT, true);
  };

  const renderLandingPage = () => {
    const dynamicHeadline = utmSource === 'kickstarter' 
      ? "Early Founder Access to the Future of Cold Storage."
      : utmSource === 'linkedin'
      ? "Protect Your Margins. Eliminate Operational Risk."
      : utmSource === 'google'
      ? "From Stock Sheet to Action List in 15 Minutes."
      : "Expiry Management on Autopilot.";

    const dynamicSub = utmSource === 'kickstarter'
      ? "Lifetime access for early backers. Scale your inventory intelligence today."
      : "Turn complex spreadsheets into prioritized daily picker lists with AI.";

    const segmentBullets = {
      butcher: [
        { title: "Manage Kill Dates", desc: "Automated shelf-life calculation based on slaughter data." },
        { title: "Bulk Inventory Insights", desc: "Instantly see exposure across 100s of SKUs and cold rooms." },
        { title: "Cold Store Optimization", desc: "Reduce waste by prioritizing FIFO for high-value primals." }
      ],
      cafe: [
        { title: "Daily Prep Automation", desc: "Know exactly what needs using before your morning rush." },
        { title: "Minimize Food Waste", desc: "Track fresh ingredients and deli meats with precision." },
        { title: "Fresh Rotation", desc: "Ensure your front-of-house is serving the absolute freshest stock." }
      ],
      grocer: [
        { title: "Shelf-life Tracking", desc: "Monitor 1000s of units across multiple departments." },
        { title: "Margin Protection", desc: "Identify items at risk of markdown before they expire." },
        { title: "Inventory Scales", desc: "Unified view of weight-based and unit-based stock." }
      ]
    }[segment];

    return (
      <div className="min-h-screen flex flex-col bg-white overflow-hidden selection:bg-indigo-100">
        <nav className="max-w-7xl mx-auto w-full p-8 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="bg-indigo-900 p-1.5 rounded-xl shadow-sm">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" /></svg>
            </div>
            <span className="font-black text-xl tracking-tight text-slate-900">Expiry Copilot</span>
          </div>
          <div className="flex items-center space-x-6">
            <button onClick={() => setAuthModal(prev => ({ ...prev, isOpen: true }))} className="text-sm font-bold text-slate-500 hover:text-indigo-600 transition">Log In</button>
            <button onClick={handleGetStarted} className="bg-indigo-900 text-white px-6 py-2.5 rounded-full text-sm font-bold hover:bg-slate-800 shadow-xl shadow-indigo-100 transition">Sign Up Free</button>
          </div>
        </nav>

        <main className="flex-grow max-w-7xl mx-auto w-full px-8 py-20 flex flex-col items-center text-center">
          <div className="max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="flex flex-wrap justify-center gap-3 mb-4">
              {[
                { id: 'butcher', label: 'Butcher / Cold Store' },
                { id: 'cafe', label: 'Café / Deli' },
                { id: 'grocer', label: 'Small Grocer' }
              ].map(s => (
                <button 
                  key={s.id}
                  onClick={() => setSegment(s.id as UserSegment)}
                  className={`px-5 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all border-2 ${
                    segment === s.id ? 'bg-indigo-50 border-indigo-600 text-indigo-600' : 'bg-slate-50 border-transparent text-slate-400 hover:border-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <h1 className="text-6xl md:text-8xl font-black text-slate-900 tracking-tight leading-[1.05]">
              {dynamicHeadline}
            </h1>
            <p className="text-xl md:text-2xl text-slate-500 font-medium max-w-2xl mx-auto leading-relaxed">
              {dynamicSub}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-6">
              <button 
                onClick={handleGetStarted}
                className="w-full sm:w-auto px-12 py-5 bg-indigo-900 text-white rounded-2xl font-black text-lg hover:bg-slate-800 shadow-2xl shadow-indigo-200 transition-all hover:scale-[1.03]"
              >
                Get Started Now
              </button>
              <button 
                onClick={handleTryDemo}
                className="w-full sm:w-auto px-10 py-5 bg-white text-indigo-600 border-2 border-indigo-100 rounded-2xl font-black text-lg hover:bg-indigo-50 transition-all"
              >
                Try Demo
              </button>
            </div>

            <p className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em] pt-4">
              TRUSTED BY 2,000+ COLD STORES NATIONWIDE
            </p>

            <div className="grid md:grid-cols-3 gap-12 pt-24 text-left border-t border-slate-100">
              {segmentBullets.map((b, i) => (
                <div key={i} className="space-y-4 group">
                  <div className="w-10 h-10 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-500">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <h3 className="text-lg font-black text-slate-900">{b.title}</h3>
                  <p className="text-slate-500 font-medium leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </main>

        <footer className="p-12 text-center text-[10px] uppercase font-black text-slate-300 tracking-[0.3em]">
          Expiry & Waste Copilot © 2026 // Next-Gen Inventory Intelligence
        </footer>
      </div>
    );
  };

  const renderAppHeader = () => (
    <header className="bg-indigo-900 text-white p-4 shadow-lg sticky top-0 z-50 no-print">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <button onClick={() => setState(prev => ({ ...prev, currentView: 'landing' }))} className="bg-white p-1 rounded-lg shadow-sm hover:scale-105 transition-transform">
            <svg className="w-6 h-6 text-indigo-900" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" /></svg>
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight">Expiry Copilot</h1>
            {state.user && <span className="text-[9px] font-black text-indigo-300 uppercase tracking-widest">Plan: {state.user.accessTier}</span>}
            {state.isDemoMode && <span className="text-[9px] font-black text-amber-300 uppercase tracking-widest">Demo Mode</span>}
          </div>
        </div>
        <div className="flex items-center space-x-4">
          {!state.isDemoMode && (
            <button onClick={() => setShowDebug(true)} className="text-xs bg-indigo-800 hover:bg-indigo-700 px-2 py-1 rounded transition">Debug Log</button>
          )}
          <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-indigo-800 rounded-full transition"><IconSettings /></button>
          {step > 0 && <button onClick={() => setStep(0)} className="text-sm font-medium hover:text-indigo-200">Reset</button>}
          <button onClick={handleLogout} className="text-xs opacity-50 hover:opacity-100 font-bold transition">
            {state.isDemoMode ? 'Exit Demo' : 'Logout'}
          </button>
        </div>
      </div>
    </header>
  );

  if (state.currentView === 'app' && !state.isAuthenticated && !state.isDemoMode) {
    return (
      <>
        {renderLandingPage()}
        <AuthModal 
          authModal={{ ...authModal, isOpen: true, error: 'Please sign in to access the dashboard.' }} 
          setAuthModal={setAuthModal}
          handleRequestOtp={handleRequestOtp}
          handleVerifyOtp={handleVerifyOtp}
          handleDevSignIn={handleDevSignIn}
        />
      </>
    );
  }

  const printTotals = useMemo(() => {
    if (!state.analysisResult) return { count: 0, kg: 0, ea: 0 };
    const items = state.analysisResult.today_actions;
    return items.reduce((acc, curr) => {
      acc.count++;
      if (curr.unit.toLowerCase().includes('kg')) acc.kg += curr.qty;
      if (curr.unit.toLowerCase().includes('ea') || curr.unit.toLowerCase().includes('each')) acc.ea += curr.qty;
      return acc;
    }, { count: 0, kg: 0, ea: 0 });
  }, [state.analysisResult]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {state.currentView === 'landing' ? (
        <>
          {renderLandingPage()}
          <AuthModal 
            authModal={authModal} 
            setAuthModal={setAuthModal}
            handleRequestOtp={handleRequestOtp}
            handleVerifyOtp={handleVerifyOtp}
            handleDevSignIn={handleDevSignIn}
          />
        </>
      ) : (
        <>
          {renderAppHeader()}
          {state.isDemoMode && (
            <div className="bg-amber-100 text-amber-900 text-center py-2 text-xs font-bold no-print border-b border-amber-200">
              Demo mode (no login required). Upload + mapping uses mock AI.
            </div>
          )}
          <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:p-8 relative">
            {step !== 0 && step !== 3 && (
              <div className="absolute top-4 right-4 md:top-8 md:right-8 z-10 no-print">
                <button
                  onClick={handleReturn}
                  className="flex items-center space-x-2 text-slate-400 hover:text-indigo-600 font-bold transition-all group"
                  title="Return to Previous Page"
                >
                  <span className="text-[10px] uppercase tracking-[0.15em] opacity-0 group-hover:opacity-100 transition-opacity">Return</span>
                  <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-200 group-hover:border-indigo-200 group-hover:shadow-md transition-all">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </div>
                </button>
              </div>
            )}

            {isProcessing ? (
              <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-slate-600 font-medium">Processing Data...</p>
              </div>
            ) : (
              <>
                {step === 0 && (
                  <div className="max-w-5xl mx-auto py-6">
                    <div className="text-center mb-10">
                      <h2 className="text-5xl font-black text-slate-900 mb-4 tracking-tight">Management Dashboard</h2>
                      <p className="text-xl text-slate-600 max-w-2xl mx-auto">Upload your current inventory to generate action plans.</p>
                    </div>
                    <div className="grid md:grid-cols-2 gap-10 items-center">
                      <div className="space-y-8">
                        <div className="bg-white p-12 rounded-[2rem] shadow-2xl border-4 border-dashed border-slate-200 hover:border-indigo-400 transition cursor-pointer relative group">
                          <input type="file" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept=".csv,.xlsx,.xls" />
                          <div className="flex flex-col items-center text-center">
                            <IconUpload />
                            <p className="text-2xl font-black text-slate-800 group-hover:text-indigo-600 transition">Drop your Stock Sheet</p>
                            <p className="text-slate-500 mt-2">CSV, XLSX or XLS files supported</p>
                          </div>
                        </div>
                        <div className="flex flex-col space-y-4">
                          <button 
                            onClick={() => handleFileUpload(null, SAMPLE_CSV_CONTENT)} 
                            className="flex items-center justify-center space-x-3 bg-indigo-50 text-indigo-700 py-4 px-6 rounded-2xl font-bold hover:bg-indigo-100 transition border-2 border-indigo-100 shadow-sm"
                          >
                            <IconPlay />
                            <span>Try with sample data (Dublin Cold Store Sheet)</span>
                          </button>
                        </div>
                      </div>
                      <div className="bg-white p-10 rounded-[2rem] shadow-xl border border-slate-100 space-y-6">
                        <h3 className="text-xl font-black text-slate-900 border-b pb-4">Guided Workflow</h3>
                        <div className="space-y-6">
                          {ONBOARDING_STEPS.map((s, idx) => (
                            <div key={idx} className="flex items-start space-x-4">
                              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold flex-shrink-0">{idx + 1}</div>
                              <div>
                                <p className="font-bold text-slate-800">{s.title}</p>
                                <p className="text-sm text-slate-500">{s.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {step === 1 && state.mappingResult && (
                  <div className="max-w-4xl mx-auto">
                    <StepIndicator current={1} />
                    <div className={`border-l-4 p-4 mb-6 rounded-r-2xl animate-in fade-in slide-in-from-top-2 ${
                      state.mappingResult?.isAiGenerated ? 'bg-indigo-50 border-indigo-400' : 'bg-amber-50 border-amber-400'
                    }`}>
                      <div className="flex items-center">
                        <div className="flex-shrink-0">
                          {state.mappingResult?.isAiGenerated ? (
                            <svg className="h-5 w-5 text-indigo-400" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1a1 1 0 112 0v1a1 1 0 11-2 0zM13.536 15.657a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414l.707.707z" /></svg>
                          ) : (
                            <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1-1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                          )}
                        </div>
                        <div className="ml-3">
                          <p className={`text-sm font-bold ${state.mappingResult?.isAiGenerated ? 'text-indigo-700' : 'text-amber-700'}`}>
                            {state.mappingResult?.isAiGenerated 
                              ? "AI Assist identified column mappings automatically. Please review below."
                              : "AI Assist unavailable or disabled. Using deterministic rules. Review mappings before validating."}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200">
                      <div className="p-8 bg-slate-50 border-b flex justify-between items-center">
                        <div>
                          <h3 className="text-2xl font-black text-slate-800">Identify Columns</h3>
                          <p className="text-slate-500 text-sm">We've mapped your data structure. Please verify <b>Required</b> fields.</p>
                        </div>
                        <button 
                          onClick={proceedToNormalization} 
                          className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-bold hover:bg-indigo-700 shadow-lg transition"
                        >
                          Validate Data
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-widest">
                            <tr><th className="px-8 py-4">Field</th><th className="px-8 py-4">Matched Header</th><th className="px-8 py-4">Status</th></tr>
                          </thead>
                          <tbody className="divide-y">
                            {MAPPING_FIELDS.map(f => {
                              const mapping = state.mappingResult?.mapping as any;
                              const conf = state.mappingResult?.confidence_per_field[f.key] || 0;
                              const currentVal = mapping[f.key];
                              const error = mappingErrors[f.key];
                              
                              if (f.key === 'qty') {
                                return (
                                  <tr key={f.key} className={`hover:bg-slate-50/50 transition ${(error || mappingErrors['qtyKg'] || mappingErrors['qtyEach']) ? 'bg-red-50' : ''}`}>
                                    <td className="px-8 py-5">
                                      <span className="font-bold text-slate-700">Quantity Mapping</span>
                                      <span className="ml-1 text-red-500">*</span>
                                    </td>
                                    <td className="px-8 py-5" colSpan={2}>
                                      <div className="space-y-4">
                                        <div className="flex items-center space-x-6">
                                           <label className="flex items-center space-x-2 cursor-pointer">
                                              <input 
                                                type="radio" 
                                                name="qtyMode" 
                                                checked={mapping.qtyMode === 'single'} 
                                                onChange={() => handleUpdateMapping('qtyMode', 'single')} 
                                                className="text-indigo-600"
                                              />
                                              <span className="text-sm font-bold text-slate-700">Single Column</span>
                                           </label>
                                           <label className="flex items-center space-x-2 cursor-pointer">
                                              <input 
                                                type="radio" 
                                                name="qtyMode" 
                                                checked={mapping.qtyMode === 'by_unit'} 
                                                onChange={() => handleUpdateMapping('qtyMode', 'by_unit')}
                                                className="text-indigo-600"
                                              />
                                              <span className="text-sm font-bold text-slate-700">Smart (by Unit)</span>
                                           </label>
                                        </div>
                                        {mapping.qtyMode === 'single' ? (
                                          <div className="max-w-sm">
                                             <select 
                                              value={mapping.qty || ''} 
                                              onChange={(e) => handleUpdateMapping('qty', e.target.value)}
                                              className={`w-full border-2 rounded-xl p-3 text-sm focus:border-indigo-500 outline-none transition ${error ? 'border-red-300' : 'border-slate-100'}`}
                                            >
                                              <option value="">-- Choose Quantity Header --</option>
                                              {state.rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                            {error && <p className="text-xs text-red-600 mt-1 font-bold">{error}</p>}
                                          </div>
                                        ) : (
                                          <div className="space-y-3">
                                            <div className="grid grid-cols-2 gap-4">
                                              <div>
                                                <label className="text-[9px] uppercase font-black text-slate-400 block mb-1">Weight Column (KG)</label>
                                                <select 
                                                  value={mapping.qtyKg || ''} 
                                                  onChange={(e) => handleUpdateMapping('qtyKg', e.target.value)}
                                                  className={`w-full border-2 rounded-xl p-3 text-sm transition ${mappingErrors['qtyKg'] ? 'border-red-300' : 'border-slate-100'}`}
                                                >
                                                  <option value="">-- Net Weight --</option>
                                                  {state.rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                </select>
                                                {mappingErrors['qtyKg'] && <p className="text-[10px] text-red-600 font-bold mt-1">{mappingErrors['qtyKg']}</p>}
                                              </div>
                                              <div>
                                                <label className="text-[9px] uppercase font-black text-slate-400 block mb-1">Count Column (EACH)</label>
                                                <select 
                                                  value={mapping.qtyEach || ''} 
                                                  onChange={(e) => handleUpdateMapping('qtyEach', e.target.value)}
                                                  className={`w-full border-2 rounded-xl p-3 text-sm transition ${mappingErrors['qtyEach'] ? 'border-red-300' : 'border-slate-100'}`}
                                                >
                                                  <option value="">-- Quantity --</option>
                                                  {state.rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                </select>
                                                {mappingErrors['qtyEach'] && <p className="text-[10px] text-red-600 font-bold mt-1">{mappingErrors['qtyEach']}</p>}
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              }

                              return (
                                <tr key={f.key} className={`hover:bg-slate-50/50 transition ${error ? 'bg-red-50' : ''}`}>
                                  <td className="px-8 py-5">
                                    <span className="font-bold text-slate-700">{f.label}</span>
                                    {f.required && <span className="ml-1 text-red-500">*</span>}
                                  </td>
                                  <td className="px-8 py-5">
                                    <select 
                                      value={currentVal || ''} 
                                      onChange={(e) => handleUpdateMapping(f.key, e.target.value)}
                                      className={`w-full border-2 rounded-xl p-3 text-sm focus:border-indigo-500 outline-none transition ${error ? 'border-red-300' : 'border-slate-100'}`}
                                    >
                                      {f.required ? (
                                        <option value="">-- Choose a Header --</option>
                                      ) : (
                                        <option value="__none__">None (Ignore)</option>
                                      )}
                                      {state.rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                    </select>
                                    {error && <p className="text-xs text-red-600 mt-1 font-bold">{error}</p>}
                                  </td>
                                  <td className="px-8 py-5">
                                    <div className="flex items-center space-x-3">
                                      {currentVal && currentVal !== '__none__' ? (
                                        <>
                                          <div className="flex-grow bg-slate-100 h-2 rounded-full overflow-hidden w-24">
                                            <div className={`h-full ${conf > 0.8 ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${conf * 100}%` }} />
                                          </div>
                                          <span className="text-xs font-mono font-bold">{(conf * 100).toFixed(0)}%</span>
                                        </>
                                      ) : (
                                        <span className="text-xs text-slate-400 font-bold italic">{f.required ? 'Pending' : 'Ignored'}</span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && state.normalizedData && (
                  <div className="max-w-4xl mx-auto">
                    <StepIndicator current={2} />
                    <div className="bg-white rounded-[2rem] shadow-2xl p-10 border border-slate-200">
                       <h3 className="text-3xl font-black mb-2">Verification Complete</h3>
                       <p className="text-slate-500 mb-8">Data has been normalized. Review the summary before calculating risk buckets.</p>
                       <div className="grid grid-cols-3 gap-8 mb-10">
                          <div className="p-8 bg-slate-50 rounded-3xl border text-center">
                            <p className="text-xs font-bold uppercase text-slate-400 mb-1">Stock Rows</p>
                            <p className="text-4xl font-black text-slate-900">{state.normalizedData.summary_counts.rows_in}</p>
                          </div>
                          <div className="p-8 bg-green-50 rounded-3xl border border-green-100 text-center">
                            <p className="text-xs font-bold uppercase text-green-600 mb-1">Analyzable</p>
                            <p className="text-4xl font-black text-green-700">{state.normalizedData.summary_counts.items_out}</p>
                          </div>
                          <div className="p-8 bg-red-50 rounded-3xl border border-red-100 text-center">
                            <p className="text-xs font-bold uppercase text-red-600 mb-1">Excluded</p>
                            <p className="text-4xl font-black text-red-700">{state.normalizedData.summary_counts.errors}</p>
                          </div>
                       </div>
                       <div className="flex justify-between items-center">
                          <button onClick={() => setStep(1)} className="px-6 py-2 font-bold text-slate-400 hover:text-slate-600 transition">Back to Mapping</button>
                          <button onClick={proceedToDashboard} className="bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black hover:bg-indigo-700 shadow-2xl transition-transform hover:scale-105">Calculate Waste Risk</button>
                       </div>
                    </div>
                  </div>
                )}

                {step === 3 && state.analysisResult && qualityMetrics && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="flex justify-between items-end">
                      <div>
                        <h2 className="text-4xl font-black text-slate-900 tracking-tight">Operational Risk View</h2>
                        <p className="text-slate-500 mt-1 font-medium">Snapshot of stock exposure based on current shelf-life data.</p>
                      </div>
                      <div className="flex bg-white p-1 rounded-2xl shadow-sm border border-slate-200 no-print">
                        <button onClick={() => setStep(3)} className="px-6 py-2 text-sm font-bold bg-indigo-50 text-indigo-700 rounded-xl">Dashboard</button>
                        <button onClick={() => setStep(4)} className="px-6 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 rounded-xl">Picker List</button>
                        <button onClick={() => setStep(5)} className="px-6 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 rounded-xl">Waste Logs</button>
                      </div>
                    </div>
                    <div className="bg-white rounded-3xl border shadow-sm p-6 flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
                      <div className="flex items-center space-x-6">
                        <div className="flex flex-col">
                          <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1">Data Quality</p>
                          <span className={`px-4 py-1 rounded-full text-xs font-black uppercase border ${qualityMetrics.statusColor}`}>
                            {qualityMetrics.statusLabel}
                          </span>
                        </div>
                        <div className="flex space-x-8 border-l border-slate-100 pl-8">
                          <div>
                            <p className="text-[10px] uppercase font-black text-slate-400">Total Rows</p>
                            <p className="text-xl font-black text-slate-800">{qualityMetrics.total}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase font-black text-slate-400">Included</p>
                            <p className="text-xl font-black text-green-600">{qualityMetrics.included}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase font-black text-slate-400">Excluded</p>
                            <p className="text-xl font-black text-red-500">{qualityMetrics.excluded}</p>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowQualityModal(true)}
                        className="bg-slate-50 hover:bg-slate-100 text-slate-600 px-6 py-2.5 rounded-xl text-xs font-black transition border border-slate-200"
                      >
                        Exclusion Audit
                      </button>
                    </div>
                    <div className="grid grid-cols-5 gap-6">
                      {['expired', 'use_today', 'use_this_week', 'at_risk'].map(b => (
                        <div key={b} className={`p-8 bg-white rounded-3xl border-b-[10px] shadow-sm border ${
                          b === 'expired' ? 'border-red-500' : b === 'use_today' ? 'border-orange-500' : b === 'use_this_week' ? 'border-indigo-500' : 'border-green-400'
                        }`}>
                          <p className="text-[10px] uppercase font-black text-slate-400 mb-1 tracking-widest">{getBucketLabel(b)}</p>
                          <p className="text-5xl font-black text-slate-900">{(state.analysisResult?.buckets as any)[b].length}</p>
                        </div>
                      ))}
                      {roiValue !== null && (
                        <div className="p-8 bg-indigo-900 rounded-3xl shadow-xl flex flex-col justify-between text-white relative group">
                          <div>
                            <p className="text-[10px] uppercase font-black text-indigo-300 mb-1 tracking-widest">All Items Value</p>
                            <p className="text-3xl font-black">
                              {state.roiSettings.currency}{roiValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          <button 
                            onClick={() => setShowSettings(true)}
                            className="absolute top-4 right-4 text-indigo-400 hover:text-white transition no-print"
                          >
                            <IconSettings />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Focused Sub-totals Breakdown */}
                    <div className="bg-white p-8 rounded-[2rem] border shadow-sm animate-in fade-in duration-500">
                       <div className="flex items-center justify-between mb-8">
                          <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest">
                            Sub-total Breakdown
                          </h4>
                          <div className="relative no-print">
                            <select 
                              value={state.dashboardFilter}
                              onChange={(e) => setState(prev => ({ ...prev, dashboardFilter: e.target.value as any }))}
                              className={`appearance-none pl-6 pr-12 py-3 rounded-2xl text-xs font-black uppercase tracking-widest border-2 transition-all cursor-pointer outline-none shadow-lg ${
                                state.dashboardFilter === 'expired' ? 'bg-red-600 text-white border-red-700' :
                                state.dashboardFilter === 'use_today' ? 'bg-orange-600 text-white border-orange-700' :
                                state.dashboardFilter === 'use_this_week' ? 'bg-indigo-600 text-white border-indigo-700' :
                                state.dashboardFilter === 'at_risk' ? 'bg-green-600 text-white border-green-700' :
                                'bg-slate-900 text-white border-slate-900'
                              }`}
                            >
                              <option value="all">All Items</option>
                              <option value="expired">Expired</option>
                              <option value="use_today">Use Today</option>
                              <option value="use_this_week">Use This Week</option>
                              <option value="at_risk">Use next week</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-white">
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
                            </div>
                          </div>
                       </div>
                       <div className="flex flex-wrap gap-12 items-end">
                          <div className="pr-12 border-r border-slate-100">
                            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1">Sub-total Value ({getBucketLabel(state.dashboardFilter)})</p>
                            <p className="text-4xl font-black text-slate-900">
                              {state.roiSettings.currency}{focusedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          {focusedTotals && Object.keys(focusedTotals).length > 0 ? (
                            Object.entries(focusedTotals).map(([unit, total]) => (
                              <div key={unit} className="flex flex-col">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{unit}</p>
                                <p className="text-2xl font-black text-slate-800">{total.toLocaleString()} <span className="text-xs text-slate-400">{unit}</span></p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-400 font-medium italic">No items found in this category.</p>
                          )}
                       </div>
                    </div>

                    <div className="grid grid-cols-3 gap-10">
                       <div className="col-span-2 bg-white rounded-[2rem] shadow-sm border overflow-hidden">
                          <div className="p-8 border-b bg-slate-50 flex justify-between items-center">
                            <h3 className="text-xl font-black text-slate-800">Critical Pick Tasks</h3>
                            <button onClick={() => setStep(4)} className="text-sm font-bold text-indigo-600 hover:underline">Full Daily Action List</button>
                          </div>
                          <div className="divide-y">
                            {state.analysisResult.today_actions.slice(0, 10).map((a, i) => (
                              <div key={i} className="p-5 flex justify-between items-center hover:bg-slate-50 transition group">
                                <div className="flex items-center space-x-4">
                                  <div className={`w-2 h-10 rounded-full ${a.urgency === Urgency.HIGH ? 'bg-red-500' : 'bg-orange-400'}`} />
                                  <div>
                                    <p className="font-bold text-slate-800 text-lg">{a.description}</p>
                                    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">{a.qty} {a.unit} • {a.reason}</p>
                                  </div>
                                </div>
                                <span className={`text-[10px] font-black px-4 py-2 rounded-xl uppercase tracking-widest shadow-sm border ${
                                  a.recommended_action === ActionType.DISCARD ? 'bg-red-50 text-red-700 border-red-100' : 
                                  'bg-slate-50 text-slate-600 border-slate-200'
                                }`}>
                                  {a.recommended_action}
                                </span>
                              </div>
                            ))}
                          </div>
                       </div>
                       <div className="space-y-10">
                          <div className="bg-white p-8 rounded-[2rem] shadow-sm border space-y-6">
                            <div className="flex justify-between items-center">
                              <h3 className="text-xl font-black text-slate-800">AI Insights</h3>
                              {state.aiAssistEnabled && (
                                <button 
                                  onClick={handleGenerateAiInsights}
                                  disabled={generatingInsights}
                                  className={`p-2 rounded-xl border transition-all ${
                                    generatingInsights ? 'bg-slate-50 text-slate-300' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                                  }`}
                                  title="Refresh AI Insights"
                                >
                                  {generatingInsights ? (
                                    <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                  ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                  )}
                                </button>
                              )}
                            </div>
                            <div className="space-y-6">
                              {state.analysisResult.insights.length > 0 ? (
                                state.analysisResult.insights.map((ins, i) => (
                                  <div key={i} className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100">
                                    <p className="text-xs font-black text-indigo-600 uppercase mb-2 tracking-widest">{ins.title}</p>
                                    <p className="text-sm text-slate-700 leading-relaxed font-medium">{ins.detail}</p>
                                  </div>
                                ))
                              ) : (
                                <div className="text-center py-8">
                                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-4">No insights generated</p>
                                  {state.aiAssistEnabled ? (
                                    <button 
                                      onClick={handleGenerateAiInsights}
                                      className="text-xs font-black text-indigo-600 hover:underline"
                                    >
                                      Generate Now
                                    </button>
                                  ) : (
                                    <p className="text-[10px] text-slate-300 italic">Enable AI Assist in settings to unlock automated insights.</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                       </div>
                    </div>
                  </div>
                )}
                {step === 4 && state.analysisResult && (
                   <div className="space-y-10">
                     <div className="flex justify-between items-center no-print">
                       <div>
                        <h2 className="text-4xl font-black text-slate-900">Today's Picker List</h2>
                        <p className="text-slate-500 font-medium">Prioritized action plan for cold store staff.</p>
                       </div>
                       <div className="flex items-center space-x-6">
                         <div className="flex items-center space-x-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm no-print">
                           <span className="text-xs font-bold text-slate-600">Show Zero Stock</span>
                           <button 
                            onClick={() => setState(prev => ({ ...prev, showZeroStock: !prev.showZeroStock }))}
                            className={`w-10 h-5 rounded-full transition-colors relative shadow-inner ${state.showZeroStock ? 'bg-indigo-600' : 'bg-slate-200'}`}
                           >
                            <div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-transform shadow-md ${state.showZeroStock ? 'translate-x-6' : 'translate-x-1'}`} />
                           </button>
                         </div>
                         <button onClick={handleExportPickerCSV} className="bg-indigo-50 text-indigo-700 px-8 py-3 rounded-2xl font-black shadow-md border-2 border-indigo-100 hover:bg-indigo-100 transition">Export CSV</button>
                         <button onClick={handlePrint} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black shadow-xl hover:bg-slate-800 transition">Print Action Sheet</button>
                         <button onClick={() => setStep(3)} className="text-indigo-600 font-bold px-6 py-3 hover:bg-indigo-50 rounded-2xl transition">Back to Dashboard</button>
                       </div>
                     </div>
                     <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden no-print">
                        <table className="w-full text-left">
                           <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-widest border-b">
                              <tr><th className="px-8 py-5">Item & Location</th><th className="px-8 py-5">Qty</th><th className="px-8 py-5">Expiry</th><th className="px-8 py-5">Recommended Action</th><th className="px-8 py-5 text-center">Controls</th></tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                              {state.analysisResult.today_actions.map((a, i) => (
                                <tr key={i} className="hover:bg-slate-50/50 transition">
                                   <td className="px-8 py-6">
                                      <p className="font-bold text-slate-900 text-lg">{a.description}</p>
                                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Loc: {state.normalizedData?.normalized_items.find(ni => ni.id === a.item_ref)?.location || 'N/A'}</p>
                                   </td>
                                   <td className="px-8 py-6 font-mono font-bold text-slate-700">{a.qty} {a.unit}</td>
                                   <td className="px-8 py-6 text-sm font-black">{a.useByDate}</td>
                                   <td className="px-8 py-6">
                                      <span className={`text-[10px] font-black px-4 py-2 rounded-xl border uppercase tracking-widest ${
                                        a.recommended_action === ActionType.DISCARD ? 'bg-red-50 text-red-600 border-red-100' : 
                                        'bg-slate-50 text-slate-600 border-slate-200'
                                      }`}>{a.recommended_action}</span>
                                   </td>
                                   <td className="px-8 py-6 text-center space-x-2 whitespace-nowrap">
                                      <button onClick={() => setWasteModalItem(a)} className="text-xs font-black bg-red-50 text-red-600 px-4 py-2 rounded-full border border-red-100 hover:bg-red-100 transition">Log Waste</button>
                                   </td>
                                </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                   </div>
                )}
                {step === 5 && (
                  <div className="space-y-10">
                    <div className="flex justify-between items-center no-print">
                      <div>
                        <h2 className="text-4xl font-black text-slate-900">Waste Disposal Logs</h2>
                        <p className="text-slate-500 font-medium">History of logged loss and disposal events.</p>
                      </div>
                      <div className="flex items-center space-x-6">
                        <button onClick={handleExportWasteCSV} className="bg-indigo-50 text-indigo-700 px-8 py-3 rounded-2xl font-black shadow-md border-2 border-indigo-100 hover:bg-indigo-100 transition">Export CSV</button>
                        <button onClick={() => setStep(3)} className="text-indigo-600 font-bold px-6 py-3 hover:bg-indigo-50 rounded-2xl transition">Back to Dashboard</button>
                      </div>
                    </div>
                    {state.wasteLogs.length > 0 ? (
                      <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-widest border-b">
                            <tr><th className="px-8 py-5">Date</th><th className="px-8 py-5">Item</th><th className="px-8 py-5">Qty</th><th className="px-8 py-5">Reason</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {state.wasteLogs.map((log) => (
                              <tr key={log.id} className="hover:bg-slate-50/50 transition">
                                <td className="px-8 py-6 text-sm text-slate-500 font-bold">{new Date(log.date).toLocaleString()}</td>
                                <td className="px-8 py-6 font-bold text-slate-900">{log.stockItemDescription}</td>
                                <td className="px-8 py-6 font-mono font-bold text-red-600">{log.qtyWasted} {log.unit}</td>
                                <td className="px-8 py-6">
                                  <span className="text-[10px] font-black px-4 py-2 rounded-xl bg-red-50 text-red-700 border border-red-100 uppercase tracking-widest">{log.reason}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="bg-white p-20 rounded-[2rem] border-2 border-dashed border-slate-200 text-center">
                        <p className="text-xl font-bold text-slate-400 italic">No waste events logged yet.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </main>
          {lastLoggedWasteId && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[300] animate-in slide-in-from-bottom-10">
              <div className="bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center space-x-4 border border-slate-700">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-sm font-bold">Waste event logged.</span>
                </div>
                <button onClick={handleUndoWaste} className="text-indigo-400 hover:text-indigo-300 font-black text-sm uppercase tracking-widest border-l border-slate-700 pl-4 transition">Undo</button>
              </div>
            </div>
          )}
          {toast && (
            <div className="fixed top-24 right-8 z-[400] animate-in slide-in-from-right-10 no-print">
               <div className={`px-6 py-3 rounded-2xl shadow-2xl border-2 font-bold text-sm ${
                 toast.type === 'error' ? 'bg-red-50 text-red-700 border-red-100' : 
                 toast.type === 'success' ? 'bg-green-50 text-green-700 border-green-100' : 
                 'bg-indigo-50 text-indigo-700 border-indigo-100'
               }`}>
                  {toast.message}
               </div>
            </div>
          )}
        </>
      )}
      {/* Auth and Global Modals */}
      <AuthModal authModal={authModal} setAuthModal={setAuthModal} handleRequestOtp={handleRequestOtp} handleVerifyOtp={handleVerifyOtp} handleDevSignIn={handleDevSignIn} />
      {showSettings && (
        <SettingsModal state={state} setState={setState} setShowSettings={setShowSettings} updateThreshold={updateThreshold} updateReorderSetting={updateReorderSetting} updateRoiSetting={updateRoiSetting} proceedToDashboard={proceedToDashboard} />
      )}
      {showQualityModal && qualityMetrics && (
        <QualityAuditModal qualityMetrics={qualityMetrics} setShowQualityModal={setShowQualityModal} setStep={setStep} />
      )}
      {showDebug && <DebugModal debugLogs={state.debugLogs} setShowDebug={setShowDebug} handleTestConnection={handleTestConnection} />}
      {wasteModalItem && <WasteDisposalModal item={wasteModalItem} setWasteModalItem={setWasteModalItem} handleMarkWasted={handleMarkWasted} />}
    </div>
  );
}

// --- Sub-Components for Modals ---

const AuthModal = ({ authModal, setAuthModal, handleRequestOtp, handleVerifyOtp, handleDevSignIn }: any) => {
  const [emailInput, setEmailInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const isConfigured = authService.isConfigured();
  useEffect(() => {
    let timer: any;
    if (authModal.resendTimer > 0) { timer = setInterval(() => setAuthModal((prev: any) => ({ ...prev, resendTimer: prev.resendTimer - 1 })), 1000); }
    return () => { if (timer) clearInterval(timer); };
  }, [authModal.resendTimer]);
  if (!authModal.isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-[2rem] shadow-2xl p-10 max-w-md w-full space-y-8 animate-in zoom-in-95 duration-200 border border-slate-100">
        <div className="text-center space-y-2"><h3 className="text-3xl font-black text-slate-900">Sign In</h3><p className="text-slate-500 font-medium leading-relaxed">{authModal.step === 'CHECK_EMAIL' ? "Check your email for a code." : "We’ll email you a magic sign-in link."}</p></div>
        {!isConfigured && <div className="p-4 bg-amber-50 text-amber-700 rounded-2xl text-xs font-bold border border-amber-100">Auth not configured. Use Dev Sign-In below.</div>}
        {authModal.error && <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-bold border border-red-100">{authModal.error}</div>}
        <div className="space-y-4">
           {authModal.step === 'EMAIL_INPUT' && (<div className="space-y-4"><div><label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Work Email</label><input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="john@example.com" disabled={!isConfigured} className="w-full border-2 border-slate-50 bg-slate-50 rounded-2xl p-4 font-bold text-lg focus:border-indigo-600 focus:bg-white outline-none transition disabled:opacity-50" /></div>{isConfigured ? (<button onClick={() => handleRequestOtp(emailInput)} className="w-full py-5 bg-indigo-900 text-white rounded-2xl font-black shadow-xl hover:bg-slate-800 transition">Send Magic Link</button>) : (<button onClick={handleDevSignIn} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black shadow-xl hover:bg-indigo-700 transition">Dev Sign-In (Local Preview)</button>)}</div>)}
           {authModal.step === 'CHECK_EMAIL' && (<div className="space-y-4"><div><label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Verification Code</label><input type="text" maxLength={6} value={otpInput} onChange={e => setOtpInput(e.target.value)} placeholder="123456" className="w-full border-2 border-slate-50 bg-slate-50 rounded-2xl p-4 font-black text-3xl text-center tracking-[0.5em] focus:border-indigo-600 focus:bg-white outline-none transition" /></div><button onClick={() => handleVerifyOtp(otpInput)} className="w-full py-5 bg-indigo-900 text-white rounded-2xl font-black shadow-xl hover:bg-slate-800 transition">Verify & Continue</button></div>)}
           {authModal.step === 'VERIFYING' && (<div className="py-12 flex flex-col items-center justify-center space-y-4"><div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div><p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Validating Session...</p></div>)}
        </div>
        <button onClick={() => setAuthModal((prev: any) => ({ ...prev, isOpen: false, step: 'EMAIL_INPUT' }))} className="w-full text-xs font-black text-slate-400 uppercase tracking-widest hover:text-slate-600">Never mind, go back</button>
      </div>
    </div>
  );
};

const SettingsModal = ({ state, setState, setShowSettings, updateThreshold, updateReorderSetting, updateRoiSetting, proceedToDashboard }: any) => (
  <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[100] p-4 backdrop-blur-md">
     <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-2xl w-full p-10 space-y-8 animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh]">
        <div className="flex justify-between items-center"><h3 className="text-3xl font-black text-slate-900">Operational Settings</h3><button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 text-2xl font-black">&times;</button></div>
        <div className="space-y-10">
          <section>
            <h4 className="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-4">Gemini AI Assist</h4>
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">Enable AI Assist</p>
                <p className="text-[10px] text-slate-400 mt-1">Unlock automated column mapping and dashboard insights summaries.</p>
              </div>
              <button 
                onClick={() => setState((prev: any) => ({ ...prev, aiAssistEnabled: !prev.aiAssistEnabled }))}
                className={`w-12 h-6 rounded-full transition-colors relative ${state.aiAssistEnabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${state.aiAssistEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
          </section>
          <section><h4 className="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-4">Expiry Thresholds (Days)</h4><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><div className="p-4 bg-slate-50 rounded-2xl border border-slate-100"><label className="block text-xs font-bold mb-1">Use Today Max</label><input type="number" value={state.thresholds.useTodayMax} onChange={(e) => updateThreshold('useTodayMax', e.target.value)} className="w-full border p-2 rounded-xl font-black focus:border-indigo-500 outline-none" /></div><div className="p-4 bg-slate-50 rounded-2xl border border-slate-100"><label className="block text-xs font-bold mb-1">Use This Week Max</label><input type="number" value={state.thresholds.useThisWeekMax} onChange={(e) => updateThreshold('useThisWeekMax', e.target.value)} className="w-full border p-2 rounded-xl font-black focus:border-indigo-500 outline-none" /></div><div className="p-4 bg-slate-50 rounded-2xl border border-slate-100"><label className="block text-xs font-bold mb-1">At Risk Max</label><input type="number" value={state.thresholds.atRiskMax} onChange={(e) => updateThreshold('atRiskMax', e.target.value)} className="w-full border p-2 rounded-xl font-black focus:border-indigo-500 outline-none" /></div></div></section>
          <section><h4 className="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-4">Financial ROI Parameters</h4><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="p-4 bg-slate-50 rounded-2xl border border-slate-100"><label className="block text-xs font-bold mb-1">Avg. Cost per KG</label><input type="number" value={state.roiSettings.defaultValuePerKg} onChange={(e) => updateRoiSetting('defaultValuePerKg', parseFloat(e.target.value))} className="w-full border p-2 rounded-xl font-black focus:border-indigo-500 outline-none" /></div><div className="p-4 bg-slate-50 rounded-2xl border border-slate-100"><label className="block text-xs font-bold mb-1">Avg. Cost per Unit</label><input type="number" value={state.roiSettings.defaultValuePerEach} onChange={(e) => updateRoiSetting('defaultValuePerEach', parseFloat(e.target.value))} className="w-full border p-2 rounded-xl font-black focus:border-indigo-500 outline-none" /></div></div></section>
        </div>
        <div className="pt-6 border-t"><button onClick={() => { setShowSettings(false); proceedToDashboard(); }} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black shadow-xl hover:bg-indigo-700 transition">Apply & Recalculate Risk</button></div>
     </div>
  </div>
);

const QualityAuditModal = ({ qualityMetrics, setShowQualityModal, setStep }: any) => (
  <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[110] p-4 backdrop-blur-md">
     <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-4xl w-full h-[85vh] flex flex-col p-10 space-y-8 animate-in zoom-in-95 duration-200 overflow-hidden">
        <div className="flex justify-between items-center"><h3 className="text-3xl font-black text-slate-900">Exclusion Audit</h3><button onClick={() => setShowQualityModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl font-black">&times;</button></div>
        <div className="flex-grow overflow-y-auto border rounded-2xl"><table className="w-full text-left"><thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 sticky top-0 border-b z-10"><tr><th className="px-6 py-4">Row</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Message</th></tr></thead><tbody className="divide-y text-sm">{qualityMetrics.normalizationErrors.map((e: any, i: number) => (<tr key={i} className="hover:bg-red-50/20 transition"><td className="px-6 py-4 font-mono font-bold text-slate-400">#{e.row_index+1}</td><td className="px-6 py-4"><span className="text-xs font-black uppercase text-red-600">{e.issue_code}</span></td><td className="px-6 py-4 text-slate-600">{e.message}</td></tr>))}</tbody></table></div>
        <div className="flex-shrink-0 flex justify-end items-center pt-4 border-t space-x-3"><button onClick={() => { setShowQualityModal(false); setStep(1); }} className="px-6 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-xs hover:bg-indigo-100 transition">Adjust Mapping</button><button onClick={() => setShowQualityModal(false)} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs transition">Close Audit</button></div>
     </div>
  </div>
);

const DebugModal = ({ debugLogs, setShowDebug, handleTestConnection }: any) => (
  <div className="fixed inset-0 bg-slate-950/95 flex items-center justify-center z-[120] p-4 backdrop-blur-xl">
     <div className="bg-slate-900 text-indigo-400 rounded-[2.5rem] shadow-2xl max-w-4xl w-full h-[85vh] flex flex-col p-10 border border-slate-800">
        <div className="flex justify-between items-center mb-8"><div className="flex items-center space-x-3"><div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" /><h3 className="text-xl font-mono font-bold tracking-tighter text-white">AI_ORCHESTRATOR_TRACE</h3></div><div className="flex items-center space-x-4"><button onClick={handleTestConnection} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs transition shadow-lg">Test Gemini Connection</button><button onClick={() => setShowDebug(false)} className="text-slate-500 hover:text-white font-black text-2xl transition">&times;</button></div></div>
        <div className="flex-grow overflow-y-auto font-mono text-[11px] space-y-6">{debugLogs.length === 0 ? <p className="text-slate-700 italic">Listening...</p> : debugLogs.map((log: any, i: number) => (<div key={i} className="border-l-2 border-indigo-900/50 pl-6 py-4 bg-indigo-950/20 rounded-r-2xl group transition-all hover:bg-indigo-950/40"><div className="flex justify-between items-start mb-2"><p className="text-[10px] text-indigo-600 font-black">[{log.timestamp}] :: {log.type} {log.correlationId ? `:: CID_${log.correlationId}` : ''}</p>{log.featureName && (<span className="text-[9px] bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full uppercase font-black tracking-widest">{log.featureName}</span>)}</div><pre className="whitespace-pre-wrap text-indigo-200/80 leading-relaxed font-mono">{JSON.stringify(log.content, (key, value) => key === 'apiKey' ? 'REDACTED' : value, 2)}</pre></div>))}</div>
     </div>
  </div>
);

const WasteDisposalModal = ({ item, setWasteModalItem, handleMarkWasted }: any) => (
  <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[100] p-4 backdrop-blur-md">
     <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-md w-full p-10 space-y-8 border border-red-50"><div className="flex items-center space-x-4"><div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center"><svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-1.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg></div><h3 className="text-3xl font-black text-slate-900">Record Loss</h3></div><div className="space-y-6"><div><label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Selected Item</label><p className="font-black text-slate-800 text-xl leading-tight">{item.description}</p></div><div className="grid grid-cols-2 gap-6"><div><label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Qty</label><input type="number" id="w-qty" defaultValue={item.qty} className="w-full border-2 border-slate-100 rounded-2xl p-4 font-black text-lg outline-none" /></div><div><label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Reason</label><select id="w-reason" className="w-full border-2 border-slate-100 rounded-2xl p-4 font-bold text-sm bg-white outline-none">{WASTE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}</select></div></div></div><div className="flex space-x-4 pt-4"><button onClick={() => setWasteModalItem(null)} className="flex-1 py-5 font-black text-slate-400">Cancel</button><button onClick={() => { const q = parseFloat((document.getElementById('w-qty') as any).value); const r = (document.getElementById('w-reason') as any).value; handleMarkWasted(item, r, q); }} className="flex-1 py-5 bg-red-600 text-white rounded-2xl font-black shadow-xl hover:bg-red-700 transition">Dispose</button></div></div>
  </div>
);