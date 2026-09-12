/**
 * apiClient.js
 *
 * Generic JSON API fetch helper for REST-API-based email providers.
 *
 * Exports:
 *   makeApi(baseUrl, defaultOpts?) — returns a fetch helper bound to baseUrl
 */

// Fetches a JSON endpoint. Injects a Bearer token when provided,
// throws on non-2xx, and returns null on 204 No Content.
async function apiFetch(baseUrl, path, opts = {}) {
  const {
    method = "GET",
    token = null,
    body = null,
    errorDetail = null,
  } = opts;

  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // Try to extract a human-readable error message from the response body.
    let detail = "";
    try {
      const j = await res.json();
      detail = errorDetail?.(j) ?? j.message ?? JSON.stringify(j);
    } catch (_) {}
    throw new Error(
      `[apiClient] ${method} ${baseUrl}${path} → ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  return res.status === 204 ? null : res.json();
}

// Returns a fetch helper pre-bound to baseUrl.
// defaultOpts sets call-wide defaults (e.g. a custom errorDetail for Hydra responses).
export function makeApi(baseUrl, defaultOpts = {}) {
  return (path, callOpts) =>
    apiFetch(baseUrl, path, { ...defaultOpts, ...callOpts });
}
