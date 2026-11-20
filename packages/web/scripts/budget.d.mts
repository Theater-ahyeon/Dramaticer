export interface BudgetLimits {
	readonly jsKb: number;
	readonly cssKb: number;
}

export interface BudgetResult {
	readonly jsKb: number;
	readonly cssKb: number;
	readonly fonts: number;
	readonly failures: string[];
}

export const DEFAULT_LIMITS: BudgetLimits;

export function checkBudget(distDir: string, limits?: BudgetLimits): BudgetResult;
