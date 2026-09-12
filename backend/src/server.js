/**
 * Express server entry point.
 *
 * Sets up middleware, mounts routes, and starts the HTTP server.
 * Port is controlled via the PORT env var (default: 3001).
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import automationRoutes from "./routes.js";

// ── App setup ────────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/automation", automationRoutes);

// ── Error handling ───────────────────────────────────────────────────────────

// Catches errors passed via next(err) from route handlers
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Log unhandled errors so they don't silently crash the process
process.on("uncaughtException", (err) => {
  console.error("⚠ [Process] Uncaught Exception:", err.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("⚠ [Process] Unhandled Rejection:", reason?.message || reason);
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀  IPTV Automation backend  →  http://localhost:${PORT}\n`);
});
