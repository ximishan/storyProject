const assert = require("node:assert/strict");
const { runWithCancellation, TaskCancelledError, cancellableSleep, isCancellationError } = require("../electron/cancellation.cjs");
const { spawnAsync } = require("../electron/services.cjs");
const { retryOperation } = require("../electron/checkpoint.cjs");
const { taskDeletionBlocked, taskQueueEligible, clearActiveLlmConfig } = require("../electron/task-controls.cjs");

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

  {
    assert.equal(taskDeletionBlocked({ status: "running" }), true);
    assert.equal(taskDeletionBlocked({ status: "pending" }, true), true);
    assert.equal(taskDeletionBlocked({ status: "cancelled" }), false);
    assert.equal(taskQueueEligible({ status: "pending", cancel_requested: 0 }), true);
    assert.equal(taskQueueEligible({ status: "running", cancel_requested: 0 }), false);
    assert.equal(taskQueueEligible({ status: "pending", cancel_requested: 1 }), false);
    const cleared = clearActiveLlmConfig({ llm: { api_key: "secret", model: "old" } }, {
      provider: "local", protocol: "local", api_key: "", base_url: "", model: "", proxy_url: ""
    });
    assert.equal(cleared.llm.provider, "local");
    assert.equal(cleared.llm.api_key, "");
    assert.equal(cleared.llm.active_profile_id, "");
  }

  console.log("cancellation-flow-test: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
