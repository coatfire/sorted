import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button, Field, Icon } from "../components";
import { ApiError, isNetworkError } from "../lib/api";
import { useSession, useStore } from "../lib/store";
import { useValidation } from "../lib/useValidation";

export function authError(error: unknown) {
  return error instanceof ApiError ? error.message : isNetworkError(error)
    ? "Sorted couldn't reach its server. Check your connection and try again."
    : error instanceof Error ? error.message : "Something went wrong. Try again.";
}

export function Login() {
  const { mode, signIn, startDemo } = useSession();
  const { backend } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const validation = useValidation({});
  const navigate = useNavigate();

  if (mode) return <Navigate to="/" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget)) return;
    setLoading(true);
    setError("");
    try {
      const { jwt, user } = await backend.login(email, password);
      signIn(jwt);
      navigate(!user.name || !user.businessName ? "/welcome" : "/", { replace: true });
    } catch (caught) {
      setError(authError(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-mark">S</div>
      <p className="brand-wordmark">Sorted<span>.</span></p>
      <h1>Admin, without the accounting.</h1>
      <p>You do the work. We’ll track the money.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Email address" {...validation.field("email")}>
          <input name="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)}
            placeholder="you@business.ie" autoComplete="email" />
        </Field>
        <Field label="Password" {...validation.field("password")}>
          <input name="password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password" aria-describedby={error ? "login-error" : undefined} aria-invalid={error ? true : undefined} />
        </Field>
        {error && <p id="login-error" className="form-error" role="alert">{error}</p>}
        <Button type="submit" disabled={loading}>{loading ? "Logging in…" : "Log in"} <Icon name="arrow" /></Button>
      </form>
      <Link className="demo-link" to="/signup">Create account</Link>
      <Link className="demo-link" to="/forgot">Forgot password?</Link>
      <button className="demo-link" onClick={() => { startDemo(); navigate("/"); }}>Explore the demo instead</button>
    </main>
  );
}
