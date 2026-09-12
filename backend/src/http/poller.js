/**
 * poller.js
 *
 * Generic API-based inbox poll loop for REST-API email providers.
 *
 * Accepts a reader object with two methods:
 *   fetchMessages() → [{ id, preview }]
 *   readMessage(id) → full email content string
 *
 * Exports:
 *   pollApi(reader, opts, onRow) — poll loop; calls onRow per new unseen email
 */

import logger from "../logger.js";

// Default delays sized for Mail.tm's 100 req/min rate limit.
// Providers without rate limits (e.g. Emailnator) can pass lower values via opts.
const DEFAULT_POLL_DELAY = 800;
const DEFAULT_READ_DELAY = 1_500;

// Resolves after ms milliseconds.
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls the inbox repeatedly until onRow returns a non-null value or timeout expires.
// Skips messages already in seenIds and those whose preview doesn't match filterText.
// Pass signal (AbortSignal) to exit immediately when the task is cancelled.
export async function pollApi(
  { fetchMessages, readMessage },
  {
    filterText = "",
    seenIds = new Set(),
    timeout = 120_000,
    pollDelay = DEFAULT_POLL_DELAY,
    readDelay = DEFAULT_READ_DELAY,
    signal = null,
  },
  onRow,
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (signal?.aborted) return null;

    let messages = [];
    let hadError = false;
    try {
      messages = await fetchMessages();
    } catch (err) {
      hadError = true;
      logger.warn(`[poller] fetchMessages failed: ${err.message}`);
    }

    logger.info(`[poller] Inbox: ${messages.length} message(s).`);

    for (const { id, preview } of messages) {
      if (signal?.aborted) return null;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      if (
        filterText &&
        !preview.toLowerCase().includes(filterText.toLowerCase())
      )
        continue;

      // Brief pause before reading to stay within provider rate limits.
      // Skip entirely when the provider sets readDelay to 0.
      if (readDelay > 0) {
        await delay(readDelay);
        if (signal?.aborted) return null;
      }

      let content = "";
      try {
        content = await readMessage(id);
      } catch (err) {
        logger.warn(`[poller] readMessage ${id} failed: ${err.message}`);
        continue;
      }

      const result = await onRow(content, preview);
      if (result != null) return result;
    }

    // On errors (such as 429 Too Many Requests), back off to let rate limits cool down
    const nextDelay = hadError ? Math.max(pollDelay, 3_000) : pollDelay;
    await delay(nextDelay);
    if (signal?.aborted) return null;
  }

  return null;
}
