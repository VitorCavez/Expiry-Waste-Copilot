
export const DEFAULT_THRESHOLDS = {
  useTodayMax: 1, // 0-1 days
  useThisWeekMax: 7, // 2-7 days
  atRiskMax: 10, // 8-10 days
};

export const DEFAULT_REORDER_SETTINGS = {
  enableReorderSignals: true,
  lowStockThresholdKg: 10,
  targetStockKg: 25,
  minReorderKg: 5,
  lowStockThresholdEach: 10,
  targetStockEach: 25,
  minReorderEach: 5,
  wasteRiskReductionEnabled: true,
  wasteRiskReductionPercent: 0.3,  // 30%
  wasteRiskQtyThresholdKg: 10,
  wasteRiskQtyThresholdEach: 10,
};

export const FINANCIAL_ASSUMPTIONS = {
  avgValuePerKg: 18.50, // Average cost of meat per kg
  avgValuePerEa: 4.20,  // Average cost of individual unit
};

export const MAPPING_FIELDS = [
  { key: 'plu', label: 'PLU/SKU', required: false },
  { key: 'description', label: 'Description', required: true },
  { key: 'qty', label: 'Quantity/Weight', required: true },
  { key: 'unit', label: 'Unit (kg/ea)', required: false },
  { key: 'kill_date', label: 'Kill Date', required: false },
  { key: 'pack_date', label: 'Pack Date', required: false },
  { key: 'use_by_date', label: 'Use By Date', required: true },
  { key: 'location', label: 'Location/Bin', required: false },
];

export const WASTE_REASONS = [
  'Expired',
  'Damaged Packaging',
  'Quality Issue',
  'Spillage',
  'Temperature Out of Spec',
  'Incorrect Trim',
  'Other'
];

export const ONBOARDING_STEPS = [
  { title: "Upload", description: "Import your stock sheet from your existing ERP or manual spreadsheet." },
  { title: "Map", description: "The AI identifies columns like 'Use By Date' and 'Weight' automatically." },
  { title: "Review", description: "Validate the data and check for missing expiry dates before analysis." },
  { title: "Action", description: "Get a prioritized picker list of what to use, freeze, or discount today." }
];

export const SAMPLE_CSV_CONTENT = `PLU,Description,Quantity,Unit,Kill Date,Pack Date,Use By Date,Location
101,Beef Striploin,25.5,kg,2025-05-01,2025-05-03,2025-05-20,Cold Room A
102,Ribeye Steak,12.0,kg,2025-05-01,2025-05-02,2025-05-15,Cold Room B
201,Chicken Breast,45.0,kg,2025-05-10,2025-05-11,2025-05-14,Poultry Fridge
303,Lamb Chops,15.0,kg,2025-05-12,2025-05-12,2025-05-14,Main Freezer
404,Pork Belly,3.0,kg,2025-04-20,2025-04-22,2025-05-05,Cold Room A
505,Diced Beef,20.0,kg,2025-05-12,2025-05-13,2025-05-22,Preparation
601,Beef Burgers (Pack 4),10,ea,2025-05-10,2025-05-11,2025-05-14,Counter
702,Sausages 1lb,25,ea,2025-05-09,2025-05-10,2025-05-13,Display
808,Empty Tray Item,0,kg,2025-05-01,2025-05-01,2025-05-20,Shelf 1
`;
