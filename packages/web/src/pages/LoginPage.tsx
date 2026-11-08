import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice } from "../components/ErrorNotice";

export function LoginPage() {
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
			navigate("/");
		} catch (value) {
			setError(value);
		} finally {
			setPending(false);
		}
	}

	return (
		<section className="panel narrow">
			<h1>登录</h1>
			<p className="muted">输入服务端启动时设置的访问密码。</p>
			<form className="stack" onSubmit={submit}>
				<label htmlFor="password">访问密码</label>
				<input
					id="password"
					type="password"
					autoComplete="current-password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					required
				/>
				<button type="submit" disabled={pending}>
					{pending ? "登录中…" : "登录"}
				</button>
			</form>
			<ErrorNotice error={error} />
		</section>
	);
}
