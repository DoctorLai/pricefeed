"use strict";

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Fetch a URL and parse the response body as JSON.
 *
 * Wraps the global `fetch` with a hard timeout and descriptive errors so that
 * callers can rely on a rejected promise (rather than `NaN` or `undefined`)
 * whenever a request fails, times out, or returns a non-2xx status.
 *
 * @param {string} url - The URL to request.
 * @param {object} [options] - Request options.
 * @param {number} [options.timeout=20000] - Abort the request after this many ms.
 * @param {Function} [options.fetchImpl=globalThis.fetch] - Injectable fetch (testing).
 * @returns {Promise<*>} The parsed JSON body.
 */
async function fetchJson(url, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    ...rest
  } = options;

  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is not available; Node.js 18+ is required");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response;
  try {
    response = await fetchImpl(url, { signal: controller.signal, ...rest });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeout}ms`);
    }
    throw new Error(`Request to ${url} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response || typeof response.ok === "undefined") {
    throw new Error(`No response received from ${url}`);
  }

  if (!response.ok) {
    throw new Error(`Request to ${url} failed with HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${url}: ${err.message}`);
  }
}

module.exports = { fetchJson, DEFAULT_TIMEOUT_MS };
