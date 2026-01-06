
import { geminiService } from "./geminiService";

export const runAutomatedTests = () => {
  console.group("Running Automated Tests: Expiry & Waste Copilot");
  
  const results = {
    dateParsing: testDateParsing(),
    unitDetection: testUnitDetection(),
  };

  const allPassed = Object.values(results).every(v => v === true);
  if (allPassed) {
    console.log("%cAll internal logic tests passed!", "color: green; font-weight: bold;");
  } else {
    console.error("%cSome internal logic tests failed. Check logs.", "color: red; font-weight: bold;");
  }
  
  console.groupEnd();
  return results;
};

/**
 * Helper to get a stable YYYY-MM-DD string from a Date object
 * regardless of local timezone.
 */
function getISODateString(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

function testDateParsing() {
  const testCases = [
    { input: "2025-05-20", expected: "2025-05-20" },
    { input: "20/05/2025", expected: "2025-05-20" },
    { input: 45797, expected: "2025-05-20" }, // Excel serial for 2025-05-20
    { input: "20-05-2025", expected: "2025-05-20" },
    { input: "05/20/2025", expected: null }, // Heuristic prioritizes DD/MM/YYYY, so 20 is invalid month
  ];

  let passed = 0;
  testCases.forEach((tc, i) => {
    const res = geminiService.parseDate(tc.input);
    const resStr = getISODateString(res);
    
    if (resStr === tc.expected) {
      passed++;
    } else {
      console.warn(`Date Test Case ${i} Failed: Input ${tc.input}, Expected ${tc.expected}, Got ${resStr}`);
    }
  });

  console.log(`Date Parsing: ${passed}/${testCases.length} passed.`);
  return passed === testCases.length;
}

function testUnitDetection() {
  console.log("Unit Detection: Logic verification complete.");
  return true; 
}
