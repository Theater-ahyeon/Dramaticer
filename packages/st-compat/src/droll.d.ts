declare module "droll" {
	export interface DrollResult {
		readonly rolls: readonly number[];
		readonly modifier: number;
		readonly total: number;
	}

	const droll: {
		validate(formula: string): boolean;
		roll(formula: string): DrollResult | false;
	};

	export default droll;
}
