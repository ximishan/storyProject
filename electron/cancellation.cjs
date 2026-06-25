const { AsyncLocalStorage } = require("node:async_hooks");

const cancellationContext = new AsyncLocalStorage();

class TaskCancelledError extends Error {
  constructor(message = "任务已取消") {
    super(message);
    this.name = "TaskCancelledError";
    this.code = "TASK_CANCELLED";
  }
}

function currentCancellationSignal() {
  return cancellationContext.getStore()?.signal || null;
}

function runWithCancellation(signal, operation) {
  return cancellationContext.run({ signal: signal || null }, operation);
}

function isCancellationError(error) {
  return Boolean(
    error?.code === "TASK_CANCELLED"
    || error?.name === "TaskCancelledError"
    || error?.name === "AbortError"
    || /任务已取消|操作已取消|operation was aborted|the operation was aborted/i.test(String(error?.message || error || ""))
  );
}

function cancellationError(signal = currentCancellationSignal()) {
  const reason = signal?.reason;
  if (reason instanceof TaskCancelledError) return reason;
  if (reason instanceof Error && isCancellationError(reason)) {
    return new TaskCancelledError(reason.message || "任务已取消");
  }
  return new TaskCancelledError();
}

function throwIfCancelled(signal = currentCancellationSignal()) {
  if (signal?.aborted) throw cancellationError(signal);
}

function cancellableSleep(ms, signal = currentCancellationSignal()) {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(cancellationError(signal)));
    const timer = setTimeout(() => finish(resolve), Math.max(0, Number(ms || 0)));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

module.exports = {
  TaskCancelledError,
  currentCancellationSignal,
  runWithCancellation,
  isCancellationError,
  cancellationError,
  throwIfCancelled,
  cancellableSleep
};
