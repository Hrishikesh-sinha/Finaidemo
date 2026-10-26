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

      // Ask the server's categorizer (keyword rules, then the learned model)
      // for the suggestion; the in-browser rules are the fallback if that
      // request fails. Either way the person can change it before saving.
      let category = parsed.category;
      try {
        const res = await fetch('/api/categorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text: `${parsed.merchant} ${extractedText}`.slice(0, 300) })
        });
        if (res.ok) category = (await res.json()).category ?? category;
      } catch {
        // keep the in-browser suggestion
      }

      setPreview({
        merchant: parsed.merchant,
        amount: parsed.amount !== null ? String(parsed.amount) : '', // Blank if not found so user can fill manually
        date: parsed.date,
        category,
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
    <div className="space-y-4 text-ink font-sans">
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
            className={`border-2 border-dashed rounded-lg p-6 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
              isDragging 
                ? 'border-accent bg-accent/10' 
                : 'border-line bg-canvas hover:border-accent/60 hover:bg-sunken'
            }`}
          >
            <div className="w-12 h-12 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mb-3">
              <UploadCloud className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-ink tracking-tight">Upload Receipt Image</p>
            <p className="text-xs text-ink-2 mt-1">Drag and drop, or browse your files</p>
            <span className="text-[10px] text-ink-2 mt-2 px-2 py-0.5 rounded-full bg-surface border border-line">
              JPG, PNG, WEBP (Client-Side OCR)
            </span>
          </div>

          {/* Action Button Row: Browse File, Use Camera, Try Sample */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              id="btn-pick-receipt-file"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-surface hover:bg-raised text-ink border border-line rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              <UploadCloud className="w-4 h-4 text-accent" />
              <span>Browse File</span>
            </button>

            <button
              id="btn-use-camera"
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-surface hover:bg-raised text-ink border border-line rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4 text-pos" />
              <span>Use Camera</span>
            </button>
          </div>

          {/* Quick Demo Sample Button */}
          <div className="pt-2 border-t border-line flex items-center justify-between">
            <span className="text-[11px] text-ink-2">Need a test receipt?</span>
            <button
              id="btn-sample-receipt"
              type="button"
              onClick={handleSampleReceipt}
              className="flex items-center gap-1.5 text-xs text-accent hover:underline font-medium cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load sample cafe receipt</span>
            </button>
          </div>

          {/* Friendly Error Notice if OCR or file failed */}
          {ocrError && (
            <div id="ocr-error-banner" className="p-4 rounded-lg bg-neg/10 border border-neg/30 text-xs text-neg space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-neg flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-ink">{ocrError}</p>
                  <p className="text-[11px] text-ink-2 mt-0.5">
                    Make sure the photo is well-lit and not blurry, or enter the details directly.
                  </p>
                </div>
              </div>
              {onSwitchToManual && (
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={onSwitchToManual}
                    className="text-xs font-medium text-accent hover:underline cursor-pointer"
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
        <div id="ocr-processing-state" className="p-6 bg-canvas rounded-lg border border-line space-y-5 text-center">
          <div className="relative mx-auto w-16 h-16 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center text-accent overflow-hidden">
            <Loader2 className="w-8 h-8 animate-spin" />
            <div className="absolute inset-x-0 h-0.5 bg-accent animate-pulse" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-ink tracking-tight">{progressStatus}</h3>
            <p className="text-xs text-ink-2">
              Extracting counterparty, amount, and date using in-browser Tesseract.js...
            </p>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-surface rounded-full h-2 overflow-hidden border border-line">
            <div 
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${Math.max(5, progressPercent)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-ink-2">
            <span>{fileName || 'Receipt image'}</span>
            <span className="font-mono text-accent">{progressPercent}%</span>
          </div>
        </div>
      )}

      {/* STATE 3: Transaction Preview Card (Editable Pre-filled Fields + Confirm Step) */}
      {!isProcessing && preview && (
        <div id="transaction-preview-card" className="space-y-4">
          <div className="p-4 bg-canvas rounded-lg border border-line space-y-4">
            {/* Card Header */}
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-pos/10 border border-pos/30 flex items-center justify-center text-pos">
                  <Check className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-ink tracking-tight">Transaction Preview</h3>
                  <p className="text-[10px] text-ink-2">Review and verify extracted details before saving</p>
                </div>
              </div>

              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent border border-accent/30">
                OCR Scanned
              </span>
            </div>

            {/* Editable Fields Grid */}
            <div className="space-y-3">
              {/* Field 1: Merchant Name */}
              <div>
                <label className="block text-[11px] font-semibold text-ink-2 mb-1">
                  Merchant
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-2">
                    <Store className="w-3.5 h-3.5" />
                  </div>
                  <input
                    id="ocr-merchant-input"
                    type="text"
                    required
                    value={preview.merchant}
                    onChange={(e) => setPreview({ ...preview, merchant: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 bg-sunken border border-line rounded-lg text-ink text-xs focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                    placeholder="e.g. Starbucks, Amazon"
                  />
                </div>
              </div>

              {/* Field 2 & 3: Amount and Date (2 columns) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-ink-2 mb-1">
                    Amount (₹)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-2">
                      <span className="text-xs font-semibold">₹</span>
                    </div>
                    <input
                      id="ocr-amount-input"
                      type="number"
                      step="0.01"
                      required
                      value={preview.amount}
                      onChange={(e) => setPreview({ ...preview, amount: e.target.value })}
                      className="w-full pl-8 pr-3 py-2 bg-sunken border border-line rounded-lg text-ink text-xs font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                      placeholder="0.00 (enter amount)"
                    />
                  </div>
                  {!preview.amount && (
                    <p className="text-[10px] text-ink-2 mt-1">Amount couldn't be detected. Please enter manually.</p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-ink-2 mb-1">
                    Date
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-2">
                      <Calendar className="w-3.5 h-3.5" />
                    </div>
                    <input
                      id="ocr-date-input"
                      type="date"
                      required
                      value={preview.date}
                      onChange={(e) => setPreview({ ...preview, date: e.target.value })}
                      className="w-full pl-9 pr-3 py-2 bg-sunken border border-line rounded-lg text-ink text-xs focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Field 4: Category (Auto-suggested via existing keyword rules) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold text-ink-2">
                    Category
                  </label>
                  <span className="text-[10px] text-pos font-medium flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Auto-categorized
                  </span>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-2">
                    <Tag className="w-3.5 h-3.5" />
                  </div>
                  <select
                    id="ocr-category-select"
                    value={preview.category}
                    onChange={(e) => setPreview({ ...preview, category: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 bg-sunken border border-line rounded-lg text-ink text-xs focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all cursor-pointer"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat} className="bg-sunken text-ink">
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Collapsible Extracted Raw OCR Snippet */}
            <div className="pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setShowRawText(!showRawText)}
                className="flex items-center gap-1.5 text-[11px] text-ink-2 hover:text-ink transition-colors cursor-pointer"
              >
                {showRawText ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                <span>{showRawText ? 'Hide extracted text' : 'View extracted OCR text'}</span>
              </button>

              {showRawText && (
                <div className="mt-2 p-2.5 bg-sunken rounded-lg border border-line max-h-28 overflow-y-auto font-mono text-[10px] text-ink-2 whitespace-pre-wrap leading-relaxed">
                  {preview.rawText}
                </div>
              )}
            </div>
          </div>

          {/* Save Error if any */}
          {saveError && (
            <div className="p-3 bg-neg/10 border border-neg/30 text-neg text-xs rounded-lg flex items-center gap-2">
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
              className="flex-1 py-2.5 px-3 bg-surface hover:bg-raised text-ink border border-line rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5 text-ink-2" />
              <span>Cancel & Retake</span>
            </button>

            <button
              id="btn-ocr-confirm-save"
              type="button"
              onClick={handleConfirmSave}
              disabled={isSaving}
              className="flex-1 py-2.5 px-3 bg-accent hover:bg-accent-hi text-canvas rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
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
