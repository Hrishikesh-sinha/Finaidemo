import { useState, useEffect, type FormEvent } from 'react';
import { Mic, X, Loader2, Camera, PenLine } from 'lucide-react';
import { ReceiptScanner } from './ReceiptScanner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onTransactionAdded: () => void;
  token: string;
  initialMethod?: 'manual' | 'voice' | 'ocr';
}

export function TransactionModal({ isOpen, onClose, onTransactionAdded, token, initialMethod = 'manual' }: Props) {
  const [method, setMethod] = useState<'manual' | 'voice' | 'ocr'>(initialMethod);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Manual state
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  // '' means "automatic": the server files it with its categorizer.
  const [categoryChoice, setCategoryChoice] = useState('');
  const [suggestion, setSuggestion] = useState<{ category: string; method: 'rule' | 'model' | 'default' } | null>(null);
  
  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');

  // Sync tab method when opening modal
  useEffect(() => {
    if (isOpen) {
      setMethod(initialMethod);
      setError('');
      setAmount('');
      setMerchant('');
      setTranscript('');
      setCategoryChoice('');
      setSuggestion(null);
    }
  }, [isOpen, initialMethod]);

  // Live suggestion from the server's categorizer while the merchant is typed.
  useEffect(() => {
    const text = merchant.trim();
    if (!isOpen || text.length < 2) {
      setSuggestion(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/categorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text }),
          signal: ctrl.signal
        });
        if (res.ok) setSuggestion(await res.json());
      } catch {
        // No suggestion shown; the server still categorizes on save.
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [merchant, isOpen, token]);

  if (!isOpen) return null;

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount: parseFloat(amount), merchant, ...(categoryChoice ? { category: categoryChoice } : {}) })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to add transaction');
      }
      onTransactionAdded();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startVoiceRecording = () => {
    if (!('webkitSpeechRecognition' in window)) {
      setError('Voice recognition not supported in this browser.');
      return;
    }
    const SpeechRecognition = (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = () => {
      setIsRecording(true);
      setError('');
    };
    
    recognition.onresult = (event: any) => {
      const current = event.resultIndex;
      const t = event.results[current][0].transcript;
      setTranscript(t);
      handleVoiceSubmit(t);
    };
    
    recognition.onerror = (event: any) => {
      setError(`Voice error: ${event.error}`);
      setIsRecording(false);
    };
    
    recognition.onend = () => setIsRecording(false);
    recognition.start();
  };

  const handleVoiceSubmit = async (text: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/transactions/voice?text=${encodeURIComponent(text)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to process voice entry');
      }
      onTransactionAdded();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/45 backdrop-blur-xs">
      <div className="bg-sunken border border-line rounded-lg shadow-2xl w-full max-w-lg overflow-hidden relative font-sans text-ink max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 pb-3 flex items-center justify-between border-b border-line bg-canvas/60">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Add a transaction</h2>
          </div>
          <button 
            onClick={onClose} 
            className="text-ink-2 hover:text-ink p-1.5 rounded-md hover:bg-surface transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Modal Body */}
        <div className="p-5 overflow-y-auto scrollbar-thin scrollbar-thumb-line">
          {/* Navigation Tabs */}
          <div className="flex space-x-1.5 mb-5 p-1 bg-canvas rounded-lg border border-line">
            <button 
              id="tab-manual"
              type="button"
              onClick={() => setMethod('manual')}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                method === 'manual' 
                  ? 'bg-accent text-canvas' 
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              <PenLine className="w-3.5 h-3.5" />
              <span>Manual</span>
            </button>
            <button 
              id="tab-scan-receipt"
              type="button"
              onClick={() => setMethod('ocr')}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                method === 'ocr' 
                  ? 'bg-accent text-canvas' 
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scan Receipt</span>
            </button>
            <button 
              id="tab-voice"
              type="button"
              onClick={() => setMethod('voice')}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                method === 'voice' 
                  ? 'bg-accent text-canvas' 
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Voice</span>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-neg/10 border border-neg/30 text-neg text-xs rounded-lg">
              {error}
            </div>
          )}

          {/* TAB 1: Manual Entry Form */}
          {method === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-2 mb-1.5">
                  Amount (₹)
                </label>
                <input 
                  id="manual-amount-input"
                  type="number" 
                  step="0.01"
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-ink font-mono text-xs placeholder-ink-2 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-2 mb-1.5">
                  Merchant
                </label>
                <input 
                  id="manual-merchant-input"
                  type="text" 
                  required
                  value={merchant}
                  onChange={e => setMerchant(e.target.value)}
                  className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-ink text-xs placeholder-ink-2 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                  placeholder="e.g. Blue Tokai Coffee"
                />
              </div>
              <div>
                <label htmlFor="manual-category-select" className="block text-xs font-semibold text-ink-2 mb-1.5">
                  Category
                </label>
                <select
                  id="manual-category-select"
                  value={categoryChoice}
                  onChange={e => setCategoryChoice(e.target.value)}
                  className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-ink text-xs focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                >
                  <option value="">{suggestion ? `Automatic: ${suggestion.category}` : 'Automatic'}</option>
                  {['Bills', 'Food', 'Transport', 'Shopping', 'Entertainment'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <p id="manual-category-hint" className="mt-1.5 text-[11px] text-ink-3" aria-live="polite">
                  {categoryChoice
                    ? 'You chose this category.'
                    : !suggestion
                      ? 'FinAI picks a category from the merchant name. You can choose one instead.'
                      : suggestion.method === 'rule'
                        ? `${suggestion.category}: matched a known merchant keyword.`
                        : suggestion.method === 'model'
                          ? `${suggestion.category}: suggested by FinAI's learned model. Change it if it is wrong.`
                          : 'No match found, so it will be filed as Shopping unless you choose.'}
                </p>
              </div>
              <button 
                id="btn-manual-submit"
                disabled={loading} 
                type="submit" 
                className="w-full bg-accent text-canvas font-medium py-2.5 rounded-lg hover:bg-accent-hi transition-colors flex items-center justify-center text-sm mt-6 cursor-pointer disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add transaction'}
              </button>
            </form>
          )}

          {/* TAB 2: Scan Receipt (Client-Side Tesseract.js OCR) */}
          {method === 'ocr' && (
            <ReceiptScanner 
              token={token} 
              onSuccess={() => {
                onTransactionAdded();
                onClose();
              }}
              onCancel={onClose}
              onSwitchToManual={() => setMethod('manual')}
            />
          )}

          {/* TAB 3: Voice Note */}
          {method === 'voice' && (
            <div className="flex flex-col items-center justify-center py-6 space-y-4">
              <button 
                id="btn-record-voice"
                onClick={startVoiceRecording}
                disabled={isRecording || loading}
                className={`p-5 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isRecording ? 'bg-neg/20 text-neg animate-pulse border border-neg/40' : 'bg-surface text-accent border border-line hover:border-accent'
                }`}
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin text-accent" /> : <Mic className="w-6 h-6" />}
              </button>
              <div className="text-center">
                <p className="text-xs font-medium text-ink">
                  {isRecording ? 'Listening...' : 'Tap microphone to dictate'}
                </p>
                <p className="text-[11px] text-ink-2 mt-1 italic font-sans">
                  "Spent 350 rupees on books at Crossword"
                </p>
              </div>
              {transcript && (
                <div className="w-full p-3 bg-canvas border border-line rounded-lg text-xs text-ink italic">
                  "{transcript}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
