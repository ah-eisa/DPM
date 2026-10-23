const TOKEN_KEY = "dpm-market-api-token-session";

function sessionToken() {
  if (typeof window === "undefined") return "";
  try { return sessionStorage.getItem(TOKEN_KEY)?.trim() ?? ""; } catch { return ""; }
}

function saveSessionToken(token: string) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* Requests can still continue without persisted session state. */ }
}

async function requestWithToken(input: RequestInfo | URL, init: RequestInit, token: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function marketFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  let token = sessionToken();
  let response = await requestWithToken(input, init, token);
  if (response.status !== 401 || typeof window === "undefined") return response;

  saveSessionToken("");
  const entered = window.prompt("Enter the DPM market-data access token. It is stored only for this browser session.")?.trim() ?? "";
  if (!entered) return response;

  saveSessionToken(entered);
  token = entered;
  response = await requestWithToken(input, init, token);
  if (response.status === 401) saveSessionToken("");
  return response;
}

export function clearMarketApiToken() { saveSessionToken(""); }
