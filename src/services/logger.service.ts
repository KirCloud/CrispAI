import winston from "winston";

const logLevel = process.env.LOG_LEVEL || "info";

const logger = winston.createLogger({
  level: logLevel,
  // 不让 winston 接管未捕获异常/未处理拒绝：它默认 exitOnError 为 true，
  // 会在记录完日志后直接 process.exit(1)。进程级兜底统一放在 index.ts，只记录不退出
  exitOnError: false,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      let logMessage = `[${timestamp}] ${level}: ${message}`;

      if (stack) {
        logMessage += "\n" + stack;
      }

      if (Object.keys(meta).length > 0) {
        logMessage += "\n" + JSON.stringify(meta, null, 2);
      }

      return logMessage;
    })
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
