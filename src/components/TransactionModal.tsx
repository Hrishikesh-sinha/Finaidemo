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
    }
  }, [isOpen, initialMethod]);

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
        body: JSON.stringify({ amount: parseFloat(amount), merchant })
      });
      if (!res.ok) throw new Error('Failed to add transaction');
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
      if (!res.ok) throw new Error('Failed to process voice');
      onTransactionAdded();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div className="bg-[#161B22] border border-[#2A2F3A] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden relative font-sans text-[#E6EDF3] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 pb-3 flex items-center justify-between border-b border-[#2A2F3A] bg-[#0D1117]/60">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30">
              Journal Entry
            </span>
            <h2 className="text-base font-bold text-[#E6EDF3] tracking-tight">Record Transaction</h2>
          </div>
          <button 
            onClick={onClose} 
            className="text-[#8B949E] hover:text-[#E6EDF3] p-1.5 rounded-md hover:bg-[#21262D] transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Modal Body */}
        <div className="p-5 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2A2F3A]">
          {/* Navigation Tabs */}
          <div className="flex space-x-1.5 mb-5 p-1 bg-[#0D1117] rounded-lg border border-[#2A2F3A]">
            <button 
              id="tab-manual"
              type="button"
              onClick={() => setMethod('manual')}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                method === 'manual' 
                  ? 'bg-[#4A9EFF] text-white shadow-xs' 
                  : 'text-[#8B949E] hover:text-[#E6EDF3]'
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
                  ? 'bg-[#4A9EFF] text-white shadow-xs' 
                  : 'text-[#8B949E] hover:text-[#E6EDF3]'
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
                  ? 'bg-[#4A9EFF] text-white shadow-xs' 
                  : 'text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Voice Note</span>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-[#F85149]/10 border border-[#F85149]/30 text-[#F85149] text-xs rounded-lg">
              {error}
            </div>
          )}

          {/* TAB 1: Manual Entry Form */}
          {method === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-[#8B949E] mb-1.5">
                  Amount (₹)
                </label>
                <input 
                  id="manual-amount-input"
                  type="number" 
                  step="0.01"
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] font-mono text-xs placeholder-[#8B949E] focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-[#8B949E] mb-1.5">
                  Counterparty / Merchant
                </label>
                <input 
                  id="manual-merchant-input"
                  type="text" 
                  required
                  value={merchant}
                  onChange={e => setMerchant(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] text-xs placeholder-[#8B949E] focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all"
                  placeholder="e.g. Blue Tokai Coffee"
                />
              </div>
              <button 
                id="btn-manual-submit"
                disabled={loading} 
                type="submit" 
                className="w-full bg-[#4A9EFF] text-white font-medium py-2.5 rounded-lg hover:bg-[#3b8eed] transition-colors flex items-center justify-center text-xs tracking-wider mt-6 shadow-xs cursor-pointer disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'COMMIT LEDGER ENTRY'}
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
                  isRecording ? 'bg-[#F85149]/20 text-[#F85149] animate-pulse border border-[#F85149]/40' : 'bg-[#21262D] text-[#4A9EFF] border border-[#2A2F3A] hover:border-[#4A9EFF]'
                }`}
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin text-[#4A9EFF]" /> : <Mic className="w-6 h-6" />}
              </button>
              <div className="text-center">
                <p className="text-xs font-medium text-[#E6EDF3]">
                  {isRecording ? 'Listening...' : 'Tap microphone to dictate'}
                </p>
                <p className="text-[11px] text-[#8B949E] mt-1 italic font-sans">
                  "Spent 350 rupees on books at Crossword"
                </p>
              </div>
              {transcript && (
                <div className="w-full p-3 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-xs text-[#E6EDF3] italic">
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
