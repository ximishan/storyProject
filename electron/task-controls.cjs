function taskDeletionBlocked(task, hasActiveRun = false) {
  return Boolean(hasActiveRun || ["running", "cancelling"].includes(String(task?.status || "")));
}

function taskQueueEligible(task, hasActiveRun = false) {
  if (!task || hasActiveRun || task.cancel_requested) return false;
  return !["running", "cancelling", "completed", "cancelled"].includes(String(task.status || ""));
}

function clearActiveLlmConfig(config, defaultLlm) {
  return {
    ...config,
    llm: {
      ...defaultLlm,
      active_profile_id: ""
    }
  };
}

module.exports = { taskDeletionBlocked, taskQueueEligible, clearActiveLlmConfig };
