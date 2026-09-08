import { useState, type FormEvent } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';

interface Props {
  token: string;
  onClose: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatAssistant({ token, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Good day. I am your portfolio advisory assistant. I have reviewed your allocation benchmarks, cash flows, and recent ledger entries. How may I assist your financial planning today?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ prompt: userMsg })
      });
      
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Unable to communicate with the advisory service. Please verify your connection.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 h-[500px] bg-[#161B22] rounded-xl shadow-2xl flex flex-col border border-[#2A2F3A] overflow-hidden font-sans text-[#E6EDF3]">
      {/* Header */}
      <div className="bg-[#161B22] px-4 py-3 flex items-center justify-between border-b border-[#2A2F3A] z-10 backdrop-blur-md">
        <div className="flex items-center space-x-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3FB950] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3FB950]"></span>
          </span>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-[#E6EDF3] tracking-wide">FinAI Copilot</h3>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30 font-medium">
              Assistant
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-[#8B949E] hover:text-[#E6EDF3] p-1 rounded-md hover:bg-[#21262D] transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto bg-[#0D1117] flex flex-col space-y-3 text-xs">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
              className={`max-w-[85%] rounded-lg px-3.5 py-2.5 leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-[#4A9EFF] text-white font-normal shadow-xs' 
                  : 'bg-[#161B22] text-[#E6EDF3] border border-[#2A2F3A] shadow-xs'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#161B22] border border-[#2A2F3A] rounded-lg px-3 py-2 shadow-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4A9EFF]" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 bg-[#161B22] border-t border-[#2A2F3A]">
        <form onSubmit={sendMessage} className="flex items-center space-x-2 bg-[#0D1117] rounded-lg border border-[#2A2F3A] p-1">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about spending velocity, forecasts, anomaly..."
            className="flex-1 px-2.5 py-1.5 bg-transparent border-none text-xs text-[#E6EDF3] focus:outline-none placeholder-[#8B949E] font-sans"
          />
          <button 
            type="submit" 
            disabled={loading || !input.trim()}
            className="w-7 h-7 bg-[#4A9EFF] text-white rounded-md flex items-center justify-center hover:bg-[#3b8eed] disabled:opacity-40 transition-colors shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
