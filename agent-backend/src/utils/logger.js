/**
 * Simple logger utility with colored output and timestamps
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// ANSI color codes
const COLORS = {
  RESET: "\x1b[0m",
  BRIGHT: "\x1b[1m",
  DIM: "\x1b[2m",
  
  // Foreground colors
  BLACK: "\x1b[30m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",
  GRAY: "\x1b[90m",
};

class Logger {
  constructor(minLevel = "INFO") {
    this.minLevel = LOG_LEVELS[minLevel] || LOG_LEVELS.INFO;
  }

  _getTimestamp() {
    const now = new Date();
    const date = now.toLocaleDateString("en-IN");
    const time = now.toLocaleTimeString("en-IN", { hour12: false });
    return `${date} ${time}`;
  }

  _formatMessage(level, message, ...args) {
    const timestamp = this._getTimestamp();
    const prefix = `[${timestamp}] [${level}]`;
    
    // If additional args are objects, stringify them
    const extra = args.length > 0 
      ? " " + args.map(arg => 
          typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(" ")
      : "";
    
    return { prefix, message: message + extra };
  }

  _log(level, color, message, ...args) {
    if (LOG_LEVELS[level] < this.minLevel) return;

    const { prefix, message: fullMessage } = this._formatMessage(level, message, ...args);
    
    console.log(
      `${COLORS.GRAY}${prefix}${COLORS.RESET} ${color}${fullMessage}${COLORS.RESET}`
    );
  }

  debug(message, ...args) {
    this._log("DEBUG", COLORS.CYAN, message, ...args);
  }

  info(message, ...args) {
    this._log("INFO", COLORS.GREEN, message, ...args);
  }

  warn(message, ...args) {
    this._log("WARN", COLORS.YELLOW, message, ...args);
  }

  error(message, ...args) {
    this._log("ERROR", COLORS.RED, message, ...args);
  }

  success(message, ...args) {
    this._log("INFO", COLORS.GREEN + COLORS.BRIGHT, `✓ ${message}`, ...args);
  }

  // Special loggers for specific contexts
  
  api(method, endpoint, statusCode) {
    const color = statusCode >= 400 ? COLORS.RED : COLORS.GREEN;
    this._log(
      "INFO",
      color,
      `${method.toUpperCase()} ${endpoint} → ${statusCode}`
    );
  }

  classify(emailSubject, result) {
    const icon = result.actionable ? "🚨" : "📭";
    const color = result.actionable ? COLORS.YELLOW : COLORS.GRAY;
    this._log(
      "INFO",
      color,
      `${icon} Classified: "${emailSubject}" → ${result.actionable ? "ACTIONABLE" : "NOT ACTIONABLE"}`
    );
  }

  whatsapp(recipient, success) {
    const icon = success ? "✓" : "✗";
    const color = success ? COLORS.GREEN : COLORS.RED;
    this._log(
      "INFO",
      color,
      `${icon} WhatsApp ${success ? "sent to" : "failed for"} ${recipient}`
    );
  }

  filter(emailSubject, reason) {
    this._log(
      "INFO",
      COLORS.GRAY,
      `🗑️  Filtered: "${emailSubject}" (${reason})`
    );
  }
}

// Create singleton instance
const logger = new Logger(process.env.LOG_LEVEL || "INFO");

export default logger;