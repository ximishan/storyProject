const assert = require("node:assert/strict");
const { runWithCancellation, TaskCancelledError, cancellableSleep, isCancellationError } = require("../electron/cancellation.cjs");
const { spawnAsync } = require("../electron/services.cjs");
const { retryOperation } = require("../electron/checkpoint.cjs");

async function expectCancelled(promise, label) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  assert(error, `${label}: expected rejection`);
  assert(isCancellationError(error), `${label}: expected cancellation error, got ${error?.name}: ${error?.message}`);
}

(async () => {
  {
    const controller = new AbortController();
    const promise = runWithCancellation(controller.signal, () => cancellableSleep(10_000));
    setTimeout(() => controller.abort(new TaskCancelledError()), 50);
    await expectCancelled(promise, "sleep");
  }

  {
    const controller = new AbortController();
    let attempts = 0;
    const promise = runWithCancellation(controller.signal, () => retryOperation(async () => {
      attempts += 1;
      throw new Error("network timeout");
    }, { attempts: 5, initialDelayMs: 10_000 }));
    setTimeout(() => controller.abort(new TaskCancelledError()), 50);
    await expectCancelled(promise, "retry delay");
    assert.equal(attempts, 1, "cancellation must stop retries");
  }

  {
    const controller = new AbortController();
    const promise = runWithCancellation(controller.signal, () => spawnAsync(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]));
    setTimeout(() => controller.abort(new TaskCancelledError()), 100);
    await expectCancelled(promise, "child process");
  }

  console.log("cancellation-flow-test: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
