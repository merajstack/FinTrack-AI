"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getUser, getAllTransactions, clearTransactions } from "@/lib/db";
import type { Transaction } from "@/lib/db";

const CATEGORIES = [
  "All", "Food", "Transport", "Shopping", "Entertainment", "Utilities",
  "Health", "Salary", "Freelance", "Investment", "Savings", "Transfer", "Other",
];

function fmt(n: number) {
  return "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function TransactionsPage() {
  const router = useRouter();
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUser().then((u) => {
      if (!u) router.replace("/signup");
    });
    getAllTransactions().then((data) => {
      setTxs(data.sort((a, b) => b.date.localeCompare(a.date)));
      setLoading(false);
    });
  }, [router]);

  const filtered = txs.filter((t) => {
    const matchCat = filter === "All" || t.category === filter;
    const matchSearch = !search || t.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const totalIncome = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalExpense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + Math.abs(t.amount), 0);
  const flagged = txs.filter((t) => t.isFlagged);

  const handleClear = async () => {
    if (!window.confirm("Are you sure? This will delete all transaction data.")) return;
    await clearTransactions();
    setTxs([]);
  };

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px" }} className="fade-in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
          <div>
            <p style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Transactions
            </p>
            <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>All Transactions</h1>
          </div>
          {txs.length > 0 && (
            <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={handleClear}>
              Clear All
            </button>
          )}
        </div>

        {/* Summary */}
        {txs.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Income", value: fmt(totalIncome), color: "var(--success)" },
              { label: "Expenses", value: fmt(totalExpense), color: "var(--danger)" },
              { label: "Net", value: (totalIncome - totalExpense >= 0 ? "+" : "-") + fmt(totalIncome - totalExpense), color: totalIncome - totalExpense >= 0 ? "var(--success)" : "var(--danger)" },
            ].map((s) => (
              <div key={s.label} className="card" style={{ padding: "16px 20px" }}>
                <p className="label">{s.label}</p>
                <p style={{ fontFamily: "Space Mono, monospace", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Fraud banner */}
        {flagged.length > 0 && (
          <div className="card-flat" style={{ padding: "12px 20px", borderColor: "var(--danger)", background: "#fff5f5", marginBottom: 20, display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 20 }}>⚠</span>
            <p style={{ fontSize: 14, color: "var(--danger)", fontWeight: 600 }}>
              {flagged.length} transaction{flagged.length > 1 ? "s" : ""} flagged as potentially fraudulent.
            </p>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Search by description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            style={{ width: "auto" }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ color: "var(--muted)", fontFamily: "Space Mono, monospace", fontSize: 13 }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 36 }}>📭</p>
            <h2 style={{ fontWeight: 700, marginTop: 12 }}>No transactions found</h2>
            <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 14 }}>
              {txs.length === 0 ? "Upload a bank statement to see your transactions." : "Try a different filter."}
            </p>
            {txs.length === 0 && (
              <a href="/upload" className="btn btn-primary" style={{ display: "inline-flex", marginTop: 20 }}>Upload →</a>
            )}
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--fg)", color: "#fff" }}>
                  {["Date", "Description", "Category", "Amount", "Type", "Flag"].map((h) => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontFamily: "Space Mono, monospace", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx, i) => (
                  <tr key={tx.id} style={{ borderBottom: "1px solid #e5e5e5", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 16px", fontFamily: "Space Mono, monospace", fontSize: 13 }}>{tx.date}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500, maxWidth: 280 }}>{tx.description}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="badge">{tx.category}</span>
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: 14, color: tx.type === "income" ? "var(--success)" : "var(--danger)" }}>
                      {tx.type === "income" ? "+" : "-"}{fmt(tx.amount)}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="badge" style={{ background: tx.type === "income" ? "var(--success)" : "transparent", color: tx.type === "income" ? "#fff" : "var(--fg)", borderColor: tx.type === "income" ? "var(--success)" : "var(--fg)" }}>
                        {tx.type}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {tx.isFlagged && <span style={{ color: "var(--danger)", fontWeight: 700 }}>⚠</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
