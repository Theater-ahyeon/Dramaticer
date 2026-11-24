import { createContext, useContext } from "react";

/** 外壳持有的全局抽屉；任何页面都能叫出来。 */
export interface ShellActions {
	readonly openAssistant: () => void;
	readonly openInspector: () => void;
}

export const ShellActionsContext = createContext<ShellActions>({
	openAssistant: () => {},
	openInspector: () => {},
});

export function useShellActions(): ShellActions {
	return useContext(ShellActionsContext);
}
