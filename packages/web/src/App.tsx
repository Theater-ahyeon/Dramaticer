import { Link, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { StoriesPage } from "./pages/StoriesPage";
import { StoryPage } from "./pages/StoryPage";
import { BranchesPage } from "./pages/story/BranchesPage";
import { ChannelsPage } from "./pages/story/ChannelsPage";
import { ChatPage } from "./pages/story/ChatPage";
import { DirectorPage } from "./pages/story/DirectorPage";
import { LedgerPage } from "./pages/story/LedgerPage";
import { SettingsPage } from "./pages/story/SettingsPage";

export function App() {
	return (
		<div className="app-shell">
			<header className="app-header">
				<Link className="brand" to="/">
					Dramaticer
				</Link>
				<nav className="header-nav" aria-label="主导航">
					<Link to="/">故事</Link>
					<Link to="/login">登录</Link>
				</nav>
			</header>
			<main className="app-main">
				<Routes>
					<Route path="/login" element={<LoginPage />} />
					<Route path="/" element={<StoriesPage />} />
					<Route path="/stories/:storyId" element={<StoryPage />}>
						<Route index element={<Navigate to="chat" replace />} />
						<Route path="chat" element={<ChatPage />} />
						<Route path="branches" element={<BranchesPage />} />
						<Route path="ledger" element={<LedgerPage />} />
						<Route path="director" element={<DirectorPage />} />
						<Route path="settings" element={<SettingsPage />} />
						<Route path="channels" element={<ChannelsPage />} />
					</Route>
					<Route path="*" element={<NotFoundPage />} />
				</Routes>
			</main>
		</div>
	);
}

function NotFoundPage() {
	return (
		<section className="panel">
			<h1>页面不存在</h1>
			<p>
				回到 <Link to="/">故事列表</Link>。
			</p>
		</section>
	);
}
