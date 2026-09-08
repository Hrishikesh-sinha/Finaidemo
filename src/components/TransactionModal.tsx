import { useState, useRef, type FormEvent, type ChangeEvent } from 'react';
import { Mic, UploadCloud, X, Loader2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onTransactionAdded: () => void;
  token: string;
}

export function TransactionModal({ isOpen, onClose, onTransactionAdded, token }: Props) {
  const [method, setMethod] = useState<'manual' | 'voice' | 'ocr'>('manual');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Manual state
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  
  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');

  // OCR state
  const [ocrPreview, setOcrPreview] = useState<{ amount: number, merchant: string, preview_text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    setLoading(true);
    setError('');
    const formData = new FormData();
    formData.append('file', e.target.files[0]);
    
    try {
      const res = await fetch('/api/transactions/ocr', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!res.ok) throw new Error('Failed to process image OCR');
      const data = await res.json();
      setOcrPreview(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmOcr = async () => {
    if (!ocrPreview) return;
    setLoading(true);
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount: ocrPreview.amount, merchant: ocrPreview.merchant })
      });
      if (!res.ok) throw new Error('Failed to save OCR transaction');
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
      <div className="bg-[#161B22] border border-[#2A2F3A] rounded-xl shadow-2xl w-full max-w-md overflow-hidden relative font-sans text-[#E6EDF3]">
        <button onClick={onClose} className="absolute right-4 top-4 text-[#8B949E] hover:text-[#E6EDF3] p-1.5 rounded-md hover:bg-[#21262D] transition-colors">
          <X className="w-4 h-4" />
        </button>
        
        <div className="p-6">
          <div className="mb-5">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30">Ledger Entry</span>
            <h2 className="text-lg font-bold text-[#E6EDF3] tracking-tight mt-2">Record Transaction</h2>
          </div>
          
          <div className="flex space-x-1.5 mb-5 p-1 bg-[#0D1117] rounded-lg border border-[#2A2F3A]">
            <button 
              onClick={() => { setMethod('manual'); setOcrPreview(null); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${method === 'manual' ? 'bg-[#4A9EFF] text-white shadow-xs' : 'text-[#8B949E] hover:text-[#E6EDF3]'}`}
            >
              Manual
            </button>
            <button 
              onClick={() => { setMethod('voice'); setOcrPreview(null); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${method === 'voice' ? 'bg-[#4A9EFF] text-white shadow-xs' : 'text-[#8B949E] hover:text-[#E6EDF3]'}`}
            >
              Voice Note
            </button>
            <button 
              onClick={() => { setMethod('ocr'); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${method === 'ocr' ? 'bg-[#4A9EFF] text-white shadow-xs' : 'text-[#8B949E] hover:text-[#E6EDF3]'}`}
            >
              Receipt OCR
            </button>
          </div>

          {error && <div className="mb-4 p-3 bg-[#F85149]/10 border border-[#F85149]/30 text-[#F85149] text-xs rounded-lg">{error}</div>}

          {method === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-[#8B949E] mb-1.5">Amount (₹)</label>
                <input 
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
                <label className="block text-xs uppercase tracking-wider font-semibold text-[#8B949E] mb-1.5">Counterparty / Merchant</label>
                <input 
                  type="text" 
                  required
                  value={merchant}
                  onChange={e => setMerchant(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] text-xs placeholder-[#8B949E] focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all"
                  placeholder="e.g. Blue Tokai Coffee"
                />
              </div>
              <button disabled={loading} type="submit" className="w-full bg-[#4A9EFF] text-white font-medium py-2.5 rounded-lg hover:bg-[#3b8eed] transition-colors flex items-center justify-center text-xs tracking-wider mt-6 shadow-xs">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'COMMIT LEDGER ENTRY'}
              </button>
            </form>
          )}

          {method === 'voice' && (
            <div className="flex flex-col items-center justify-center py-6 space-y-4">
              <button 
                onClick={startVoiceRecording}
                disabled={isRecording || loading}
                className={`p-5 rounded-full flex items-center justify-center transition-all ${
                  isRecording ? 'bg-[#F85149]/20 text-[#F85149] animate-pulse border border-[#F85149]/40' : 'bg-[#21262D] text-[#4A9EFF] border border-[#2A2F3A] hover:border-[#4A9EFF]'
                }`}
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin text-[#4A9EFF]" /> : <Mic className="w-6 h-6" />}
              </button>
              <div className="text-center">
                <p className="text-xs font-medium text-[#E6EDF3]">{isRecording ? 'Listening...' : 'Tap microphone to dictate'}</p>
                <p className="text-[11px] text-[#8B949E] mt-1 italic font-sans">"Spent 350 rupees on books at Crossword"</p>
              </div>
              {transcript && (
                <div className="w-full p-3 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-xs text-[#E6EDF3] italic">
                  "{transcript}"
                </div>
              )}
            </div>
          )}

          {method === 'ocr' && (
            <div className="space-y-4">
              {!ocrPreview ? (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[#2A2F3A] bg-[#0D1117]/50 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-[#0D1117] hover:border-[#4A9EFF] transition-all"
                >
                  <UploadCloud className="w-7 h-7 text-[#8B949E] mb-2" />
                  <p className="text-xs font-medium text-[#E6EDF3]">Upload Receipt or Statement</p>
                  <p className="text-[11px] text-[#8B949E] mt-1">JPEG, PNG, WEBP</p>
                  <input type="file" className="hidden" ref={fileInputRef} accept="image/*" onChange={handleFileUpload} />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-[#0D1117] border border-[#2A2F3A] rounded-lg">
                    <h3 className="text-[11px] font-semibold text-[#8B949E] uppercase tracking-wider mb-2.5">Extracted Details</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[#8B949E]">Merchant</span>
                        <span className="text-xs font-medium text-[#E6EDF3]">{ocrPreview.merchant}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[#8B949E]">Amount</span>
                        <span className="text-xs font-mono font-medium text-[#3FB950]">₹{ocrPreview.amount.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-3 pt-2">
                    <button onClick={() => setOcrPreview(null)} className="flex-1 py-2 text-xs font-medium text-[#E6EDF3] bg-[#21262D] border border-[#2A2F3A] rounded-lg hover:bg-[#30363D] transition-colors">
                      Retake
                    </button>
                    <button onClick={confirmOcr} disabled={loading} className="flex-1 py-2 text-xs font-medium text-white bg-[#4A9EFF] rounded-lg hover:bg-[#3b8eed] flex justify-center items-center transition-colors shadow-xs">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
