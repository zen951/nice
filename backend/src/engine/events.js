/**
 * engine/events.js
 *
 * Shared event/log helpers and result normalisation for the task runner.
 *
 * Exports:
 *   emit(emitter, type, data)        — fires a typed SSE event
 *   log(emitter, message, level)     — SSE log + server-side logger
 *   buildRecord(service, email, src) — normalises a service result into the UI record shape
 *   logPlaylists(emitter, record)    — logs playlist + duration info after a service completes
 */

import logger from "../logger.js";

// Emits a typed event on the emitter with an ISO timestamp.
export function emit(emitter, type, data = {}) {
  emitter.emit("event", { type, data, timestamp: new Date().toISOString() });
}

// Emits a log event via SSE and also writes to the server-side logger.
export function log(emitter, message, level = "info") {
  emit(emitter, "log", { message, level });
  (logger[level] ?? logger.info).call(logger, message);
}

// Wraps a raw service result with task-level fields (serviceId, service name,
// email, timestamp) to produce the shape stored in task.results and sent to the UI.
export function buildRecord(service, email, src) {
  return {
    serviceId: service.meta.id,
    service: service.meta.name,
    email,
    username: src.username ?? null,
    password: src.password ?? null,
    tvPlaylist: src.tvPlaylist ?? null,
    vodPlaylist: src.vodPlaylist ?? null,
    duration: src.duration ?? null,
    expiresAt: src.expiresAt ?? null,
    allM3uLinks: src.allM3uLinks ?? (src.tvPlaylist ? [src.tvPlaylist] : []),
    status: src.status ?? "success",
    note: src.note ?? null,
    timestamp: new Date().toISOString(),
  };
}

// Logs the playlist URLs and trial duration from a completed service record.
export function logPlaylists(emitter, record) {
  if (record.duration)
    log(
      emitter,
      `⏳ Duration: ${record.duration}${record.expiresAt ? ` · Expires: ${record.expiresAt}` : ""}`,
    );
  if (record.tvPlaylist) log(emitter, `📺 TV Playlist: ${record.tvPlaylist}`);
  if (record.vodPlaylist)
    log(emitter, `🍿 VOD Playlist: ${record.vodPlaylist}`);
  else log(emitter, "ℹ️ VOD Playlist: none");
}
