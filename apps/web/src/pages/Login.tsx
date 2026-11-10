import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Icon } from "../components";
import { isNetworkError, post } from "../lib/api";
import { useSession } from "../lib/store";

export function Login() {
  const { mode, signIn, startDemo } = useSession();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const verified = useRef(false);

  useEffect(() => {
    if (!token || verified.current) return;
    verified.current = true;
    setLoading(true);
    post<{ jwt: string }>("/auth/verify", { token })
      .then(({ jwt }) => {
        signIn(jwt);
        navigate("/", { replace: true });
      })
      .catch((caught: Error) => {
        setError(
          isNetworkError(caught)
            ? "Sorted couldn't reach its server. Check your connection and tap the link again."
            : "That login link has expired or was already used. Enter your email for a fresh one.",
        );
        setLoading(false);
        navigate("/login", { replace: true });
      });
  }, [navigate, signIn, token]);

  if (mode && !token) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await post<{ ok: true; dev_link?: string }>("/auth/magic-link", { email });
      setSent({ devLink: res.dev_link });
    } catch (caught) {
      setError(
        isNetworkError(caught)
          ? "Sorted couldn't reach its server. Check your connection and try again."
          : caught instanceof Error
            ? caught.message
            : "Couldn't send the login link.",
      );
    } finally {
      setLoading(false);
    }
  }

  function demo() {
    startDemo();
    navigate("/");
  }

  if (token && loading) {
    return (
      <main className="login-page">
        <div className="login-mark">S</div>
        <h1>Logging you in…</h1>
      </main>
    );
  }

  return (
    <main className="login-page">
      <div className="login-mark">S</div>
      <p className="brand-wordmark">Sorted<span>.</span></p>
      {!sent ? (
        <>
          <h1>Admin, without the accounting.</h1>
          <p>You do the work. We’ll track the money.</p>
          <form onSubmit={submit}>
            <label className="field">
              <span className="field-label">Email address</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@business.ie"
                autoComplete="email"
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send me a login link"} <Icon name="arrow" />
            </Button>
          </form>
          <small>No password. We email you a link.</small>
          <button className="demo-link" onClick={demo}>Explore the demo instead</button>
        </>
      ) : (
        <div className="login-sent">
          <span className="success-mark"><Icon name="message" size={28} /></span>
          <h1>Check your email</h1>
          <p>
            We sent a login link to <strong>{email}</strong>. It works for 15 minutes.
          </p>
          {sent.devLink && (
            <div className="dev-note">
              <p>Local development: no email is sent.</p>
              <a className="button button-primary" href={sent.devLink}>Open login link</a>
            </div>
          )}
          <Button onClick={() => setSent(null)} kind="quiet">Use a different email</Button>
        </div>
      )}
    </main>
  );
}
