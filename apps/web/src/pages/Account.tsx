import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Icon } from "../components";
import { useSession, useStore } from "../lib/store";
import { useValidation } from "../lib/useValidation";
import { authError } from "./Login";
import { GoogleSignIn } from "../GoogleSignIn";

function AccountPage({ children }: { children: ReactNode }) {
  return <main className="login-page">
    <div className="login-mark">S</div>
    <p className="brand-wordmark">Sorted<span>.</span></p>
    {children}
  </main>;
}

function CheckEmail({ email, devLink }: { email: string; devLink?: string }) {
  return <div className="login-sent">
    <span className="success-mark"><Icon name="message" size={28} /></span>
    <h1>Check your email</h1>
    <p>If there’s an account to verify or reset, you’ll find the next step at <strong>{email}</strong>. Links work for 15 minutes.</p>
    {devLink && <div className="dev-note">
      <p>Local development: no email is sent.</p>
      <a className="button button-primary" href={devLink}>Open link</a>
    </div>}
    <Link className="demo-link" to="/login">Back to log in</Link>
  </div>;
}

function PasswordForm({ reset = false }: { reset?: boolean }) {
  const { authBackend: backend } = useStore();
  const { signIn } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState<{ dev_link?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = params.get("token");
  const validation = useValidation({
    password: () => password.length < 8 ? "Use at least 8 characters." : undefined,
    confirm: () => password !== confirm ? "Passwords don't match." : undefined,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget)) return;
    setBusy(true);
    setError("");
    try {
      if (reset) {
        if (!token) throw new Error("That reset link is missing. Ask for a new one.");
        const { jwt, user } = await backend.resetPassword(token, password);
        signIn(jwt);
        navigate(!user.name || !user.businessName ? "/welcome" : "/", { replace: true });
      } else {
        setSent(await backend.signup(email, password));
      }
    } catch (caught) {
      setError(authError(caught));
    } finally {
      setBusy(false);
    }
  }

  return <AccountPage>
    {sent ? <CheckEmail email={email} devLink={sent.dev_link} /> : <>
      <h1>{reset ? "Choose a new password" : "Create your account"}</h1>
      <p>{reset ? "Make it one you haven’t used before." : "A little less admin starts here."}</p>
      {!reset && <GoogleSignIn />}
      <form onSubmit={submit} noValidate>
        {!reset && <Field label="Email address" {...validation.field("email")}>
          <input name="email" type="email" required autoComplete="email" placeholder="you@business.ie"
            value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>}
        <Field label={reset ? "New password" : "Password"} helper="At least 8 characters." {...validation.field("password")}>
          <input name="password" type="password" required minLength={8} maxLength={1024} autoComplete="new-password"
            value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label="Confirm password" {...validation.field("confirm")}>
          <input name="confirm" type="password" required autoComplete="new-password"
            value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : reset ? "Save new password" : "Create account"} <Icon name="arrow" /></Button>
      </form>
      <Link className="demo-link" to={reset ? "/forgot" : "/login"}>{reset ? "Ask for a new link" : "Already have an account? Log in"}</Link>
    </>}
  </AccountPage>;
}

export function Signup() { return <PasswordForm />; }
export function Reset() { return <PasswordForm reset />; }

export function Forgot() {
  const { authBackend: backend } = useStore();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ dev_link?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const validation = useValidation({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget)) return;
    setBusy(true);
    setError("");
    try { setSent(await backend.forgot(email)); }
    catch (caught) { setError(authError(caught)); }
    finally { setBusy(false); }
  }

  return <AccountPage>
    {sent ? <CheckEmail email={email} devLink={sent.dev_link} /> : <>
      <h1>Forgot your password?</h1>
      <p>We’ll email you a link to choose a new one.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Email address" {...validation.field("email")}>
          <input name="email" required type="email" autoComplete="email" placeholder="you@business.ie"
            value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"} <Icon name="arrow" /></Button>
      </form>
      <Link className="demo-link" to="/login">Back to log in</Link>
    </>}
  </AccountPage>;
}

export function Verify() {
  const { authBackend: backend } = useStore();
  const { signIn } = useSession();
  const [params] = useSearchParams();
  const token = params.get("token");
  const attempted = useRef<string | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || attempted.current === token) return;
    attempted.current = token;
    backend.verify(token).then(({ jwt, user }) => {
      signIn(jwt);
      navigate(!user.name || !user.businessName ? "/welcome" : "/", { replace: true });
    }).catch((caught: unknown) => setError(authError(caught)));
  }, [backend, navigate, signIn, token]);

  return <AccountPage>
    {error || !token ? <>
      <h1>That link didn’t work</h1>
      <p role="alert">{error || "The verification link is missing."}</p>
      <Link className="button button-primary" to="/signup">Ask for a new link</Link>
    </> : <h1>Verifying your email…</h1>}
  </AccountPage>;
}

export function GoogleLogin() {
  const { authBackend: backend } = useStore();
  const { mode, signIn } = useSession();
  const [params] = useSearchParams();
  const code = useRef(params.get("code"));
  const attempted = useRef(false);
  const navigate = useNavigate();
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    window.history.replaceState(null, "", "/login/google");
    if (!code.current || mode === "demo") {
      navigate("/login?error=google", { replace: true });
      return;
    }
    backend.googleExchange(code.current).then(({ jwt, user }) => {
      signIn(jwt);
      navigate(!user.name || !user.businessName ? "/welcome" : "/", { replace: true });
    }).catch(() => navigate("/login?error=google", { replace: true }));
  }, [backend, mode, navigate, signIn]);
  return <AccountPage><h1>Signing you in…</h1></AccountPage>;
}
