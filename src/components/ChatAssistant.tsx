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
    { role: 'assistant', content: "Hi. Ask me about your spending, savings or budget. I answer from your own transactions." }
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
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      // Template answers say why Gemini was not used.
      const content = data.source === 'template' && data.note ? `${data.response}\n\n(${data.note})` : data.response;
      setMessages(prev => [...prev, { role: 'assistant', content }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: err?.message && !/fetch/i.test(err.message) ? err.message : 'Unable to reach the assistant. Please check your connection.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 h-[500px] bg-sunken rounded-lg shadow-2xl flex flex-col border border-line overflow-hidden font-sans text-ink">
      {/* Header */}
      <div className="bg-sunken px-4 py-3 flex items-center justify-between border-b border-line z-10 backdrop-blur-md">
        <div className="flex items-center space-x-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pos opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-pos"></span>
          </span>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-ink tracking-wide">FinAI Copilot</h3>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30 font-medium">
              Assistant
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-ink-2 hover:text-ink p-1 rounded-md hover:bg-surface transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto bg-canvas flex flex-col space-y-3 text-xs">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
              className={`max-w-[85%] rounded-lg px-3.5 py-2.5 leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-accent text-canvas font-normal' 
                  : 'bg-sunken text-ink border border-line'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-sunken border border-line rounded-lg px-3 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 bg-sunken border-t border-line">
        <form onSubmit={sendMessage} className="flex items-center space-x-2 bg-canvas rounded-lg border border-line p-1">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="For example: where did most of my money go this month?"
            className="flex-1 px-2.5 py-1.5 bg-transparent border-none text-xs text-ink focus:outline-none placeholder-ink-2 font-sans"
          />
          <button 
            type="submit" 
            disabled={loading || !input.trim()}
            className="w-7 h-7 bg-accent text-canvas rounded-md flex items-center justify-center hover:bg-accent-hi disabled:opacity-40 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
