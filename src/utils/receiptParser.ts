/**
 * Receipt text parser and auto-categorizer for FinAI OCR Scanner
 */

export interface ParsedReceipt {
  merchant: string;
  amount: number | null;
  date: string; // YYYY-MM-DD
  category: string;
  rawText: string;
}

export const CATEGORIES = [
  'Food',
  'Shopping',
  'Transport',
  'Entertainment',
  'Bills',
  'Healthcare',
  'Other'
];

/**
 * Predicts transaction category based on text (merchant name, line items, receipt text)
 * Replicates and extends the app's heuristic keyword rules.
 */
export function predictCategoryFromText(text: string): string {
  const lower = text.toLowerCase();

  if (/uber|lyft|subway|metro|transit|bus|train|cab|taxi|flight|airline|fuel|petrol|diesel|gas station|auto|parking|ola|irctc|fastag/.test(lower)) {
    return 'Transport';
  }
  if (/starbucks|mcdonald|restaurant|cafe|coffee|grocery|whole foods|food|burger|pizza|zomato|swiggy|dining|bakery|supermarket|tea|bistro|kitchen|diner|barbeque|sweets|dhaba|kfc|subway|domino|biryani|juice|fruits|vegetables|mart|prov/.test(lower)) {
    return 'Food';
  }
  if (/rent|electric|utility|power|internet|wifi|broadband|water|energy|bill|insurance|telecom|phone|airtel|jio|vodafone|vi|lic|maintenance|cylinder|gas/.test(lower)) {
    return 'Bills';
  }
  if (/netflix|movie|theater|cinema|spotify|concert|gaming|steam|playstation|xbox|pub|bar|club|show|ticket|pvr|inox|cinepolis|bookmyshow|hotstar|prime/.test(lower)) {
    return 'Entertainment';
  }
  if (/pharmacy|chemist|hospital|clinic|doctor|medicine|meds|apollo|medplus|pharmeasy|netmeds|diagnostic|dental|healthcare|care/.test(lower)) {
    return 'Healthcare';
  }
  if (/amazon|target|apple|walmart|zara|myntra|flipkart|nike|clothing|shoes|clothes|mall|store|electronics|gadget|shop|retail|h&m|decathlon|croma|reliance digital/.test(lower)) {
    return 'Shopping';
  }
  
  return 'Shopping';
}

/**
 * Parses raw OCR string from receipt into structured transaction preview data
 */
export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // 1. Merchant Name: first line with alphabetical content (excluding pure symbols/numbers)
  let merchant = '';
  for (const line of lines) {
    const cleaned = line.replace(/^[#*=:_\-|~. ]+/, '').replace(/[#*=:_\-|~. ]+$/, '').trim();
    // Must contain at least 2 letters and not look like a date or invoice number
    if (/[a-zA-Z]{2,}/.test(cleaned) && !/^(invoice|bill|receipt|date|tax|gstin|tel|phone|cashier|order)/i.test(cleaned)) {
      merchant = cleaned.slice(0, 45);
      break;
    }
  }
  if (!merchant && lines.length > 0) {
    merchant = lines[0].slice(0, 45);
  }
  if (!merchant) {
    merchant = 'Receipt Store';
  }

  // 2. Amount Identification
  // Strategy:
  // A. Check lines with keywords like "Total", "Grand Total", "Net Amount", "Amount Due", "Bill", "₹", "Rs"
  // B. If not found or low confidence, search for largest currency-like number
  let amount: number | null = null;
  const numberCandidateList: { val: number; score: number }[] = [];

  const totalKeywords = /(?:grand\s+total|total\s+amount|net\s+amount|amount\s+payable|balance\s+due|subtotal|total|bill\s+amount|paid|inr|rs\.?|₹)/i;

  for (const line of lines) {
    const hasTotalKeyword = totalKeywords.test(line);
    
    // Find all numbers with optional decimals
    const matches = line.match(/(?:(?:rs\.?|inr|₹)\s*)?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})|[0-9]+(?:\.[0-9]{1,2})?)/gi);
    if (matches) {
      for (const m of matches) {
        // Strip out currency words/symbols and commas
        const cleanNumStr = m.replace(/(?:rs\.?|inr|₹|,|\s)/gi, '');
        const val = parseFloat(cleanNumStr);
        // Exclude 4-digit years like 2024, 2025, 2026 if standalone, or 10-digit phone numbers
        if (!isNaN(val) && val > 0 && val < 500000) {
          const isLikelyYear = (val >= 2020 && val <= 2030 && !cleanNumStr.includes('.'));
          const isLikelyPhone = cleanNumStr.length >= 10 && !cleanNumStr.includes('.');
          const isLikelyPincode = cleanNumStr.length === 6 && !cleanNumStr.includes('.');
          
          if (!isLikelyYear && !isLikelyPhone && !isLikelyPincode) {
            let score = 1;
            if (hasTotalKeyword) score += 5;
            if (cleanNumStr.includes('.')) score += 2; // Decimals like .50 or .00 are classic currency
            if (/total/i.test(line)) score += 4;
            if (/grand\s+total/i.test(line)) score += 6;
            numberCandidateList.push({ val, score });
          }
        }
      }
    }
  }

  if (numberCandidateList.length > 0) {
    // Sort primarily by score descending, then by value descending
    numberCandidateList.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.val - a.val;
    });
    amount = numberCandidateList[0].val;
  }

  // 3. Date Identification
  // Look for DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, or DD Mon YYYY
  let date = getTodayFormatted();

  const datePatterns = [
    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    /\b(0?[1-9]|[12][0-9]|3[01])[/\-.](0?[1-9]|1[0-2])[/\-.](20\d{2}|\d{2})\b/,
    // YYYY-MM-DD or YYYY/MM/DD
    /\b(20\d{2})[/\-.](0?[1-9]|1[0-2])[/\-.](0?[1-9]|[12][0-9]|3[01])\b/,
    // DD Mon YYYY (e.g., 08 Sep 2026 or 8 September 2025)
    /\b(0?[1-9]|[12][0-9]|3[01])\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/i
  ];

  for (const line of lines) {
    let matched = false;

    // Pattern 1: DD/MM/YYYY
    const match1 = line.match(datePatterns[0]);
    if (match1) {
      const day = match1[1].padStart(2, '0');
      const month = match1[2].padStart(2, '0');
      let year = match1[3];
      if (year.length === 2) year = `20${year}`;
      date = `${year}-${month}-${day}`;
      matched = true;
    }

    if (!matched) {
      // Pattern 2: YYYY-MM-DD
      const match2 = line.match(datePatterns[1]);
      if (match2) {
        const year = match2[1];
        const month = match2[2].padStart(2, '0');
        const day = match2[3].padStart(2, '0');
        date = `${year}-${month}-${day}`;
        matched = true;
      }
    }

    if (!matched) {
      // Pattern 3: DD Mon YYYY
      const match3 = line.match(datePatterns[2]);
      if (match3) {
        const day = match3[1].padStart(2, '0');
        const monthStr = match3[2].toLowerCase().slice(0, 3);
        const year = match3[3];
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthIndex = monthNames.indexOf(monthStr);
        if (monthIndex !== -1) {
          const month = String(monthIndex + 1).padStart(2, '0');
          date = `${year}-${month}-${day}`;
          matched = true;
        }
      }
    }

    if (matched) break;
  }

  // 4. Suggested Category
  const category = predictCategoryFromText(`${merchant} ${text}`);

  return {
    merchant,
    amount,
    date,
    category,
    rawText: text
  };
}

/**
 * Returns today's date formatted as YYYY-MM-DD for <input type="date">
 */
export function getTodayFormatted(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
