"use client";

import { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Nav from "@/components/Nav";
import { getUser } from "@/lib/db";
import type { UserProfile } from "@/lib/db";
import {
  calculateFinancialProjection,
  recalculateScenario,
} from "@/lib/scenarioModeling";
import type {
  CompoundingInterval,
  FinancialVariables,
  Scenario,
} from "@/lib/scenarioModeling";
import { chatWithAI } from "@/lib/gemini";

const COLORS = ["#0014ff", "#ff4f00", "#00a86b", "#7c3aed", "#111111"];
const HORIZONS = [10, 20, 30] as const;

type ModelingState = {
  loading: boolean;
  user: UserProfile | null;
  activeScenarioId: string;
  scenarios: Scenario[];
  selectedHorizon: 10 | 20 | 30;
};

type ModelingAction =
  | { type: "loaded"; user: UserProfile; scenarios: Scenario[] }
  | { type: "set_active"; scenarioId: string }
  | { type: "set_horizon"; horizon: 10 | 20 | 30 }
  | { type: "clone"; scenarioId: string }
  | { type: "remove"; scenarioId: string }
  | { type: "update_variables"; scenarioId: string; variables: Partial<FinancialVariables> };

function money(value: number): string {
  return "$" + Math.round(value).toLocaleString("en-US");
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

function formatScenarioSnapshot(scenario: Scenario, horizon: 10 | 20 | 30): string {
  const horizonPoint = scenario.summaryByHorizon[horizon];
  const milestones = scenario.milestones
    .map((milestone) =>
      milestone.point
        ? `${milestone.label} reached in ${milestone.point.year.toFixed(1)} years`
        : `${milestone.label} not reached within the selected horizon`
    )
    .join("; ");

  return [
    `${scenario.name}:`,
    `- Net worth at ${horizon} years: ${money(horizonPoint.netWorth)}`,
    `- Taxable balance: ${money(horizonPoint.taxableBalance)}`,
    `- Tax-advantaged balance: ${money(horizonPoint.taxAdvantagedBalance)}`,
    `- Total contributions: ${money(horizonPoint.totalContributions)}`,
    `- Milestones: ${milestones}`,
  ].join("\n");
}

function buildFallbackAnalysis(
  user: UserProfile,
  activeScenario: Scenario,
  activeSummary: Scenario["summaryByHorizon"][10],
  visibleScenarios: Scenario[],
  horizon: 10 | 20 | 30
): string {
  const goalGap = activeScenario.variables.netWorthGoal - activeSummary.netWorth;
  const downPaymentGap = activeScenario.variables.downPaymentGoal - activeSummary.taxableBalance;
  const returnTrend = activeScenario.realAnnualReturn >= 0.08
    ? "strong"
    : activeScenario.realAnnualReturn >= 0.05
      ? "moderate"
      : "conservative";

  const branchLines = visibleScenarios
    .map((scenario) => {
      const point = scenario.summaryByHorizon[horizon];
      return `${scenario.name}: ${money(point.netWorth)} net worth, ${money(point.totalContributions)} total contributions`;
    })
    .join("\n");

  return [
    "FinTrack AI What-If Analysis",
    `User profile: ${user.name}, monthly income ${money(user.monthlyIncome)}, savings goal ${money(user.savingsGoal)} per month, investment goal ${money(user.investmentGoal)} per month.`,
    `Scenario outlook: the selected plan projects ${money(activeSummary.netWorth)} net worth at ${horizon} years with a ${returnTrend} real return of ${pct(activeScenario.realAnnualReturn)}.`,
    goalGap <= 0
      ? `Net worth goal: on track. The projection reaches the ${money(activeScenario.variables.netWorthGoal)} goal.`
      : `Net worth goal: short by ${money(goalGap)} at the selected horizon.`,
    downPaymentGap <= 0
      ? `Down payment goal: on track with ${money(activeSummary.taxableBalance)} available in the taxable bucket.`
      : `Down payment goal: short by ${money(downPaymentGap)} in the taxable bucket.`,
    `Key branches:\n${branchLines}`,
    "Recommendations:",
    "- Increase monthly contribution if you want to close the net worth gap faster.",
    "- Keep the tax-advantaged split aligned with long-term retirement capital.",
    "- If the down payment target is near-term, shift more savings into the taxable bucket.",
    "- Review the horizon selector to compare 10, 20, and 30 year outcomes before committing to one plan.",
  ].join("\n\n");
}

async function buildAiAnalysis(
  user: UserProfile,
  activeScenario: Scenario,
  activeSummary: Scenario["summaryByHorizon"][10],
  visibleScenarios: Scenario[],
  horizon: 10 | 20 | 30
): Promise<string> {
  const prompt = [
    "You are FinTrack AI, a financial planning analyst.",
    "Write a detailed plain-text analysis for a PDF export of the user's what-if scenario.",
    "Use concise paragraphs and bullet points where useful.",
    "Include: 1) executive summary, 2) strengths, 3) risks, 4) goal progress, 5) next actions.",
    "Reference the exact numbers and compare all scenario branches.",
    "Avoid markdown tables. Keep it readable in a PDF.",
    `User: ${user.name}, income ${money(user.monthlyIncome)}, savings goal ${money(user.savingsGoal)}, investment goal ${money(user.investmentGoal)}.`,
    `Selected horizon: ${horizon} years.`,
    `Active scenario: ${formatScenarioSnapshot(activeScenario, horizon)}`,
    `Active scenario summary at selected horizon: net worth ${money(activeSummary.netWorth)}, taxable ${money(activeSummary.taxableBalance)}, tax-advantaged ${money(activeSummary.taxAdvantagedBalance)}, total contributions ${money(activeSummary.totalContributions)}.`,
    "Scenario comparison:",
    ...visibleScenarios.map((scenario) => formatScenarioSnapshot(scenario, horizon)),
  ].join("\n\n");

  try {
    return await chatWithAI(
      [{ role: "user", text: prompt }],
      user.aiApiKey || user.geminiKey,
      user.aiProvider || "gemini",
      user.aiBaseUrl,
      user.aiModel
    );
  } catch {
    return buildFallbackAnalysis(user, activeScenario, activeSummary, visibleScenarios, horizon);
  }
}

function scenarioId(): string {
  return "scenario_" + Math.random().toString(36).slice(2, 10);
}

function baseVariables(user: UserProfile): FinancialVariables {
  const monthlyIncome = Math.max(0, user.monthlyIncome || 75000);
  const savingsRate = monthlyIncome > 0
    ? Math.min(0.7, Math.max(0.05, (user.savingsGoal || monthlyIncome * 0.2) / monthlyIncome))
    : 0.2;

  return {
    initialNetWorth: Math.max(0, user.savingsGoal * 6 || 25000),
    monthlyIncome,
    savingsRate,
    monthlyContribution: monthlyIncome * savingsRate,
    annualInvestmentReturn: 0.08,
    inflationRate: 0.03,
    taxRate: 0.22,
    taxAdvantagedShare: 0.35,
    compoundingInterval: "monthly",
    downPaymentGoal: 200000,
    netWorthGoal: 1000000,
  };
}

function createScenario(
  name: string,
  color: string,
  variables: FinancialVariables,
  createdFromId?: string
): Scenario {
  return recalculateScenario({
    id: scenarioId(),
    name,
    color,
    variables,
    createdFromId,
    updatedAt: new Date().toISOString(),
  });
}

function initialState(): ModelingState {
  return {
    loading: true,
    user: null,
    activeScenarioId: "",
    scenarios: [],
    selectedHorizon: 30,
  };
}

function reducer(state: ModelingState, action: ModelingAction): ModelingState {
  if (action.type === "loaded") {
    return {
      ...state,
      loading: false,
      user: action.user,
      activeScenarioId: action.scenarios[0]?.id ?? "",
      scenarios: action.scenarios,
    };
  }

  if (action.type === "set_active") {
    return { ...state, activeScenarioId: action.scenarioId };
  }

  if (action.type === "set_horizon") {
    return { ...state, selectedHorizon: action.horizon };
  }

  if (action.type === "clone") {
    const source = state.scenarios.find((scenario) => scenario.id === action.scenarioId);
    if (!source) return state;

    const cloneIndex = state.scenarios.length + 1;
    const cloned = createScenario(
      `Scenario ${String.fromCharCode(64 + cloneIndex)}`,
      COLORS[state.scenarios.length % COLORS.length],
      { ...source.variables },
      source.id
    );

    return {
      ...state,
      activeScenarioId: cloned.id,
      scenarios: [...state.scenarios, cloned],
    };
  }

  if (action.type === "remove") {
    if (state.scenarios.length <= 1) return state;
    const nextScenarios = state.scenarios.filter(
      (scenario) => scenario.id !== action.scenarioId
    );
    return {
      ...state,
      scenarios: nextScenarios,
      activeScenarioId:
        state.activeScenarioId === action.scenarioId
          ? nextScenarios[0]?.id ?? ""
          : state.activeScenarioId,
    };
  }

  if (action.type === "update_variables") {
    return {
      ...state,
      scenarios: state.scenarios.map((scenario) => {
        if (scenario.id !== action.scenarioId) return scenario;

        const nextVariables = {
          ...scenario.variables,
          ...action.variables,
        };

        const result = calculateFinancialProjection(nextVariables);

        return {
          ...scenario,
          variables: nextVariables,
          projection: result.points,
          milestones: result.milestones,
          summaryByHorizon: result.summaryByHorizon,
          realAnnualReturn: result.realAnnualReturn,
          taxableRealAnnualReturn: result.taxableRealAnnualReturn,
          updatedAt: new Date().toISOString(),
        };
      }),
    };
  }

  return state;
}

const SliderRow = memo(function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <label className="label">{label}</label>
        <span style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 12, fontWeight: 700 }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: "100%", accentColor: "var(--fg)" }}
      />
    </div>
  );
});

export default function ModelingPage() {
  const router = useRouter();
  const exportRef = useRef<HTMLElement | null>(null);
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  useEffect(() => {
    getUser().then((user) => {
      if (!user) {
        router.replace("/signup");
        return;
      }

      const base = createScenario("Base Scenario", COLORS[0], baseVariables(user));
      dispatch({ type: "loaded", user, scenarios: [base] });
    });
  }, [router]);

  const activeScenario = state.scenarios.find(
    (scenario) => scenario.id === state.activeScenarioId
  );

  const visibleScenarios = useMemo(
    () =>
      state.scenarios.map((scenario) => ({
        ...scenario,
        projection: scenario.projection.filter(
          (point) => point.year <= state.selectedHorizon
        ),
        milestones: scenario.milestones.filter(
          (milestone) =>
            milestone.point && milestone.point.year <= state.selectedHorizon
        ),
      })),
    [state.scenarios, state.selectedHorizon]
  );

  const chartData = useMemo(() => {
    const rows = new Map<string, Record<string, number>>();

    for (const scenario of visibleScenarios) {
      for (const point of scenario.projection) {
        const key = point.year.toFixed(4);
        const row = rows.get(key) ?? { year: Number(key) };
        row[scenario.id] = Math.round(point.netWorth);
        rows.set(key, row);
      }
    }

    return Array.from(rows.values()).sort((a, b) => a.year - b.year);
  }, [visibleScenarios]);

  const updateActive = (variables: Partial<FinancialVariables>) => {
    if (!activeScenario) return;
    dispatch({
      type: "update_variables",
      scenarioId: activeScenario.id,
      variables,
    });
  };

  const handleDownloadPdf = async () => {
    if (!activeScenario || !state.user || !exportRef.current || exportingPdf) return;

    setExportingPdf(true);
    setExportStatus("Preparing PDF...");

    try {
      const analysis = await buildAiAnalysis(
        state.user,
        activeScenario,
        activeSummary,
        visibleScenarios,
        state.selectedHorizon
      );

      setExportStatus("Capturing screenshot...");
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        windowWidth: exportRef.current.scrollWidth,
        windowHeight: exportRef.current.scrollHeight,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const contentWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * contentWidth) / canvas.width;

      let remainingHeight = imgHeight;
      let positionY = margin;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("FinTrack What-If Analysis", margin, 12);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(`Scenario: ${activeScenario.name}`, margin, 18);
      pdf.addImage(imgData, "PNG", margin, positionY, contentWidth, imgHeight);

      remainingHeight -= (pageHeight - margin * 2);

      while (remainingHeight > 0) {
        pdf.addPage();
        positionY = margin - (imgHeight - remainingHeight);
        pdf.addImage(imgData, "PNG", margin, positionY, contentWidth, imgHeight);
        remainingHeight -= (pageHeight - margin * 2);
      }

      pdf.addPage();
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("Detailed AI Analysis", margin, 14);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);

      const lines = pdf.splitTextToSize(analysis, pageWidth - margin * 2);
      let cursorY = 24;
      for (const line of lines) {
        if (cursorY > pageHeight - margin) {
          pdf.addPage();
          cursorY = 14;
        }
        pdf.text(line, margin, cursorY);
        cursorY += 5;
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      pdf.save(`fintrack-what-if-${dateStamp}.pdf`);
      setExportStatus("PDF downloaded.");
      window.setTimeout(() => setExportStatus(""), 2000);
    } catch (error) {
      console.error("PDF export failed:", error);
      setExportStatus("PDF export failed. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  };

  if (state.loading || !activeScenario) {
    return (
      <>
        <Nav />
        <div style={{ padding: 48, textAlign: "center", color: "var(--muted)", fontFamily: "Space Mono, monospace" }}>
          Loading modeling workspace...
        </div>
      </>
    );
  }

  const activeVariables = activeScenario.variables;
  const activeSummary = activeScenario.summaryByHorizon[state.selectedHorizon];

  return (
    <>
      <Nav />
      <main ref={exportRef} style={{ maxWidth: 1320, margin: "0 auto", padding: "28px 24px" }} className="fade-in">
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16, flexWrap: "wrap" }}>
            <div>
              <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                What-If Analysis
              </p>
              <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>
                Advanced Multi-Scenario Modeling
              </h1>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={handleDownloadPdf}
                disabled={exportingPdf || state.loading || !activeScenario}
                style={{ minWidth: 180 }}
              >
                {exportingPdf ? "Preparing PDF…" : "Download PDF"}
              </button>
              {exportStatus && (
                <span style={{ fontSize: 12, color: exportStatus.includes("failed") ? "var(--danger)" : "var(--muted)", fontFamily: "var(--font-space-mono), monospace" }}>
                  {exportStatus}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="modeling-layout">
          <aside className="card" style={{ padding: 22, alignSelf: "start" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <p className="label" style={{ marginBottom: 0 }}>Scenario Branches</p>
              <button
                className="btn btn-outline"
                style={{ padding: "7px 10px", fontSize: 12 }}
                onClick={() => dispatch({ type: "clone", scenarioId: activeScenario.id })}
              >
                Clone
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
              {state.scenarios.map((scenario) => (
                <div key={scenario.id} style={{ display: "flex", gap: 8 }}>
                  <button
                    className={scenario.id === activeScenario.id ? "btn btn-primary" : "btn btn-outline"}
                    style={{ flex: 1, justifyContent: "flex-start", padding: "9px 12px", fontSize: 12 }}
                    onClick={() => dispatch({ type: "set_active", scenarioId: scenario.id })}
                  >
                    <span style={{ width: 10, height: 10, background: scenario.color, border: "1px solid currentColor", display: "inline-block" }} />
                    {scenario.name}
                  </button>
                  {state.scenarios.length > 1 && (
                    <button
                      className="btn btn-outline"
                      style={{ padding: "9px 10px", fontSize: 12, color: "var(--danger)", borderColor: "var(--danger)" }}
                      onClick={() => dispatch({ type: "remove", scenarioId: scenario.id })}
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
              <div>
                <label className="label">Horizon</label>
                <select
                  className="input"
                  value={state.selectedHorizon}
                  onChange={(event) =>
                    dispatch({
                      type: "set_horizon",
                      horizon: Number(event.target.value) as 10 | 20 | 30,
                    })
                  }
                >
                  {HORIZONS.map((year) => (
                    <option key={year} value={year}>{year} years</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Compounding</label>
                <select
                  className="input"
                  value={activeVariables.compoundingInterval}
                  onChange={(event) =>
                    updateActive({
                      compoundingInterval: event.target.value as CompoundingInterval,
                    })
                  }
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <SliderRow
                label="Initial Net Worth"
                value={activeVariables.initialNetWorth}
                min={0}
                max={2000000}
                step={5000}
                display={money(activeVariables.initialNetWorth)}
                onChange={(value) => updateActive({ initialNetWorth: value })}
              />
              <SliderRow
                label="Savings Rate"
                value={Math.round(activeVariables.savingsRate * 100)}
                min={0}
                max={70}
                step={1}
                display={`${Math.round(activeVariables.savingsRate * 100)}% / ${money(activeVariables.monthlyContribution)} mo.`}
                onChange={(value) => {
                  const nextRate = value / 100;
                  updateActive({
                    savingsRate: nextRate,
                    monthlyContribution: activeVariables.monthlyIncome * nextRate,
                  });
                }}
              />
              <SliderRow
                label="Annual Return"
                value={activeVariables.annualInvestmentReturn * 100}
                min={-5}
                max={18}
                step={0.25}
                display={pct(activeVariables.annualInvestmentReturn)}
                onChange={(value) => updateActive({ annualInvestmentReturn: value / 100 })}
              />
              <SliderRow
                label="Inflation"
                value={activeVariables.inflationRate * 100}
                min={0}
                max={10}
                step={0.25}
                display={pct(activeVariables.inflationRate)}
                onChange={(value) => updateActive({ inflationRate: value / 100 })}
              />
              <SliderRow
                label="Tax Bracket"
                value={activeVariables.taxRate * 100}
                min={0}
                max={45}
                step={1}
                display={pct(activeVariables.taxRate)}
                onChange={(value) => updateActive({ taxRate: value / 100 })}
              />
              <SliderRow
                label="Tax-Advantaged Split"
                value={activeVariables.taxAdvantagedShare * 100}
                min={0}
                max={100}
                step={5}
                display={Math.round(activeVariables.taxAdvantagedShare * 100) + "%"}
                onChange={(value) => updateActive({ taxAdvantagedShare: value / 100 })}
              />
              <SliderRow
                label="Down Payment Goal"
                value={activeVariables.downPaymentGoal}
                min={0}
                max={500000}
                step={5000}
                display={money(activeVariables.downPaymentGoal)}
                onChange={(value) => updateActive({ downPaymentGoal: value })}
              />
            </div>
          </aside>

          <section style={{ minWidth: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 18 }}>
              <div className="card" style={{ padding: 18 }}>
                <p className="label">Projected Net Worth</p>
                <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 24, fontWeight: 700, marginTop: 6 }}>
                  {money(activeSummary.netWorth)}
                </p>
              </div>
              <div className="card" style={{ padding: 18 }}>
                <p className="label">Real Return</p>
                <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 24, fontWeight: 700, marginTop: 6, color: "var(--success)" }}>
                  {pct(activeScenario.realAnnualReturn)}
                </p>
              </div>
              <div className="card" style={{ padding: 18 }}>
                <p className="label">Taxable Real Return</p>
                <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 24, fontWeight: 700, marginTop: 6, color: "var(--accent)" }}>
                  {pct(activeScenario.taxableRealAnnualReturn)}
                </p>
              </div>
              <div className="card" style={{ padding: 18 }}>
                <p className="label">Total Contributions</p>
                <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 24, fontWeight: 700, marginTop: 6 }}>
                  {money(activeSummary.totalContributions)}
                </p>
              </div>
            </div>

            <div className="card" style={{ padding: 22, marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 14 }}>
                <p className="label" style={{ marginBottom: 0 }}>Comparison Dashboard</p>
                <span style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 12, color: "var(--muted)" }}>
                  {state.selectedHorizon} years
                </span>
              </div>

              <div style={{ width: "100%", height: 430 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 18, right: 26, bottom: 10, left: 12 }}>
                    <CartesianGrid stroke="#e5e5e5" strokeDasharray="4 4" />
                    <XAxis
                      dataKey="year"
                      type="number"
                      domain={[0, state.selectedHorizon]}
                      tickFormatter={(value) => `${Number(value).toFixed(0)}y`}
                      fontSize={12}
                    />
                    <YAxis
                      tickFormatter={(value) =>
                        "$" + Math.round(Number(value) / 1000).toLocaleString("en-US") + "k"
                      }
                      width={78}
                      fontSize={12}
                    />
                    <Tooltip
                      labelFormatter={(value) => `${Number(value).toFixed(1)} years`}
                      formatter={(value, name) => [money(Number(value ?? 0)), String(name)]}
                      contentStyle={{
                        border: "2px solid var(--border)",
                        boxShadow: "4px 4px 0 var(--border)",
                        fontFamily: "var(--font-space-grotesk), sans-serif",
                      }}
                    />
                    <Legend />
                    {visibleScenarios.map((scenario) => (
                      <Line
                        key={scenario.id}
                        type="monotone"
                        dataKey={scenario.id}
                        name={scenario.name}
                        stroke={scenario.color}
                        strokeWidth={3}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                    {visibleScenarios.flatMap((scenario) =>
                      scenario.milestones.map((milestone) => (
                        <ReferenceDot
                          key={`${scenario.id}-${milestone.id}`}
                          x={milestone.point?.year}
                          y={milestone.point?.netWorth}
                          r={5}
                          fill={scenario.color}
                          stroke="#fff"
                          strokeWidth={2}
                          label={{
                            value: milestone.id === "net-worth-goal" ? "$1M" : "Down payment",
                            position: "top",
                            fontSize: 11,
                            fill: scenario.color,
                          }}
                        />
                      ))
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {state.scenarios.map((scenario) => {
                const horizonPoint = scenario.summaryByHorizon[state.selectedHorizon];
                return (
                  <div key={scenario.id} className="card" style={{ padding: 18, borderColor: scenario.color }}>
                    <p className="label" style={{ color: scenario.color }}>{scenario.name}</p>
                    <p style={{ fontFamily: "var(--font-space-mono), monospace", fontSize: 22, fontWeight: 700, marginTop: 6 }}>
                      {money(horizonPoint.netWorth)}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 12, fontSize: 13 }}>
                      <span>Taxable: {money(horizonPoint.taxableBalance)}</span>
                      <span>Tax-advantaged: {money(horizonPoint.taxAdvantagedBalance)}</span>
                      {scenario.milestones.map((milestone) => (
                        <span key={milestone.id} style={{ color: milestone.point ? "var(--success)" : "var(--muted)" }}>
                          {milestone.label}: {milestone.point ? `${milestone.point.year.toFixed(1)}y` : "not reached"}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
