import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// 旧样式表先进，新界面的样式（由 App 引入）后进，同名规则以新的为准。
import "./styles.css";
import { App } from "./App";

const container = document.getElementById("root");
if (container === null) throw new Error("页面缺少 #root 挂载点");

createRoot(container).render(
	<StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</StrictMode>,
);
