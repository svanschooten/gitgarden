let debugEnabled = false;

// Where log output goes. Swappable so that embedders — and tests, whose stdout
// carries the test runner's own IPC stream — can silence or capture it.
let sink = console;

export function setDebug(enabled) {
  debugEnabled = enabled;
}

/**
 * Redirect log output. Pass nothing to restore the console.
 * @param {{log: Function, warn: Function, error: Function}} [next]
 */
export function setOutput(next) {
  sink = next || console;
}

/** Discard all output. Convenience for tests and for embedding. */
export function silence() {
  setOutput({ log() {}, warn() {}, error() {} });
}

export function log(...args) {
  if (debugEnabled) {
    sink.log(...args);
  }
}

export function info(...args) {
  sink.log(...args);
}

export function warn(...args) {
  sink.warn(...args);
}

export function error(...args) {
  sink.error(...args);
}

export function time(label) {
  if (debugEnabled && sink.time) {
    sink.time(label);
  }
}

export function timeEnd(label) {
  if (debugEnabled && sink.timeEnd) {
    sink.timeEnd(label);
  }
}
