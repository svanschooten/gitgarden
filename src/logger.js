let debugEnabled = false;

export function setDebug(enabled) {
  debugEnabled = enabled;
}

export function log(...args) {
  if (debugEnabled) {
    console.log(...args);
  }
}

export function info(...args) {
  console.log(...args);
}

export function warn(...args) {
  console.warn(...args);
}

export function error(...args) {
  console.error(...args);
}

export function time(label) {
  if (debugEnabled) {
    console.time(label);
  }
}

export function timeEnd(label) {
  if (debugEnabled) {
    console.timeEnd(label);
  }
}
