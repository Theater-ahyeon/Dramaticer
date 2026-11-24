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
				<Route
					path="/stories/:storyId"
					element={<Navigate to="play" replace />}
				/>
				<Route path="*" element={<NotFoundPage />} />
			</Route>
		</Routes>
	);
}

function NotFoundPage() {
	return (
		<section className="panel lost">
			<h1>页面不存在</h1>
			<p>
				<Link to="/">回到书架</Link>
			</p>
		</section>
	);
}
