import { useState, useRef, type ChangeEvent, type DragEvent } from 'react';
import Tesseract from 'tesseract.js';
import { 
  Camera, UploadCloud, FileText, Check, RotateCcw, 
  Sparkles, AlertCircle, Loader2, Tag, Calendar, 
  DollarSign, Store, Eye, EyeOff 
} from 'lucide-react';
import { parseReceiptText, CATEGORIES } from '../utils/receiptParser';
import { generateSampleReceiptDataUrl } from '../utils/sampleReceipt';

interface Props {
  token: string;
  onSuccess: () => void;
  onCancel?: () => void;
  onSwitchToManual?: () => void;
}

interface EditablePreview {
  merchant: string;
  amount: string;
  date: string;
  category: string;
  rawText: string;
}

export function ReceiptScanner({ token, onSuccess, onCancel, onSwitchToManual }: Props) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressStatus, setProgressStatus] = useState<string>('Reading receipt...');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EditablePreview | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Run Tesseract.js OCR directly in the browser
  const runOcrOnImage = async (dataUrl: string, name: string) => {
    setImageSrc(dataUrl);
    setFileName(name);
    setIsProcessing(true);
    setOcrError(null);
    setPreview(null);
    setProgressStatus('Reading receipt...');
    setProgressPercent(0);

    try {
      const result = await Tesseract.recognize(dataUrl, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            const p = Math.round((m.progress || 0) * 100);
            setProgressPercent(p);
            setProgressStatus(`Reading receipt... ${p}%`);
          } else if (m.status.includes('loading') || m.status.includes('init')) {
            setProgressStatus('Initializing OCR engine...');
          }
        }
      });

      const extractedText = result?.data?.text || '';
      
      // If no readable text or fewer than 5 characters extracted, show friendly error
      if (!extractedText.trim() || extractedText.trim().length < 4) {
        throw new Error("Couldn't read this receipt clearly — try a clearer photo or enter manually");
      }

      // Parse structured fields from receipt text
      const parsed = parseReceiptText(extractedText);

      setPreview({
        merchant: parsed.merchant,
        amount: parsed.amount !== null ? String(parsed.amount) : '', // Blank if not found so user can fill manually
        date: parsed.date,
        category: parsed.category,
        rawText: extractedText
      });
    } catch (err: any) {
      console.error('OCR Processing error:', err);
      setOcrError("Couldn't read this receipt clearly — try a clearer photo or enter manually");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        runOcrOnImage(reader.result, file.name);
      }
    };
    reader.readAsDataURL(file);
    // Reset file input value to allow re-uploading same file if retrying
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setOcrError('Please upload a valid image file (PNG, JPG, WEBP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        runOcrOnImage(reader.result, file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSampleReceipt = () => {
    const sampleDataUrl = generateSampleReceiptDataUrl();
    if (sampleDataUrl) {
      runOcrOnImage(sampleDataUrl, 'sample_cafe_receipt.png');
    }
  };

  const handleReset = () => {
    setImageSrc(null);
    setFileName('');
    setPreview(null);
    setOcrError(null);
    setSaveError(null);
    setIsProcessing(false);
  };

  const handleConfirmSave = async () => {
    if (!preview) return;

    const parsedAmount = parseFloat(preview.amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setSaveError('Please enter a valid amount greater than 0.');
      return;
    }

    if (!preview.merchant.trim()) {
      setSaveError('Please enter a merchant name.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          amount: parsedAmount,
          merchant: preview.merchant.trim(),
          category: preview.category,
          date: preview.date
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save transaction');
      }

      onSuccess();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save transaction. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-[#E6EDF3] font-sans">
      {/* Hidden file and camera inputs */}
      <input 
        id="receipt-file-input"
        type="file" 
        accept="image/jpeg,image/png,image/webp,image/jpg" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />
      <input 
        id="receipt-camera-input"
        type="file" 
        accept="image/*" 
        capture="environment" 
        ref={cameraInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />

      {/* STATE 1: Initial Upload & Camera Picker (when not processing and no preview) */}
      {!isProcessing && !preview && (
        <div className="space-y-4">
          {/* Drag & Drop Zone */}
          <div
            id="receipt-dropzone"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
              isDragging 
                ? 'border-[#4A9EFF] bg-[#4A9EFF]/10' 
                : 'border-[#2A2F3A] bg-[#0D1117] hover:border-[#4A9EFF]/60 hover:bg-[#161B22]'
            }`}
          >
            <div className="w-12 h-12 rounded-xl bg-[#4A9EFF]/10 border border-[#4A9EFF]/20 flex items-center justify-center text-[#4A9EFF] mb-3">
              <UploadCloud className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-[#E6EDF3] tracking-tight">Upload Receipt Image</p>
            <p className="text-xs text-[#8B949E] mt-1">Drag and drop, or browse your files</p>
            <span className="text-[10px] text-[#8B949E] mt-2 px-2 py-0.5 rounded-full bg-[#21262D] border border-[#2A2F3A]">
              JPG, PNG, WEBP (Client-Side OCR)
            </span>
          </div>

          {/* Action Button Row: Browse File, Use Camera, Try Sample */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              id="btn-pick-receipt-file"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] border border-[#2A2F3A] rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              <UploadCloud className="w-4 h-4 text-[#4A9EFF]" />
              <span>Browse File</span>
            </button>

            <button
              id="btn-use-camera"
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] border border-[#2A2F3A] rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4 text-[#3FB950]" />
              <span>Use Camera</span>
            </button>
          </div>

          {/* Quick Demo Sample Button */}
          <div className="pt-2 border-t border-[#2A2F3A] flex items-center justify-between">
            <span className="text-[11px] text-[#8B949E]">Need a test receipt?</span>
            <button
              id="btn-sample-receipt"
              type="button"
              onClick={handleSampleReceipt}
              className="flex items-center gap-1.5 text-xs text-[#4A9EFF] hover:underline font-medium cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load sample cafe receipt</span>
            </button>
          </div>

          {/* Friendly Error Notice if OCR or file failed */}
          {ocrError && (
            <div id="ocr-error-banner" className="p-4 rounded-xl bg-[#F85149]/10 border border-[#F85149]/30 text-xs text-[#F85149] space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-[#F85149] flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-[#E6EDF3]">{ocrError}</p>
                  <p className="text-[11px] text-[#8B949E] mt-0.5">
                    Make sure the photo is well-lit and not blurry, or enter the details directly.
                  </p>
                </div>
              </div>
              {onSwitchToManual && (
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={onSwitchToManual}
                    className="text-xs font-medium text-[#4A9EFF] hover:underline cursor-pointer"
                  >
                    Switch to Manual Entry →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* STATE 2: OCR Processing / Loading State */}
      {isProcessing && (
        <div id="ocr-processing-state" className="p-6 bg-[#0D1117] rounded-xl border border-[#2A2F3A] space-y-5 text-center">
          <div className="relative mx-auto w-16 h-16 rounded-xl bg-[#4A9EFF]/10 border border-[#4A9EFF]/30 flex items-center justify-center text-[#4A9EFF] overflow-hidden">
            <Loader2 className="w-8 h-8 animate-spin" />
            <div className="absolute inset-x-0 h-0.5 bg-[#4A9EFF] animate-pulse" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-[#E6EDF3] tracking-tight">{progressStatus}</h3>
            <p className="text-xs text-[#8B949E]">
              Extracting counterparty, amount, and date using in-browser Tesseract.js...
            </p>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-[#21262D] rounded-full h-2 overflow-hidden border border-[#2A2F3A]">
            <div 
              className="h-full bg-[#4A9EFF] rounded-full transition-all duration-300"
              style={{ width: `${Math.max(5, progressPercent)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#8B949E]">
            <span>{fileName || 'Receipt image'}</span>
            <span className="font-mono text-[#4A9EFF]">{progressPercent}%</span>
          </div>
        </div>
      )}

      {/* STATE 3: Transaction Preview Card (Editable Pre-filled Fields + Confirm Step) */}
      {!isProcessing && preview && (
        <div id="transaction-preview-card" className="space-y-4">
          <div className="p-4 bg-[#0D1117] rounded-xl border border-[#2A2F3A] space-y-4">
            {/* Card Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[#2A2F3A]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-[#3FB950]/10 border border-[#3FB950]/30 flex items-center justify-center text-[#3FB950]">
                  <Check className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-[#E6EDF3] tracking-tight">Transaction Preview</h3>
                  <p className="text-[10px] text-[#8B949E]">Review and verify extracted details before saving</p>
                </div>
              </div>

              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30">
                OCR Scanned
              </span>
            </div>

            {/* Editable Fields Grid */}
            <div className="space-y-3">
              {/* Field 1: Merchant Name */}
              <div>
                <label className="block text-[11px] uppercase tracking-wider font-semibold text-[#8B949E] mb-1">
                  Merchant / Counterparty
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8B949E]">
                    <Store className="w-3.5 h-3.5" />
                  </div>
                  <input
                    id="ocr-merchant-input"
                    type="text"
                    required
                    value={preview.merchant}
                    onChange={(e) => setPreview({ ...preview, merchant: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 bg-[#161B22] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] text-xs focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all"
                    placeholder="e.g. Starbucks, Amazon"
                  />
                </div>
              </div>

              {/* Field 2 & 3: Amount and Date (2 columns) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-semibold text-[#8B949E] mb-1">
                    Amount (₹)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8B949E]">
                      <span className="text-xs font-semibold">₹</span>
                    </div>
                    <input
                      id="ocr-amount-input"
                      type="number"
                      step="0.01"
                      required
                      value={preview.amount}
                      onChange={(e) => setPreview({ ...preview, amount: e.target.value })}
                      className="w-full pl-8 pr-3 py-2 bg-[#161B22] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] text-xs font-mono focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all"
                      placeholder="0.00 (enter amount)"
                    />
                  </div>
                  {!preview.amount && (
                    <p className="text-[10px] text-[#8B949E] mt-1">Amount couldn't be detected. Please enter manually.</p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-semibold text-[#8B949E] mb-1">
                    Date
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8B949E]">
                      <Calendar className="w-3.5 h-3.5" />
                    </div>
                    <input
                      id="ocr-date-input"
                      type="date"
                      required
                      value={preview.date}
                      onChange={(e) => setPreview({ ...preview, date: e.target.value })}
                      className="w-full pl-9 pr-3 py-2 bg-[#161B22] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] text-xs focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Field 4: Category (Auto-suggested via existing keyword rules) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] uppercase tracking-wider font-semibold text-[#8B949E]">
                    Category
                  </label>
                  <span className="text-[10px] text-[#3FB950] font-medium flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Auto-categorized
                  </span>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8B949E]">
                    <Tag className="w-3.5 h-3.5" />
                  </div>
                  <select
                    id="ocr-category-select"
                    value={preview.category}
                    onChange={(e) => setPreview({ ...preview, category: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 bg-[#161B22] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] text-xs focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all cursor-pointer"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat} className="bg-[#161B22] text-[#E6EDF3]">
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Collapsible Extracted Raw OCR Snippet */}
            <div className="pt-2 border-t border-[#2A2F3A]">
              <button
                type="button"
                onClick={() => setShowRawText(!showRawText)}
                className="flex items-center gap-1.5 text-[11px] text-[#8B949E] hover:text-[#E6EDF3] transition-colors cursor-pointer"
              >
                {showRawText ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                <span>{showRawText ? 'Hide extracted text' : 'View extracted OCR text'}</span>
              </button>

              {showRawText && (
                <div className="mt-2 p-2.5 bg-[#161B22] rounded-lg border border-[#2A2F3A] max-h-28 overflow-y-auto font-mono text-[10px] text-[#8B949E] whitespace-pre-wrap leading-relaxed">
                  {preview.rawText}
                </div>
              )}
            </div>
          </div>

          {/* Save Error if any */}
          {saveError && (
            <div className="p-3 bg-[#F85149]/10 border border-[#F85149]/30 text-[#F85149] text-xs rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Action Buttons: Cancel / Discard vs Confirm & Save */}
          <div className="flex items-center gap-2.5 pt-1">
            <button
              id="btn-ocr-cancel"
              type="button"
              onClick={handleReset}
              disabled={isSaving}
              className="flex-1 py-2.5 px-3 bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] border border-[#2A2F3A] rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#8B949E]" />
              <span>Cancel & Retake</span>
            </button>

            <button
              id="btn-ocr-confirm-save"
              type="button"
              onClick={handleConfirmSave}
              disabled={isSaving}
              className="flex-1 py-2.5 px-3 bg-[#4A9EFF] hover:bg-[#3b8eed] text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm & Save</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
