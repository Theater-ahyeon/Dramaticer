import { Link, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { StoryPage } from "./pages/StoryPage";
import { BranchesPage } from "./pages/story/BranchesPage";
import { ChannelsPage } from "./pages/story/ChannelsPage";
import { ChatPage } from "./pages/story/ChatPage";
import { DirectorPage } from "./pages/story/DirectorPage";
import { ImagesPage } from "./pages/story/ImagesPage";
import { ImportAuditPage } from "./pages/story/ImportAuditPage";
import { ImportPage } from "./pages/story/ImportPage";
import { LedgerPage } from "./pages/story/LedgerPage";
import { SerialPage } from "./pages/story/SerialPage";
import { SettingsPage } from "./pages/story/SettingsPage";
import { Backdrop } from "./v4/Backdrop";
import { Library } from "./v4/Library";
import { Lore } from "./v4/Lore";
import { Memory } from "./v4/Memory";
import { Outline } from "./v4/Outline";
import { Play } from "./v4/Play";
import { Prefs } from "./v4/Prefs";
import { Shell } from "./v4/Shell";

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
			<Route path="/login" element={<LoginPage />} />
			<Route element={<Shell />}>
				<Route path="/" element={<Library />} />
				<Route path="/stories/:storyId/play" element={<Play />} />
				<Route path="/stories/:storyId/memory" element={<Memory />} />
				<Route path="/stories/:storyId/outline" element={<Outline />} />
				<Route path="/stories/:storyId/lore" element={<Lore />} />
				<Route path="/stories/:storyId/prefs" element={<Prefs />} />
				{/* 导入、分支、渠道等工具页：结构沿用旧的，外壳与样式用新的。 */}
				<Route path="/stories/:storyId" element={<StoryPage />}>
					<Route index element={<Navigate to="play" replace />} />
					<Route path="chat" element={<ChatPage />} />
					<Route path="import" element={<ImportPage />} />
					<Route path="audit" element={<ImportAuditPage />} />
					<Route path="branches" element={<BranchesPage />} />
					<Route path="ledger" element={<LedgerPage />} />
					<Route path="serial" element={<SerialPage />} />
					<Route path="director" element={<DirectorPage />} />
					<Route path="images" element={<ImagesPage />} />
					<Route path="settings" element={<SettingsPage />} />
					<Route path="channels" element={<ChannelsPage />} />
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
