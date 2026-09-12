/**
 * engine/runner.js
 *
 * Task runner — orchestrates the full lifecycle for a single automation task.
 * Creates a credential store, obtains an email address, then runs each
 * selected service in sequence.
 */

import { getProvider, getService } from "./registry.js";
import logger from "../logger.js";
import { tasks } from "./taskStore.js";
import { emit, log, buildRecord, logPlaylists } from "./events.js";

// Runs the full task: validate inputs, create email, iterate services.
export async function runTask(taskId, providerId, serviceIds) {
  const task = tasks.get(taskId);
  if (!task) return;

  const {
    emitter,
    abortController: { signal },
  } = task;
  task.status = "running";

  // ── Validate inputs ───────────────────────────────────────────────────────

  const provider = getProvider(providerId);
  if (!provider) {
    log(emitter, `Unknown email provider: "${providerId}"`, "error");
    task.status = "error";
    emitter.emit("done");
    return;
  }

  // Resolve service IDs, warn and skip any that don't exist in the registry.
  const services = serviceIds.flatMap((id) => {
    const s = getService(id);
    if (!s) logger.warn(`[Engine] Unknown service id: "${id}" — skipped`);
    return s ? [s] : [];
  });

  if (!services.length) {
    log(emitter, "No valid registration services selected.", "error");
    task.status = "error";
    emitter.emit("done");
    return;
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  try {
    if (signal.aborted) throw new DOMException("", "AbortError");

    // Plain object used as a credential store — providers write credentials
    // here in createEmail() and read them back in polling methods.
    const credentialStore = {};

    // Wrap the provider so every inbox-polling call automatically receives the
    // task's abort signal — services pass options as a plain object, so we
    // intercept those three methods and merge { signal } in before forwarding.
    const POLL_METHODS = [
      "waitForVerificationCodeEmail",
      "waitForEmailAndExtractLink",
      "waitForEmailAndExtractPlaylists",
    ];
    const cancelableProvider = new Proxy(provider, {
      get(target, prop) {
        if (POLL_METHODS.includes(prop)) {
          return (store, opts = {}) => target[prop](store, { ...opts, signal });
        }
        return typeof target[prop] === "function"
          ? target[prop].bind(target)
          : target[prop];
      },
    });

    const email = await provider.createEmail(credentialStore);
    emit(emitter, "email_created", { email, provider: provider.meta.name });
    log(emitter, `Temporary email ready: ${email}`);

    // Shared across all services so emails seen by one are never re-processed
    // by the next service in the same task.
    const inboxSeenIds = new Set();

    for (const service of services) {
      if (signal.aborted) break;

      log(emitter, `Starting registration on ${service.meta.name}...`);
      emit(emitter, "service_start", {
        serviceId: service.meta.id,
        name: service.meta.name,
      });

      try {
        const result = await service.execute({
          provider: cancelableProvider,
          credentialStore,
          email,
          inboxSeenIds,
          taskId,
          emitter,
          log: (msg, level = "info") => log(emitter, msg, level),
        });

        const record = buildRecord(service, email, result);
        task.results.push(record);
        emit(emitter, "result", record);
        logPlaylists(emitter, record);
      } catch (err) {
        // Distinguish captcha failures from generic errors for the UI.
        const status = err.type === "CAPTCHA" ? "captcha" : "failed";
        const record = buildRecord(service, email, {
          status,
          note: err.message,
        });
        task.results.push(record);
        emit(emitter, "result", record);
        log(
          emitter,
          `${status === "captcha" ? "🛡️" : "❌"} ${service.meta.name}: ${err.message}`,
          "warn",
        );
      }
    }

    log(
      emitter,
      signal.aborted
        ? "Task was cancelled by user."
        : `Automation complete. ${task.results.length} service(s) processed.`,
    );
    task.status = signal.aborted ? "cancelled" : "done";
  } catch (err) {
    if (err.name === "AbortError") {
      task.status = "cancelled";
      log(emitter, "Task was cancelled by user.");
    } else {
      task.status = "error";
      log(emitter, `Fatal error: ${err.message}`, "error");
      emit(emitter, "error", { message: err.message });
    }
  } finally {
    emit(emitter, "done", { status: task.status, results: task.results });
    emitter.emit("done");
  }
}
