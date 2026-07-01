"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getAllTransactions, getUser } from "@/lib/db";
import type { Transaction, UserProfile } from "@/lib/db";
import { useDbSync } from "@/lib/useDbSync";

function fmt(n: number) {
  return "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

const FIXED_CATEGORIES = new Set(["Utilities", "Health", "Transport", "Food", "Rent", "Transfer"]);
const DISCRETIONARY_CATEGORIES = new Set(["Shopping", "Entertainment", "Other"]);

export default function RunwayPage() {
  const router = useRouter();
  const { revision } = useDbSync();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      const u = await getUser();
      if (!u) {
        router.replace("/signup");
        return;
      }

      const data = await getAllTransactions();
      if (!active) return;
      setUser(u);
      setTxs(data);
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [router, revision]);

  const runway = useMemo(() => {
    const income = txs.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
    const fixed = txs
      .filter((tx) => tx.type === "expense" && FIXED_CATEGORIES.has(tx.category))
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    const discretionary = txs
      .filter((tx) => tx.type === "expense" && DISCRETIONARY_CATEGORIES.has(tx.category))
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    const liquid = Math.max(0, income - fixed - discretionary);
    const dailyBurn = (fixed + discretionary) / 30.4;

    return {
      income,
      fixed,
      discretionary,
      liquid,
      dailyBurn,
      days: dailyBurn > 0 ? liquid / dailyBurn : 0,
    };
  }, [txs]);

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }} className="fade-in">
        <div style={{ marginBottom: 24 }}>
          <p className="label">Runway</p>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>Financial Runway</h1>
          <p style={{ color: "var(--muted)", marginTop: 6 }}>
            A local-only view using uploaded transaction data.
          </p>
        </div>

        {loading ? (
          <div className="card" style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontFamily: "var(--font-space-mono), monospace", color: "var(--muted)" }}>Loading runway…</p>
          </div>
        ) : txs.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>No transactions yet</h2>
            <p style={{ color: "var(--muted)", marginTop: 8 }}>
              Upload a bank statement first so the runway calculator can analyze your cash flow.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 20 }} className="modeling-layout">
            <section className="card" style={{ padding: 28 }}>
              <p className="label">Runway estimate</p>
              <div style={{ marginTop: 10 }}>
                <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 54, fontWeight: 700, lineHeight: 1 }}>
                  {Math.max(0, Math.round(runway.days))}
                </p>
                <p style={{ marginTop: 6, fontSize: 14, color: "var(--muted)" }}>days of runway remaining</p>
              </div>

              <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
                <div className="card-flat" style={{ padding: 16 }}>
                  <p className="label">Liquid</p>
                  <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 22, fontWeight: 700 }}>{fmt(runway.liquid)}</p>
                </div>
                <div className="card-flat" style={{ padding: 16 }}>
                  <p className="label">Daily burn</p>
                  <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 22, fontWeight: 700 }}>{fmt(runway.dailyBurn)}</p>
                </div>
                <div className="card-flat" style={{ padding: 16 }}>
                  <p className="label">Fixed spend</p>
                  <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 22, fontWeight: 700 }}>{fmt(runway.fixed)}</p>
                </div>
                <div className="card-flat" style={{ padding: 16 }}>
                  <p className="label">Discretionary spend</p>
                  <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 22, fontWeight: 700 }}>{fmt(runway.discretionary)}</p>
                </div>
              </div>
            </section>

            <aside className="card" style={{ padding: 28 }}>
              <p className="label">Profile</p>
              <p style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>{user?.name}</p>
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>Monthly income</span>
                  <strong>{fmt(user?.monthlyIncome ?? 0)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>Uploaded income</span>
                  <strong>{fmt(runway.income)}</strong>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>
    </>
  );
}