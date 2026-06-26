"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getUser, getAllTransactions, getAllInsights } from "@/lib/db";
import { chatWithAI } from "@/lib/gemini";
import type { UserProfile, Transaction, MonthlyInsight } from "@/lib/db";
import type { ChatMessage } from "@/lib/gemini";

function fmt(n: number) {
  return "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function buildContext(user: UserProfile, txs: Transaction[], insights: MonthlyInsight[]): string {
  const totalIncome = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalExpense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + Math.abs(t.amount), 0);
  const latest = insights[0];
  return `User: ${user.name}, Age: ${user.age}. Monthly income target: ${fmt(user.monthlyIncome)}. Savings goal: ${fmt(user.savingsGoal)}/month. Investment goal: ${fmt(user.investmentGoal)}/month. All-time income in system: ${fmt(totalIncome)}, all-time expenses: ${fmt(totalExpense)}. Health score: ${latest?.healthScore ?? "N/A"}/100. Savings rate: ${latest?.savingsRate ?? "N/A"}%. Top spending categories: ${latest ? Object.entries(latest.categoryBreakdown).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k} (${fmt(v)})`).join(", ") : "N/A"}.`;
}

const STARTERS = [
  "How can I improve my savings rate?",
  "Analyse my spending habits",
  "What's my biggest expense category?",
  "Give me a budget plan for next month",
  "How do I reach my investment goal?",
];

export default function ChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const u = await getUser();
      if (!u) { router.replace("/signup"); return; }
      const txs = await getAllTransactions();
      const ins = await getAllInsights();
      setUser(u);
      setContext(buildContext(u, txs, ins));
      setMessages([{
        role: "model",
        text: `Hey ${u.name.split(" ")[0]}! 👋 I'm FinTrack AI. I have access to your financial profile and transaction data. Ask me anything about your spending, savings, budgeting, or financial health!`,
      }]);
    }
    load();
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading || !user) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", text: msg };
    const newMsgs: ChatMessage[] = [...messages, userMsg];
    setMessages(newMsgs);
    setLoading(true);
    try {
      const contextMsg: ChatMessage = { role: "user", text: `[Context] ${context}` };
      const reply = await chatWithAI(
        [contextMsg, ...newMsgs],
        user.aiApiKey || user.geminiKey,
        user.aiProvider || 'gemini',
        user.aiBaseUrl,
        user.aiModel
      );
      setMessages([...newMsgs, { role: "model", text: reply }]);
    } catch (e: any) {
      const errorMsgText = e.message || "";
      const is503 = errorMsgText.includes("503") || errorMsgText.includes("demand") || errorMsgText.includes("UNAVAILABLE");
      const isExpired = errorMsgText.includes("API_KEY_INVALID") || 
                        errorMsgText.toLowerCase().includes("expired") || 
                        errorMsgText.toLowerCase().includes("api key not valid") ||
                        errorMsgText.toLowerCase().includes("billing") ||
                        errorMsgText.toLowerCase().includes("quota");
      
      if (is503) {
        setToast("Due to high demand on model, unable to answer. Please try again.");
        setInput(msg);
        setMessages(messages); // Reset messages to original state (revert userMsg from UI)
        setTimeout(() => setToast(null), 4000);
      } else if (isExpired) {
        setToast("Your API key has expired, please change to a new one or get it billed");
        setInput(msg);
        setMessages(messages);
        setTimeout(() => setToast(null), 4000);
      } else {
        setMessages([...newMsgs, { role: "model", text: `⚠ Error: ${e.message}` }]);
      }
    }
    setLoading(false);
  };

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
        {/* Header */}
        <div style={{ marginBottom: 20, flexShrink: 0 }}>
          <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            AI Advisor
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>FinTrack AI Chat</h1>
        </div>

        {/* Starters */}
        {messages.length <= 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, flexShrink: 0 }}>
            {STARTERS.map((s) => (
              <button
                key={s}
                className="btn btn-outline"
                style={{ fontSize: 12, padding: "6px 12px" }}
                onClick={() => send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="card" style={{ flex: 1, overflowY: "auto", padding: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "80%",
                  padding: "12px 16px",
                  background: m.role === "user" ? "var(--fg)" : "#f7f7f5",
                  color: m.role === "user" ? "#fff" : "var(--fg)",
                  border: "2px solid var(--border)",
                  boxShadow: m.role === "model" ? "3px 3px 0 var(--border)" : "none",
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}>
                  {m.role === "model" && (
                    <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 10, color: "var(--accent)", fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      ◈ FinTrack AI
                    </p>
                  )}
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ padding: "12px 16px", border: "2px solid var(--border)", background: "#f7f7f5" }}>
                  <span style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 13, color: "var(--muted)" }}>
                    Thinking…
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "16px 24px", borderTop: "2px solid var(--border)", display: "flex", gap: 10 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Ask about your finances…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              disabled={loading}
            />
            <button
              className="btn btn-primary"
              style={{ flexShrink: 0, padding: "10px 20px" }}
              onClick={() => send()}
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </main>

      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          background: "#fff",
          color: "var(--danger)",
          border: "2px solid var(--danger)",
          boxShadow: "4px 4px 0 var(--danger)",
          padding: "16px 20px",
          zIndex: 1000,
          fontFamily: "var(--font-space-mono), monospace",
          fontSize: 13,
          fontWeight: 700,
        }} className="fade-in">
          ✕ {toast}
        </div>
      )}
    </>
  );
}
