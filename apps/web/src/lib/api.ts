/** Tiny typed fetch wrapper. All API access goes through this. */

const JWT_KEY = "sorted_jwt";
/** Set VITE_API_URL when the API lives on another origin (e.g. a Lambda URL). */
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export const session = {
  get: () => localStorage.getItem(JWT_KEY),
  set: (jwt: string) => localStorage.setItem(JWT_KEY, jwt),
  clear: () => localStorage.removeItem(JWT_KEY),
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** True when the request never reached the server (offline, API down). */
export const isNetworkError = (err: unknown) =>
  err instanceof TypeError || (err instanceof ApiError && err.status >= 502);

/** The API sends either `{error: "text"}` or a zod `flatten()` object. */
function errorMessage(body: unknown, status: number): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const { formErrors = [], fieldErrors = {} } = error as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[]>;
    };
    const first = formErrors[0] ?? Object.values(fieldErrors).flat()[0];
    if (first) return first;
  }
  if (status >= 500) return "Sorted couldn't reach its server. Try again in a moment.";
  return `Request failed (${status})`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const jwt = session.get();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && jwt) {
    // Session expired — back to login.
    session.clear();
    if (window.location.pathname !== "/login") window.location.assign("/login");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(errorMessage(body, res.status), res.status);
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const apiBlob = async (path: string) => (await request(path)).blob();

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
