const { analyzeImagePromptRisk, buildPolicySafeImagePrompt } = require("./image-prompt-safety.cjs");
const { buildStyledPrompt, normalizeVisualStyle, stripKnownStyleLayer, validateFinalStyledPrompt } = require("./visual-styles.cjs");

function buildImageRequestCandidate({ scenePrompt, styleConfig = null, level = "preflight" }) {
  const receivedScenePrompt = String(scenePrompt || "").trim();
  const hasStyleConfig = Boolean(styleConfig && String(styleConfig.id || "").trim());
  const resolvedStyle = hasStyleConfig ? normalizeVisualStyle(styleConfig, styleConfig.origin || "builtin") : null;
  const originalScenePrompt = stripKnownStyleLayer(receivedScenePrompt, resolvedStyle);
  if (!originalScenePrompt) throw new Error("生图场景提示词为空");
  const safety = buildPolicySafeImagePrompt(originalScenePrompt, level);
  const finalPrompt = resolvedStyle ? buildStyledPrompt(resolvedStyle, safety.prompt) : safety.prompt;
  if (resolvedStyle) validateFinalStyledPrompt(resolvedStyle, finalPrompt);
  return {
    mode: safety.adjusted ? (level === "preflight" ? "preflight-safe" : level) : "original",
    level,
    receivedScenePrompt,
    originalScenePrompt,
    safeScenePrompt: safety.prompt,
    prompt: finalPrompt,
    adjusted: Boolean(safety.adjusted),
    reasons: safety.reasons || [],
    category: safety.category || "general",
    styleId: resolvedStyle?.id || "",
    styleName: resolvedStyle?.name || "",
    registryVersion: resolvedStyle?.registry_version || "",
    negativePrompt: resolvedStyle?.negative_prompt || "",
    allowColor: resolvedStyle ? resolvedStyle.allow_color !== false : true
  };
}

function buildImageRequestCandidates({ scenePrompt, styleConfig = null, policyFallback = true }) {
  const risk = analyzeImagePromptRisk(scenePrompt);
  const first = buildImageRequestCandidate({ scenePrompt, styleConfig, level: "preflight" });
  const candidates = [first];
  if (policyFallback) {
    const levels = first.adjusted ? ["minimal", "ultra"] : ["safe", "ultra"];
    for (const level of levels) {
      const candidate = buildImageRequestCandidate({ scenePrompt, styleConfig, level });
      if (!candidates.some(item => item.prompt === candidate.prompt)) candidates.push(candidate);
    }
  }
  return { risk, candidates };
}

function imagePromptAudit(candidate, provider = "", fallbackLevel = "") {
  return {
    selected_style_id: candidate?.styleId || "",
    resolved_style_id: candidate?.styleId || "",
    registry_version: candidate?.registryVersion || "",
    scene_prompt_before_safety: candidate?.originalScenePrompt || "",
    scene_prompt_after_safety: candidate?.safeScenePrompt || "",
    final_positive_prompt: candidate?.prompt || "",
    final_negative_prompt: candidate?.negativePrompt || "",
    allow_color: candidate?.allowColor !== false,
    provider,
    fallback_level: fallbackLevel || candidate?.level || "preflight"
  };
}

module.exports = {
  buildImageRequestCandidate,
  buildImageRequestCandidates,
  imagePromptAudit
};
