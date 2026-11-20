import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Backdrop } from "./v4/Backdrop";
import { GlobalSettings } from "./v4/GlobalSettings";
import { Library } from "./v4/Library";
import { Login } from "./v4/Login";
import { Lore } from "./v4/Lore";
import { Memory } from "./v4/Memory";
import { Outline } from "./v4/Outline";
import { Play } from "./v4/Play";
import { Prefs } from "./v4/Prefs";
import { Shell } from "./v4/Shell";
import { StoryTool } from "./v4/StoryTool";
import { AuditTool } from "./v4/panels/Audit";
import { BranchesTool } from "./v4/panels/Branches";
import { ChatTool } from "./v4/panels/Chat";
import { DirectorTool } from "./v4/panels/Director";
import { ImagesTool } from "./v4/panels/Images";
import { ImportTool } from "./v4/panels/Import";
import { LedgerTool } from "./v4/panels/Ledger";
import { SerialTool } from "./v4/panels/Serial";
import { SettingsTool } from "./v4/panels/Settings";

export function App() {
	return (
		<>
			<Backdrop />
			<AppRoutes />
		</>
	);
}

function AppRoutes() {
	return (
		<Routes>
			<Route path="/login" element={<Login />} />
			<Route element={<Shell />}>
				<Route path="/" element={<Library />} />
				<Route path="/settings" element={<GlobalSettings />} />
				<Route path="/stories/:storyId/play" element={<Play />} />
				<Route path="/stories/:storyId/memory" element={<Memory />} />
				<Route path="/stories/:storyId/outline" element={<Outline />} />
				<Route path="/stories/:storyId/lore" element={<Lore />} />
				<Route path="/stories/:storyId/prefs" element={<Prefs />} />
				<Route path="/stories/:storyId" element={<StoryTool />}>
					<Route index element={<Navigate to="play" replace />} />
					<Route path="chat" element={<ChatTool />} />
					<Route path="import" element={<ImportTool />} />
					<Route path="audit" element={<AuditTool />} />
					<Route path="branches" element={<BranchesTool />} />
					<Route path="ledger" element={<LedgerTool />} />
					<Route path="serial" element={<SerialTool />} />
					<Route path="director" element={<DirectorTool />} />
					<Route path="images" element={<ImagesTool />} />
					<Route path="settings" element={<SettingsTool />} />
					<Route
						path="channels"
						element={<Navigate to="/settings" replace />}
					/>
				</Route>
				<Route path="*" element={<NotFoundPage />} />
			</Route>
		</Routes>
	);
}

function NotFoundPage() {
	return (
		<section className="panel lost">
			<h1>这里没有路</h1>
			<p>
				灯塔照不到这一页。回到 <Link to="/">书架</Link>。
			</p>
		</section>
	);
}
