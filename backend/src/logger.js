/**
 * Shared logger (Winston).
 *
 * Writes timestamped, colorized output to the console.
 * Log level is controlled via the LOG_LEVEL env var (default: "info").
 *
 * Usage:
 *   import logger from "./logger.js";
 *   logger.info("message");
 *   logger.warn("message");
 *   logger.error("message");
 */
import winston from "winston";

const { combine, timestamp, colorize, printf } = winston.format;

const consoleFormat = printf(({ level, message, timestamp: ts }) => {
  return `${ts} [${level}] ${message}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(timestamp({ format: "HH:mm:ss" }), colorize(), consoleFormat),
  transports: [new winston.transports.Console()],
});

export default logger;
