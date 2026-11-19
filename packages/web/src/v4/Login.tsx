import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice } from "../components/ErrorNotice";
import { Mark } from "./Backdrop";
import { stage, travel } from "./stage";

/** 登录页：整片夜海做背景，中间一张玻璃卡。 */
export function Login() {
	const navigate = useNavigate();
	const [password, setPassword] = useState("");
	const [error, setError] = useState<unknown>(null);
	const [pending, setPending] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);
		try {
			await api.login(password);
			stage.pulse(1.2);
			travel("/", () => navigate("/"));
		} catch (value) {
			setError(value);
		} finally {
			setPending(false);
		}
	}

	return (
		<main className="login">
			<section className="login-card">
				<Mark size={56} />
				<h1>Dramaticer</h1>
				<p className="login-tag">记忆管过去，导演管未来</p>
				<form onSubmit={submit}>
					<label htmlFor="password">访问密码</label>
					<input
						id="password"
						type="password"
						autoComplete="current-password"
						placeholder="服务端启动时设置的密码"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>
					<button type="submit" className="btn gold lg" disabled={pending}>
						{pending ? "登录中…" : "登录"}
					</button>
				</form>
				<ErrorNotice error={error} />
			</section>
		</main>
	);
}
