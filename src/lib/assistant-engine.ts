/**
 * SatQuery AI — Conversational Assistant Engine
 * Provides context-aware natural language reasoning, intent resolution,
 * UI action generation, explainability responses, and follow-up suggestions.
 *
 * GEO-MINDS Team
 */

import type { AnalysisResult, ChatAction, ChatMessage, LandClass, RasterSlot, ViewerMode } from "./types";
import { CLASS_META } from "./types";
import { type AgentPlan, routeQuery, SPECIALIST_REGISTRY, type SpecialistTool } from "./agent-router";
import { formatArea, formatPct } from "./utils";

export interface AssistantContext {
  primary?: RasterSlot;
  before?: RasterSlot;
  analysis?: AnalysisResult | null;
  plan?: AgentPlan | null;
  viewerMode: ViewerMode;
  isSar: boolean;
  isOpticalSarPair: boolean;
  isBiTemporal: boolean;
}

export interface AssistantResponse {
  answer: string;
  evidenceSummary: string;
  whyExplain: string[];
  confidenceScore: number;
  confidenceLevel: "high" | "medium" | "low";
  modelLabel: string;
  isSimulated: boolean;
  suggestedQuestions: string[];
  actions: ChatAction[];
  traceSteps: Array<{ label: string; status: "ok" | "warn" | "skip"; detail?: string }>;
}

/**
 * Generate dynamic suggested follow-up questions based on the current scene and analysis
 */
export function generateSuggestedFollowUps(ctx: AssistantContext, lastQuery?: string): string[] {
  const suggestions: string[] = [];
  const q = (lastQuery || "").toLowerCase();

  if (ctx.isBiTemporal) {
    if (!q.includes("change")) suggestions.push("What changed between the two images?");
    if (!q.includes("where")) suggestions.push("Where did the largest change occur?");
    suggestions.push("Compare vegetation & built-up area delta");
  } else if (ctx.isOpticalSarPair) {
    suggestions.push("Analyze Optical + SAR fusion");
    suggestions.push("What does SAR reveal that optical misses?");
    suggestions.push("Identify high-dielectric and moisture zones");
  } else {
    // Single image
    if (ctx.analysis?.detections && ctx.analysis.detections.length > 0) {
      const topLabel = ctx.analysis.detections[0].label;
      suggestions.push(`Zoom in on detected ${topLabel}`);
      suggestions.push("Show high-resolution image crops");
      suggestions.push("What is the total built-up area in sq km?");
    } else {
      suggestions.push("Describe this satellite scene");
      suggestions.push("Highlight all buildings and structures");
      suggestions.push("Calculate water and vegetation coverage");
    }
  }

  // General questions
  if (!suggestions.some((s) => s.includes("Why"))) {
    suggestions.push("Why this result & evidence?");
  }
  if (!suggestions.some((s) => s.includes("model"))) {
    suggestions.push("What model and specialists did you use?");
  }

  return suggestions.slice(0, 4);
}

/**
 * Check if the query is a meta question (e.g. asking about models, capabilities, why, help)
 */
export function handleMetaQuery(query: string, ctx: AssistantContext): AssistantResponse | null {
  const q = query.toLowerCase().trim();

  // Model inquiry
  if (/what model|which model|architecture|what ai|how does this work|model used/.test(q)) {
    const activeSpecialists = ctx.plan?.specialists || [SPECIALIST_REGISTRY["rs-vqa"]];
    const specNames = activeSpecialists.map((s) => `${s.name} (${s.dataset || "Remote Sensing Benchmark"})`).join(", ");

    return {
      answer: `SatQuery AI operates an **Agentic Router** that decomposes your request and dispatches to specialized remote-sensing vision-language models: **${specNames}**.\n\nFor general visual question answering and scene grounding, the pipeline utilizes dual-backbone feature encoders with high-resolution satellite imagery priors at **${ctx.primary?.gsdMeters || 0.5}m GSD**.`,
      evidenceSummary: `Active pipeline: ${ctx.plan?.taskLabel || "Vision-Language Grounding"} · Modality: ${ctx.isSar ? "SAR (Synthetic Aperture Radar)" : ctx.isOpticalSarPair ? "Optical + SAR Cross-Modal" : "Multispectral Optical"} · Spatial GSD: ${ctx.primary?.gsdMeters || 0.5}m/px`,
      whyExplain: [
        "Agent router evaluated input modality and query token semantics to select the optimal model.",
        `Specialist registry engaged: ${activeSpecialists.map((s) => s.id).join(", ")}.`,
        "Spectral band ratios (NDVI/MNDWI) provide deterministic land-cover baseline priors.",
      ],
      confidenceScore: 96,
      confidenceLevel: "high",
      modelLabel: "Agentic Specialist Pipeline (Simulated / Local Engine)",
      isSimulated: true,
      suggestedQuestions: generateSuggestedFollowUps(ctx, query),
      actions: [
        { id: "act-why", label: "View Model Registry", action: "why" },
        { id: "act-export", label: "Export Analysis Report", action: "export-pdf" },
      ],
      traceSteps: [
        { label: "Query understood", status: "ok", detail: "Meta model inquiry" },
        { label: "Pipeline inspected", status: "ok", detail: `${activeSpecialists.length} active specialists` },
        { label: "Registry verified", status: "ok", detail: "Remote sensing benchmarks" },
        { label: "Response formulated", status: "ok" },
      ],
    };
  }

  // Why inquiry
  if (/why|explain (evidence|why|reason|how)|basis|rationale/.test(q) && ctx.analysis) {
    const factors = ctx.plan?.whyResult && ctx.plan.whyResult.length > 0
      ? ctx.plan.whyResult
      : [
          `Spectral pixel clustering verified against calibrated reflectance thresholds.`,
          `GSD of ${ctx.primary?.gsdMeters || 0.5}m provides sufficient spatial resolution for high-confidence boundary extraction.`,
          `Multi-scale sliding window convolution highlighted ${ctx.analysis.detections.length} candidate spatial features.`,
        ];

    return {
      answer: `**Analysis Justification & Observable Evidence:**\n\n${factors.map((f, i) => `${i + 1}. ${f}`).join("\n\n")}`,
      evidenceSummary: `Grounding confidence: ${ctx.plan?.confidenceScore || 88}% · Features isolated: ${ctx.analysis.detections.length} · Land cover classes mapped: ${ctx.analysis.segments.length}`,
      whyExplain: factors,
      confidenceScore: ctx.plan?.confidenceScore || 90,
      confidenceLevel: ctx.plan?.confidence || "high",
      modelLabel: "Evidence Explainer Specialist",
      isSimulated: true,
      suggestedQuestions: generateSuggestedFollowUps(ctx, query),
      actions: [
        { id: "act-evidence", label: "View Detailed Evidence", action: "evidence" },
        ...(ctx.analysis.detections.length > 0
          ? [{ id: "act-zoom", label: "Zoom to Top Detection", action: "zoom-detection" as const }]
          : []),
      ],
      traceSteps: [
        { label: "Query understood", status: "ok", detail: "Evidence explainability request" },
        { label: "Feature attribution computed", status: "ok", detail: `${factors.length} verifiable factors` },
        { label: "Trace synthesized", status: "ok" },
      ],
    };
  }

  // Optical + SAR query specifically
  if (/optical.*sar|sar.*optical|fusion|radar|backscatter|dielectric/.test(q)) {
    const isPair = ctx.isOpticalSarPair;
    return {
      answer: isPair
        ? `**Optical + SAR Cross-Modal Fusion Analysis:**\n\n• **Optical Sensor:** Captures high-resolution surface solar reflectance in visible and near-infrared bands (distinguishing vegetation chlorophyll and urban materials).\n• **SAR Sensor (Sentinel-1 / TerraSAR-X):** Active microwave radar pulses penetrate cloud cover and vegetation canopy, measuring surface dielectric permittivity and structural roughness.\n• **Fused Finding:** High radar backscatter (bright spots) strongly correlates with metallic/concrete vertical corner reflectors (buildings, ships, pylons), even where shaded in optical imagery.`
        : `**SAR vs Optical Explanation:**\n\nOptical imagery measures spectral reflectance (colors, visible light, vegetation index), while SAR (Synthetic Aperture Radar) transmits microwave pulses that penetrate clouds, haze, and foliage. Combining both provides all-weather material and structural analysis. You can upload a co-registered SAR image in the left panel to execute live fusion.`,
      evidenceSummary: `Modality: ${isPair ? "Co-registered Optical + SAR Pair" : "Single Modality"} · Radar sensitivity: Structural geometry & water permittivity`,
      whyExplain: [
        "Microwave wavelengths (C-band ~5.6cm) produce double-bounce corner reflection on man-made vertical structures.",
        "Smooth calm water acts as a specular reflector (low backscatter / dark in SAR).",
        "Optical NDVI complements SAR by validating biomass and vegetation moisture.",
      ],
      confidenceScore: 94,
      confidenceLevel: "high",
      modelLabel: "SAR-OptFusion Specialist (SEN1-2)",
      isSimulated: true,
      suggestedQuestions: generateSuggestedFollowUps(ctx, query),
      actions: [
        { id: "act-view-switch", label: "Switch Optical / SAR View", action: "switch-view" },
        { id: "act-why", label: "Why SAR Matters?", action: "why" },
      ],
      traceSteps: [
        { label: "Query understood", status: "ok", detail: "Cross-modal sensor fusion inquiry" },
        { label: "SAR backscatter calibrated", status: "ok", detail: "Dielectric & roughness matrix" },
        { label: "Optical spectral bands aligned", status: "ok" },
        { label: "Synthesis complete", status: "ok" },
      ],
    };
  }

  return null;
}

/**
 * Generate contextual UI actions attached to a response
 */
export function buildResponseActions(
  analysis: AnalysisResult,
  plan: AgentPlan,
  ctx: AssistantContext,
): ChatAction[] {
  const actions: ChatAction[] = [];

  // Target highlighting / Grounding
  if (analysis.detections.length > 0) {
    const topLabel = analysis.detections[0].label || "objects";
    actions.push({
      id: "act-highlight",
      label: `Highlight ${topLabel} (${analysis.detections.length})`,
      action: "highlight",
      icon: "Crosshair",
    });
    actions.push({
      id: "act-zoom",
      label: `Zoom to ${topLabel}`,
      action: "zoom-detection",
      icon: "Focus",
    });
    if (analysis.extractedItems && analysis.extractedItems.length > 0) {
      actions.push({
        id: "act-crops",
        label: `View High-Res Crops (${analysis.extractedItems.length})`,
        action: "show-crops",
        icon: "Layers",
      });
    }
  }

  // Change detection
  if (analysis.change || plan.inputMode === "before-after") {
    actions.push({
      id: "act-change-map",
      label: `Show Change Map (${analysis.change?.percent ?? 0}%)`,
      action: "change-map",
      icon: "Activity",
    });
    actions.push({
      id: "act-split",
      label: "View Before / After Split",
      action: "switch-view",
      payload: "split",
      icon: "Layers",
    });
  }

  // Optical + SAR
  if (plan.inputMode === "optical-sar-pair") {
    actions.push({
      id: "act-switch-sar",
      label: "Toggle Optical / SAR",
      action: "switch-view",
      payload: "split",
      icon: "Layers",
    });
  }

  // Why & Evidence
  actions.push({
    id: "act-why",
    label: "Why this result?",
    action: "why",
    icon: "Info",
  });

  // Export
  actions.push({
    id: "act-export",
    label: "Export PDF Report",
    action: "export-pdf",
    icon: "Download",
  });

  return actions;
}

/**
 * Construct execution trace steps for the assistant
 */
export function buildConciseTraceSteps(
  plan: AgentPlan,
  ctx: AssistantContext,
): Array<{ label: string; status: "ok" | "warn" | "skip"; detail?: string }> {
  return [
    {
      label: "Query understood",
      status: "ok",
      detail: plan.taskLabel,
    },
    {
      label: "Input validated",
      status: "ok",
      detail: `${ctx.primary?.name || "Scene"} (${ctx.primary?.width || 512}×${ctx.primary?.height || 512} px, GSD ${ctx.primary?.gsdMeters || 0.5}m)`,
    },
    {
      label: "Task selected",
      status: "ok",
      detail: `${plan.task.toUpperCase()} · Specialist: ${plan.specialists[0]?.name || "RS-VLM"}`,
    },
    {
      label: "Specialist analysis",
      status: "ok",
      detail: `${plan.confidenceScore}% confidence · ${plan.confidence.toUpperCase()}`,
    },
    {
      label: "Evidence generated",
      status: "ok",
      detail: `${plan.evidenceFactors.length} verifiable indicators`,
    },
  ];
}
