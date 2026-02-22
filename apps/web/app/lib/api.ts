"use client";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:3005";

export const getToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("concierge_token");
};

export const setToken = (token: string) => {
  window.localStorage.setItem("concierge_token", token);
};

export const clearToken = () => {
  window.localStorage.removeItem("concierge_token");
};

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  if (init.auth) {
    const token = getToken();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message = (json as any)?.error || response.statusText || "request_failed";
    throw new Error(message);
  }
  return json as T;
}

