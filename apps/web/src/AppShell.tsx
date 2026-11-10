import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { Button, Icon } from "./components";
import { useSession, useStore } from "./lib/store";

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function Skeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-hero" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
    </div>
  );
}

export function AppShell() {
  const { mode, signOut } = useSession();
  const { data, loadError, stale, refresh } = useStore();
  const online = useOnline();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (!mode) return <Navigate to="/login" replace />;

  return (
    <div className="shell">
      {mode === "demo" && (
        <div className="banner banner-demo">
          <span>Demo — sample data, nothing is sent.</span>
          <button onClick={signOut}>Sign up / log in</button>
        </div>
      )}
      {(stale || !online) && mode === "api" && (
        <div className="banner banner-offline" role="status">
          You’re offline — showing what Sorted last loaded.
        </div>
      )}
      <main className="content">
        {data ? (
          <Outlet />
        ) : loadError ? (
          <div className="page">
            <div className="card empty-state">
              <span className="empty-icon"><Icon name="alert" /></span>
              <strong>Sorted couldn’t load your data</strong>
              <p>{loadError}</p>
              <Button kind="soft" onClick={() => void refresh()}>Try again</Button>
            </div>
          </div>
        ) : (
          <Skeleton />
        )}
      </main>
      <nav className="tabbar" aria-label="Main navigation">
        <NavLink to="/" end>
          <Icon name="calendar" />
          <span>Today</span>
        </NavLink>
        <NavLink to="/bookings/new" className="fab" aria-label="Add booking">
          <Icon name="plus" size={28} />
        </NavLink>
        <NavLink to="/money">
          <Icon name="wallet" />
          <span>Money</span>
        </NavLink>
        <NavLink to="/expenses">
          <Icon name="receipt" />
          <span>Expenses</span>
        </NavLink>
      </nav>
    </div>
  );
}
