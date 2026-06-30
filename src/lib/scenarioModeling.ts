export type CompoundingInterval = "monthly" | "annual";

export interface FinancialVariables {
  initialNetWorth: number;
  monthlyIncome: number;
  savingsRate: number;
  monthlyContribution: number;
  annualInvestmentReturn: number;
  inflationRate: number;
  taxRate: number;
  taxAdvantagedShare: number;
  compoundingInterval: CompoundingInterval;
  downPaymentGoal: number;
  netWorthGoal: number;
}

export interface ProjectionPoint {
  period: number;
  year: number;
  taxableBalance: number;
  taxAdvantagedBalance: number;
  netWorth: number;
  totalContributions: number;
}

export interface ProjectionMilestone {
  id: "net-worth-goal" | "down-payment";
  label: string;
  targetAmount: number;
  point: ProjectionPoint | null;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  milestones: ProjectionMilestone[];
  summaryByHorizon: Record<10 | 20 | 30, ProjectionPoint>;
  realAnnualReturn: number;
  taxableRealAnnualReturn: number;
}

export interface Scenario {
  id: string;
  name: string;
  color: string;
  variables: FinancialVariables;
  projection: ProjectionPoint[];
  milestones: ProjectionMilestone[];
  summaryByHorizon: Record<10 | 20 | 30, ProjectionPoint>;
  realAnnualReturn: number;
  taxableRealAnnualReturn: number;
  createdFromId?: string;
  updatedAt: string;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeVariables(variables: FinancialVariables): FinancialVariables {
  const monthlyIncome = Math.max(0, variables.monthlyIncome || 0);
  const savingsRate = clamp(variables.savingsRate || 0, 0, 1);
  const monthlyContribution = Math.max(
    0,
    variables.monthlyContribution || monthlyIncome * savingsRate
  );

  return {
    ...variables,
    initialNetWorth: Math.max(0, variables.initialNetWorth || 0),
    monthlyIncome,
    savingsRate,
    monthlyContribution,
    annualInvestmentReturn: clamp(variables.annualInvestmentReturn || 0, -0.95, 1),
    inflationRate: clamp(variables.inflationRate || 0, -0.5, 1),
    taxRate: clamp(variables.taxRate || 0, 0, 1),
    taxAdvantagedShare: clamp(variables.taxAdvantagedShare || 0, 0, 1),
    compoundingInterval:
      variables.compoundingInterval === "annual" ? "annual" : "monthly",
    downPaymentGoal: Math.max(0, variables.downPaymentGoal || 0),
    netWorthGoal: Math.max(0, variables.netWorthGoal || 0),
  };
}

function findMilestone(
  id: ProjectionMilestone["id"],
  label: string,
  targetAmount: number,
  points: ProjectionPoint[]
): ProjectionMilestone {
  return {
    id,
    label,
    targetAmount,
    point: targetAmount > 0
      ? points.find((point) => point.netWorth >= targetAmount) ?? null
      : null,
  };
}

function getPointAtYear(points: ProjectionPoint[], year: 10 | 20 | 30): ProjectionPoint {
  return (
    points.find((point) => Math.abs(point.year - year) < 0.0001) ??
    points.reduce((closest, point) =>
      Math.abs(point.year - year) < Math.abs(closest.year - year) ? point : closest
    )
  );
}

export function calculateFinancialProjection(
  inputVariables: FinancialVariables,
  horizonYears = 30
): ProjectionResult {
  const variables = normalizeVariables(inputVariables);
  const years = Math.max(1, Math.ceil(horizonYears));
  const realAnnualReturn =
    (1 + variables.annualInvestmentReturn) / (1 + variables.inflationRate) - 1;
  const taxableRealAnnualReturn = realAnnualReturn * (1 - variables.taxRate);

  const taxAdvantagedShare = variables.taxAdvantagedShare;
  let taxAdvantagedBalance = variables.initialNetWorth * taxAdvantagedShare;
  let taxableBalance = variables.initialNetWorth * (1 - taxAdvantagedShare);
  let totalContributions = 0;

  const points: ProjectionPoint[] = [
    {
      period: 0,
      year: 0,
      taxableBalance,
      taxAdvantagedBalance,
      netWorth: taxableBalance + taxAdvantagedBalance,
      totalContributions,
    },
  ];

  if (variables.compoundingInterval === "annual") {
    for (let year = 1; year <= years; year += 1) {
      const annualContribution = variables.monthlyContribution * 12;
      taxableBalance += annualContribution * (1 - taxAdvantagedShare);
      taxAdvantagedBalance += annualContribution * taxAdvantagedShare;
      totalContributions += annualContribution;

      taxableBalance *= 1 + taxableRealAnnualReturn;
      taxAdvantagedBalance *= 1 + realAnnualReturn;

      points.push({
        period: year,
        year,
        taxableBalance,
        taxAdvantagedBalance,
        netWorth: taxableBalance + taxAdvantagedBalance,
        totalContributions,
      });
    }
  } else {
    const taxableMonthlyReturn = Math.pow(1 + taxableRealAnnualReturn, 1 / 12) - 1;
    const taxAdvantagedMonthlyReturn = Math.pow(1 + realAnnualReturn, 1 / 12) - 1;
    const months = years * 12;

    for (let month = 1; month <= months; month += 1) {
      taxableBalance += variables.monthlyContribution * (1 - taxAdvantagedShare);
      taxAdvantagedBalance += variables.monthlyContribution * taxAdvantagedShare;
      totalContributions += variables.monthlyContribution;

      taxableBalance *= 1 + taxableMonthlyReturn;
      taxAdvantagedBalance *= 1 + taxAdvantagedMonthlyReturn;

      points.push({
        period: month,
        year: month / 12,
        taxableBalance,
        taxAdvantagedBalance,
        netWorth: taxableBalance + taxAdvantagedBalance,
        totalContributions,
      });
    }
  }

  return {
    points,
    milestones: [
      findMilestone("net-worth-goal", "$1M net worth", variables.netWorthGoal, points),
      findMilestone("down-payment", "Down payment saved", variables.downPaymentGoal, points),
    ],
    summaryByHorizon: {
      10: getPointAtYear(points, 10),
      20: getPointAtYear(points, 20),
      30: getPointAtYear(points, 30),
    },
    realAnnualReturn,
    taxableRealAnnualReturn,
  };
}

export function recalculateScenario(
  scenario: Omit<
    Scenario,
    | "projection"
    | "milestones"
    | "summaryByHorizon"
    | "realAnnualReturn"
    | "taxableRealAnnualReturn"
  >,
  horizonYears = 30
): Scenario {
  const result = calculateFinancialProjection(scenario.variables, horizonYears);

  return {
    ...scenario,
    projection: result.points,
    milestones: result.milestones,
    summaryByHorizon: result.summaryByHorizon,
    realAnnualReturn: result.realAnnualReturn,
    taxableRealAnnualReturn: result.taxableRealAnnualReturn,
  };
}
