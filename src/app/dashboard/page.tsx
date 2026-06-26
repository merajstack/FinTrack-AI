"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getUser, getAllTransactions, getAllInsights } from "@/lib/db";
import type { UserProfile, Transaction, MonthlyInsight } from "@/lib/db";

function fmt(n: number) {
  return "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function HealthGauge({ score }: { score: number }) {
  const color = score >= 75 ? "var(--success)" : score >= 50 ? "var(--warning)" : "var(--danger)";
  const label = score >= 75 ? "Excellent" : score >= 50 ? "Good" : "Needs Work";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 48, fontWeight: 700, fontFamily: "Space Mono, monospace", color }}>
          {score}
        </span>
        <span className="badge" style={{ background: color, color: "#fff", borderColor: color }}>{label}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", fontFamily: "Space Mono, monospace" }}>Financial Health Score / 100</p>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="card" style={{ padding: "24px 20px" }}>
      <p className="label">{label}</p>
      <p style={{ fontSize: 28, fontWeight: 700, marginTop: 4, fontFamily: "Space Mono, monospace", color: accent ?? "var(--fg)" }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [insights, setInsights] = useState<MonthlyInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const u = await getUser();
      if (!u) { router.replace("/signup"); return; }
      const t = await getAllTransactions();
      const i = await getAllInsights();
      setUser(u);
      setTxs(t);
      setInsights(i.sort((a, b) => b.id.localeCompare(a.id)));
      setLoading(false);
    }
    load();
  }, [router]);

  if (loading) {
    return (
      <>
        <Nav />
        <div style={{ padding: 48, textAlign: "center", color: "var(--muted)", fontFamily: "Space Mono, monospace" }}>
          Loading your data…
        </div>
      </>
    );
  }

  const latestInsight = insights[0] ?? null;
  const totalExpenses = txs.filter((t) => t.type === "expense").reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalIncome = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const fraudCount = txs.filter((t) => t.isFlagged).length;

  // Category breakdown from all transactions
  const catMap: Record<string, number> = {};
  txs.filter((t) => t.type === "expense").forEach((t) => {
    catMap[t.category] = (catMap[t.category] ?? 0) + Math.abs(t.amount);
  });
  const topCats = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const maxCat = topCats[0]?.[1] ?? 1;

  return (
    <>
      <Nav />
      <main style={{ padding: "32px 24px", maxWidth: 1100, margin: "0 auto" }} className="fade-in">
        {/* Greeting */}
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Dashboard
          </p>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>
            Hey, {user?.name?.split(" ")[0]} 👋
          </h1>
          <p style={{ color: "var(--muted)", marginTop: 4 }}>
            Here's your financial overview. Keep tracking to get better insights.
          </p>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 32 }}>
          <StatCard label="Total Income" value={fmt(totalIncome)} sub="All-time uploaded" accent="var(--success)" />
          <StatCard label="Total Expenses" value={fmt(totalExpenses)} sub="All-time uploaded" accent="var(--danger)" />
          <StatCard label="Monthly Income Goal" value={fmt(user?.monthlyIncome ?? 0)} />
          <StatCard label="Savings Goal" value={fmt(user?.savingsGoal ?? 0)} sub="Per month" />
          <StatCard label="Investment Goal" value={fmt(user?.investmentGoal ?? 0)} sub="Per month" />
          <StatCard
            label="Fraud Alerts"
            value={fraudCount > 0 ? `⚠ ${fraudCount}` : "✓ None"}
            sub={fraudCount > 0 ? "Review transactions" : "All clear"}
            accent={fraudCount > 0 ? "var(--danger)" : "var(--success)"}
          />
        </div>

        {/* Health score + Recommendations */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
          <div className="card" style={{ padding: 28 }}>
            <p className="label" style={{ marginBottom: 16 }}>Financial Health Score</p>
            {latestInsight ? (
              <HealthGauge score={latestInsight.healthScore} />
            ) : (
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)" }}>
                <p style={{ fontFamily: "Space Mono, monospace", fontSize: 14 }}>No data yet.</p>
                <p style={{ fontSize: 13, marginTop: 8 }}>Upload a bank statement to get your score.</p>
                <a href="/upload" className="btn btn-primary" style={{ display: "inline-flex", marginTop: 16 }}>Upload now →</a>
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 28 }}>
            <p className="label" style={{ marginBottom: 12 }}>AI Recommendations</p>
            {latestInsight?.recommendations ? (
              <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg)", whiteSpace: "pre-line" }}>
                {latestInsight.recommendations}
              </p>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: 14, fontFamily: "Space Mono, monospace" }}>
                Upload a statement to get personalised advice.
              </p>
            )}
          </div>
        </div>

        {/* Category Breakdown */}
        {topCats.length > 0 && (
          <div className="card" style={{ padding: 28, marginBottom: 32 }}>
            <p className="label" style={{ marginBottom: 20 }}>Spending by Category</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {topCats.map(([cat, amount]) => (
                <div key={cat}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{cat}</span>
                    <span style={{ fontFamily: "Space Mono, monospace", fontSize: 14, color: "var(--danger)" }}>
                      {fmt(amount)}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${(amount / maxCat) * 100}%`, background: "var(--fg)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fraud flags */}
        {latestInsight?.fraudFlags && latestInsight.fraudFlags.length > 0 && (
          <div className="card" style={{ padding: 28, borderColor: "var(--danger)", boxShadow: "4px 4px 0 var(--danger)", marginBottom: 32 }}>
            <p className="label" style={{ color: "var(--danger)" }}>⚠ Fraud Alerts</p>
            <ul style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {latestInsight.fraudFlags.map((f, i) => (
                <li key={i} style={{ fontSize: 14, color: "var(--fg)", display: "flex", gap: 8 }}>
                  <span style={{ color: "var(--danger)" }}>●</span> {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recent Transactions */}
        {txs.length > 0 && (
          <div className="card" style={{ padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p className="label">Recent Transactions</p>
              <a href="/transactions" style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: "var(--accent2)" }}>
                View all →
              </a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {txs.slice(0, 8).map((tx, i) => (
                <div key={tx.id} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 0",
                  borderBottom: i < 7 ? "1px solid #e5e5e5" : "none",
                }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{tx.description}</span>
                      <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "Space Mono, monospace" }}>
                        {tx.date} · {tx.category}
                        {tx.isFlagged && <span style={{ color: "var(--danger)", marginLeft: 6 }}>⚠ Flagged</span>}
                      </span>
                    </div>
                  </div>
                  <span style={{
                    fontFamily: "Space Mono, monospace",
                    fontWeight: 700,
                    fontSize: 15,
                    color: tx.type === "income" ? "var(--success)" : "var(--danger)",
                  }}>
                    {tx.type === "income" ? "+" : "-"}{fmt(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {txs.length === 0 && (
          <div className="card" style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 40 }}>📄</p>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 16 }}>No statements uploaded yet</h2>
            <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 14 }}>
              Upload your first bank statement to see spending insights, categories, and your health score.
            </p>
            <a href="/upload" className="btn btn-primary" style={{ display: "inline-flex", marginTop: 24 }}>
              Upload Statement →
            </a>
          </div>
        )}
      </main>
    </>
  );
}
