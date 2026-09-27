import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Crosshair,
  Database,
  Download,
  FileText,
  Focus,
  Info,
  Layers,
  LoaderCircle,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Ruler,
  Send,
  Sun,
  Upload,
  Zap,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { analyzeScene } from "@/lib/analyze";
import {
  buildQueryTintMap,
  computeChange,
  computeCover,
  composeLocalAnswer,
  coverToSegments,
  detectForQuery,
  extractDetectionCrops,
  inferIntent,
  parseQueryTarget,
  renderHighlightedSnapshot,
  thumbnailDataUrl,
} from "@/lib/image-analysis";
import {
  downloadDataUrl,
  exportAnnotatedPng,
  exportCsv,
  exportGeoJson,
  exportJsonReport,
  exportPdf,
} from "@/lib/export-results";
import { rasterFromFile } from "@/lib/raster";
import { PROMPT_GALLERY, SAMPLE_SCENES, slotFromSample } from "@/lib/samples";
import { routeQuery, type AgentPlan, SPECIALIST_REGISTRY } from "@/lib/agent-router";
import { saveHistoryEntry, loadHistory, clearHistory, type HistoryEntry } from "@/lib/history";
import { exportFullReport, exportFullJson } from "@/lib/report";
import type {
  AnalysisResult,
  BBox,
  ChatMessage,
  ExtractedItem,
  LandClass,
  RasterSlot,
  ViewerMode,
} from "@/lib/types";
import { CLASS_META, LAND_CLASSES } from "@/lib/types";
import { cn, formatArea, formatPct, uid } from "@/lib/utils";
import { ImageViewer } from "./image-viewer";
import { SatQueryAssistant } from "./assistant";
import {
  type AssistantContext,
  buildConciseTraceSteps,
  buildResponseActions,
  generateSuggestedFollowUps,
} from "@/lib/assistant-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppTab = "workspace" | "history" | "registry" | "about";

// ─── Theme hook ───────────────────────────────────────────────────────────────

function useTheme() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("light", light);
  }, [light]);
  return { light, setLight };
}

// ─── Input validation ─────────────────────────────────────────────────────────

function validateInputs(primary?: RasterSlot, before?: RasterSlot) {
  const issues: string[] = [];
  if (!primary) return { ok: false, issues: ["No primary image loaded"] };

  if (primary.width < 16 || primary.height < 16)
    issues.push("Primary image is too small (< 16 px)");

  if (before) {
    const wRatio = Math.max(primary.width, before.width) / Math.min(primary.width, before.width);
    const hRatio = Math.max(primary.height, before.height) / Math.min(primary.height, before.height);
    if (wRatio > 4 || hRatio > 4)
      issues.push("Before/after images have very different sizes — change analysis may be unreliable");
  }

  return { ok: issues.length === 0, issues };
}

// ─── Sample loader ────────────────────────────────────────────────────────────

function loadSample(
  sample: (typeof SAMPLE_SCENES)[number],
  setPrimary: (s: RasterSlot) => void,
  setBefore: (s: RasterSlot | undefined) => void,
  setMode: (m: ViewerMode) => void,
  setAnalysis: (a: AnalysisResult | null) => void,
  setMessages: (m: ChatMessage[]) => void,
  setActiveDetectionId: (id: string | null) => void,
) {
  const loaded = slotFromSample(sample);
  setPrimary(loaded.primary);
  setBefore(loaded.before);
  setMode(loaded.before ? "split" : "primary");
  setAnalysis(null);
  setMessages([]);
  setActiveDetectionId(null);
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfBadge({ level, score }: { level: string; score: number }) {
  const colors = {
    high: "bg-emerald-900/60 text-emerald-300 border-emerald-800",
    medium: "bg-amber-900/60 text-amber-300 border-amber-800",
    low: "bg-red-900/60 text-red-300 border-red-800",
  };
  const cl = colors[level as keyof typeof colors] ?? colors.medium;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium", cl)}>
      {score}% · {level.toUpperCase()}
    </span>
  );
}

// ─── Execution Trace Panel ────────────────────────────────────────────────────

function ExecutionTrace({ plan }: { plan: AgentPlan }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-bg">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5">
          <Activity className="size-3.5 text-accent" />
          Execution Trace
        </span>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/60 px-3 pb-3 pt-2">
          {plan.trace.map((step, i) => (
            <div key={step.id} className="flex items-start gap-2">
              {i < plan.trace.length - 1 && (
                <div className="mt-1.5 flex flex-col items-center">
                  <CheckCircle2
                    className={cn(
                      "size-3",
                      step.status === "ok"
                        ? "text-emerald-400"
                        : step.status === "warn"
                          ? "text-amber-400"
                          : "text-muted-foreground",
                    )}
                  />
                  <div className="mt-0.5 h-3 w-px bg-border" />
                </div>
              )}
              {i === plan.trace.length - 1 && (
                <CheckCircle2
                  className={cn(
                    "mt-1 size-3",
                    step.status === "ok"
                      ? "text-emerald-400"
                      : step.status === "warn"
                        ? "text-amber-400"
                        : "text-muted-foreground",
                  )}
                />
              )}
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-fg">{step.label}</div>
                {step.detail && <div className="text-[10px] text-muted-foreground">{step.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Evidence Panel ───────────────────────────────────────────────────────────

function EvidencePanel({
  plan,
  onViewEvidence,
}: {
  plan: AgentPlan;
  onViewEvidence: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-bg">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5">
          <Info className="size-3.5 text-accent" />
          Why this result?
        </span>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      {open && (
        <div className="border-t border-border/60 px-3 pb-3 pt-2 space-y-2">
          <ol className="space-y-1">
            {plan.whyResult.map((item, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-muted-foreground">
                <span className="shrink-0 font-mono text-accent">{i + 1}.</span>
                {item}
              </li>
            ))}
          </ol>
          <button
            onClick={onViewEvidence}
            className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-accent hover:underline"
          >
            <Focus className="size-3" />
            View Evidence on Map
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Agent Workflow Banner ────────────────────────────────────────────────────

function AgentWorkflowBanner({ plan }: { plan: AgentPlan }) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Zap className="size-3.5 text-accent" />
          <span className="text-xs font-semibold text-fg">Agent Workflow</span>
        </div>
        {plan.demoMode && (
          <span className="rounded border border-amber-700/50 bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
            DEMO / SIMULATED
          </span>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">
        <span className="font-medium text-fg">Task:</span> {plan.taskLabel}
      </div>
      <div className="flex flex-wrap gap-1">
        {plan.specialists.map((s) => (
          <span
            key={s.id}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px]",
              s.status === "active"
                ? "border-emerald-800 bg-emerald-900/30 text-emerald-300"
                : s.status === "stub"
                  ? "border-amber-800 bg-amber-900/30 text-amber-300"
                  : "border-border bg-secondary text-muted-foreground",
            )}
          >
            {s.status === "active" ? "✓" : s.status === "stub" ? "○" : "✗"} {s.name}
          </span>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {plan.demoMode
          ? "⚠ One or more components use demo/simulated inference. Not scientifically validated."
          : "Real inference: Gemini VLM + spectral analysis active."}
      </div>
    </div>
  );
}

// ─── Input Validation Banner ──────────────────────────────────────────────────

function ValidationBanner({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
      <ul className="space-y-0.5">
        {issues.map((issue, i) => (
          <li key={i} className="text-[11px] text-amber-300">
            {issue}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── History Page ─────────────────────────────────────────────────────────────

function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory());

  const handleClear = () => {
    clearHistory();
    setEntries([]);
    toast.success("History cleared");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-accent" />
          <span className="font-semibold text-sm">Analysis History</span>
        </div>
        {entries.length > 0 && (
          <Button size="sm" variant="secondary" onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
            <Clock className="size-8 opacity-40" />
            <p className="text-sm">No analyses yet. Run a query to start building history.</p>
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="rounded-xl border border-border bg-surface p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium truncate">{e.query}</p>
                  <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    <span>{e.imageName}</span>
                    {e.beforeName && <span>+ {e.beforeName}</span>}
                    <span>·</span>
                    <span>{e.taskLabel}</span>
                  </div>
                </div>
                <ConfBadge level={e.confidence >= 82 ? "high" : e.confidence >= 65 ? "medium" : "low"} score={e.confidence} />
              </div>
              {e.snapshotUrl && (
                <img
                  src={e.snapshotUrl}
                  alt="snapshot"
                  className="w-full max-h-28 rounded-lg object-cover border border-border"
                />
              )}
              <p className="text-[11px] text-muted-foreground line-clamp-3">{e.answer}</p>
              <div className="flex items-center justify-between text-[10px] text-subtle">
                <span>{new Date(e.createdAt).toLocaleString()}</span>
                {e.changePercent != null && (
                  <span className="font-mono">{e.changePercent.toFixed(1)}% change</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Model Registry Page ──────────────────────────────────────────────────────

function RegistryPage() {
  const tools = Object.values(SPECIALIST_REGISTRY);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Database className="size-4 text-accent" />
        <span className="font-semibold text-sm">Specialist Model Registry</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Modular registry of specialist remote-sensing models/tools. Status:{" "}
          <span className="text-emerald-400">Active</span> = real inference,{" "}
          <span className="text-amber-400">Stub</span> = demo/placeholder ready for integration,{" "}
          <span className="text-muted-foreground">Unavailable</span> = not connected.
        </p>
        {tools.map((tool) => (
          <div key={tool.id} className="rounded-xl border border-border bg-surface p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{tool.name}</span>
              <span
                className={cn(
                  "rounded border px-2 py-0.5 text-[10px] font-medium",
                  tool.status === "active"
                    ? "border-emerald-800 bg-emerald-900/30 text-emerald-300"
                    : tool.status === "stub"
                      ? "border-amber-800 bg-amber-900/30 text-amber-300"
                      : "border-border bg-secondary text-muted-foreground",
                )}
              >
                {tool.status.toUpperCase()}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">{tool.description}</p>
            {tool.dataset && (
              <p className="text-[10px] text-subtle">
                Dataset adapter:{" "}
                <span className="font-mono text-accent">{tool.dataset}</span>
              </p>
            )}
          </div>
        ))}
        <div className="rounded-xl border border-border bg-surface p-3 space-y-1.5 mt-4">
          <div className="text-xs font-semibold text-fg">Remote-Sensing Datasets</div>
          <p className="text-[11px] text-muted-foreground">
            Architecture prepared for model fine-tuning / adaptation with:
          </p>
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {["BigEarthNet (land cover)", "VRSBench (VQA + grounding)", "RSVQA (remote-sensing VQA)", "CDVQA (change detection VQA)", "SEN1-2 (optical-SAR pairs)"].map((d) => (
              <li key={d} className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-accent" />
                {d}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-subtle mt-2">
            No fine-tuning has been performed in this prototype. Interfaces are clean stubs ready for integration.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── About Page ───────────────────────────────────────────────────────────────

function AboutPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <BookOpen className="size-4 text-accent" />
        <span className="font-semibold text-sm">About SatQuery AI</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
        <div>
          <h2 className="font-bold text-base text-fg">SatQuery AI</h2>
          <p className="text-muted-foreground text-xs mt-0.5">
            An Interactive Vision-Language Assistant for Multimodal Remote-Sensing Image Analysis through Text Queries
          </p>
          <p className="text-xs text-subtle mt-1">Team: GEO-MINDS</p>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-subtle">Supported Analysis Modes</div>
          {[
            ["Single-Image VQA", "Ask natural-language questions about any satellite scene"],
            ["Scene Description", "Remote-sensing-oriented automatic scene captioning"],
            ["Text-Guided Grounding", "Highlight specific objects or land classes"],
            ["Bi-Temporal Change", "Compare before/after image pairs for change detection"],
            ["Optical + SAR Fusion", "Cross-modal analysis combining optical and SAR imagery"],
            ["Land-Cover Statistics", "Quantitative pixel-level coverage analysis"],
          ].map(([title, desc]) => (
            <div key={title} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
              <div>
                <span className="text-xs font-medium text-fg">{title}</span>
                <p className="text-[11px] text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-subtle">Key Architecture</div>
          <div className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[11px] text-muted-foreground space-y-0.5">
            {["User Query + Image(s)", "↓ Input Validation", "↓ Agentic Query Router", "↓ Task Classification", "↓ Specialist Model Selection", "↓ Remote-Sensing Analysis", "↓ Evidence + Confidence", "↓ Answer + Visualization", "↓ Execution Trace + Report"].map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="rounded-lg border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-300">
          <div className="font-semibold mb-1">Transparency Notice</div>
          Confidence values are estimated, not statistically calibrated. Some specialist models are in stub/demo mode. Real inference is provided by Google Gemini and/or xAI Grok vision-language models. Local analysis uses spectral heuristics (NDVI proxy, RGB thresholds). No model fine-tuning has been performed in this prototype.
        </div>
      </div>
    </div>
  );
}

// ─── MAIN WORKSPACE ───────────────────────────────────────────────────────────

export function SatQueryWorkspace() {
  const { light, setLight } = useTheme();

  // Core image state
  const [primary, setPrimary] = useState<RasterSlot | undefined>();
  const [before, setBefore] = useState<RasterSlot | undefined>();
  const [isSar, setIsSar] = useState(false);

  // Chat / analysis state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [validationIssues, setValidationIssues] = useState<string[]>([]);

  // Viewer state
  const [mode, setMode] = useState<ViewerMode>("primary");
  const [showDetections, setShowDetections] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showSeg, setShowSeg] = useState(true);
  const [showChange, setShowChange] = useState(true);
  const [tintOpacity, setTintOpacity] = useState(0.48);
  const [activeDetectionId, setActiveDetectionId] = useState<string | null>(null);
  const [classVisibility, setClassVisibility] = useState<Partial<Record<LandClass, boolean>>>({});
  const [measuring, setMeasuring] = useState(false);
  const [measure, setMeasure] = useState<{ a: { x: number; y: number } | null; b: { x: number; y: number } | null }>({
    a: null,
    b: null,
  });

  // UI state
  const [mobileTab, setMobileTab] = useState<"scene" | "ask">("scene");
  const [panelOpen, setPanelOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [appTab, setAppTab] = useState<AppTab>("workspace");
  const [showDemoMode, setShowDemoMode] = useState(false);

  // Refs
  const fitRef = useRef<() => void>(() => {});
  const focusBBoxRef = useRef<(bbox: BBox) => void>(() => {});
  const captureRef = useRef<HTMLCanvasElement | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const beforeFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const measureMeters = useMemo(() => {
    if (!primary || !measure.a || !measure.b) return null;
    const dx = (measure.b.x - measure.a.x) * primary.width;
    const dy = (measure.b.y - measure.a.y) * primary.height;
    const px = Math.hypot(dx, dy);
    return px * primary.gsdMeters;
  }, [measure, primary]);

  // Validate inputs whenever they change
  useEffect(() => {
    const { issues } = validateInputs(primary, before);
    setValidationIssues(issues);
  }, [primary, before]);

  const handleFocusItem = useCallback((item: ExtractedItem) => {
    setActiveDetectionId(item.id);
    setShowSeg(true);
    setMobileTab("scene");
    focusBBoxRef.current(item.bbox);
    toast.message(`Centered on ${item.label}`);
  }, []);

  const ingestFiles = useCallback(async (files: FileList | File[], asBefore = false) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    try {
      if (list.length >= 2) {
        const a = await rasterFromFile(list[0]!);
        const b = await rasterFromFile(list[1]!);
        setBefore(a);
        setPrimary(b);
        setMode("split");
        toast.message("Loaded a before / after pair — change analysis enabled");
      } else {
        const slot = await rasterFromFile(list[0]!);
        if (asBefore) {
          setBefore(slot);
          toast.message("Before image loaded");
        } else {
          setPrimary(slot);
          toast.message("Scene loaded");
        }
      }
      setAnalysis(null);
      setAgentPlan(null);
      setActiveDetectionId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read file");
    }
  }, []);

  const runQuery = useCallback(
    async (question: string) => {
      if (!primary) {
        toast.error("Load an image first");
        return;
      }
      const q = question.trim();
      if (!q) return;

      setDraft("");
      setActiveDetectionId(null);
      const userMsg: ChatMessage = { id: uid("m"), role: "user", text: q, createdAt: Date.now() };
      setMessages((m) => [...m, userMsg]);
      setBusy(true);

      // 1. Route the query through the agentic planner
      const { ok: valOk } = validateInputs(primary, before);
      const plan = routeQuery({
        question: q,
        hasPrimary: true,
        hasBefore: Boolean(before),
        isSar,
        validationPassed: valOk,
        demoMode: showDemoMode,
      });
      setAgentPlan(plan);

      try {
        // 2. Local spectral analysis
        const cover = await computeCover(primary.src);
        let change;
        if (before) change = await computeChange(before.src, primary.src);
        const target = parseQueryTarget(q, Boolean(before));
        const targetedDet = await detectForQuery(primary.src, cover, q, target, change);
        const tint = await buildQueryTintMap(primary.src, cover, q, target, targetedDet, change);
        const intent = inferIntent(q, Boolean(before));
        const localAnswer = composeLocalAnswer(q, cover, tint, target, change);

        const nextVisibility: Partial<Record<LandClass, boolean>> = {};
        if (target.isSpecificTarget && target.highlightClasses.length <= 2) {
          for (const cls of LAND_CLASSES) {
            nextVisibility[cls] = target.highlightClasses.includes(cls);
          }
        } else {
          for (const cls of LAND_CLASSES) {
            nextVisibility[cls] = cls !== "other";
          }
        }
        setClassVisibility(nextVisibility);

        const [extractedItems, highlightedSnapshotUrl] = await Promise.all([
          extractDetectionCrops(primary.src, targetedDet, primary.gsdMeters, tint, 12),
          renderHighlightedSnapshot(primary.src, cover, tint, target, change),
        ]);

        const local: AnalysisResult = {
          answer: localAnswer,
          intent,
          target,
          tint,
          highlightedTarget: target.targetLabel,
          highlightedSnapshotUrl,
          extractedItems,
          detections: targetedDet,
          segments: coverToSegments(cover),
          statistics: [
            {
              name: `Tinted (${target.targetLabel})`,
              value: formatPct(tint.coveragePct),
              hint: formatArea(
                (tint.coveragePct / 100) * primary.width * primary.height,
                primary.gsdMeters,
              ),
            },
            ...LAND_CLASSES.map((c) => ({
              name: CLASS_META[c].label,
              value: formatPct(cover.percents[c]),
              hint: formatArea(
                cover.counts[c] * (primary.width / cover.width) * (primary.height / cover.height),
                primary.gsdMeters,
              ),
            })),
          ],
          change,
          cover,
        };

        const assistantId = uid("m");
        setAnalysis(local);
        setShowDetections(false);
        setShowLabels(false);
        setShowSeg(true);
        setShowChange(Boolean(local.change));

        const assistantContext: AssistantContext = {
          primary,
          before,
          analysis: local,
          plan,
          viewerMode: mode,
          isSar,
          isOpticalSarPair: Boolean(primary && before && (isSar || before.name.toLowerCase().includes("sar"))),
          isBiTemporal: Boolean(primary && before && !(isSar || before.name.toLowerCase().includes("sar"))),
        };

        const initialActions = buildResponseActions(local, plan, assistantContext);
        const initialTrace = buildConciseTraceSteps(plan, assistantContext);
        const initialFollowUps = generateSuggestedFollowUps(assistantContext, q);

        const initialBotMsg: ChatMessage = {
          id: assistantId,
          role: "assistant",
          text: local.answer,
          analysis: local,
          plan,
          evidenceSummary: `${plan.taskLabel} · ${local.detections.length} objects localized · ${local.segments.length} land cover classes`,
          whyExplain: plan.whyResult,
          confidenceScore: plan.confidenceScore,
          confidenceLevel: plan.confidence,
          modelLabel: plan.specialists[0]?.name || "RS-VLM Specialist",
          isSimulated: true,
          suggestedQuestions: initialFollowUps,
          actions: initialActions,
          traceSteps: initialTrace,
          createdAt: Date.now(),
        };

        setMessages((m) => [...m, initialBotMsg]);
        setMobileTab("ask");
        setBusy(false);

        // Save to history (fire-and-forget)
        saveHistoryEntry(q, primary, local, plan, before);

        // 3. Async VLM upgrade
        void (async () => {
          try {
            const images: { name: string; dataUrl: string; role: "primary" | "before" }[] = [
              { name: primary.name, dataUrl: await thumbnailDataUrl(primary.src, 512, 0.68), role: "primary" },
            ];
            if (before) {
              images.unshift({
                name: before.name,
                dataUrl: await thumbnailDataUrl(before.src, 512, 0.68),
                role: "before",
              });
            }
            const history = [...messages, userMsg].map((m) => ({ role: m.role, text: m.text }));
            const vlm = await analyzeScene({
              data: {
                question: q,
                images,
                history,
                localStats: {
                  percents: cover.percents,
                  detectionCount: targetedDet.length,
                  changePercent: change?.percent,
                  changeSummary: change?.summary,
                  targetLabel: target.targetLabel,
                },
              },
            });
            if (!vlm.ok || !vlm.analysis.answer) return;

            const finalDetections =
              vlm.analysis.detections.length > 0
                ? vlm.analysis.detections.map((d) => ({
                    ...d,
                    color: d.color || target.colorHex,
                    highlighted: true,
                  }))
                : local.detections;

            const vlmTint =
              vlm.analysis.detections.length > 0
                ? await buildQueryTintMap(primary.src, cover, q, target, finalDetections, change)
                : local.tint;

            const [vlmExtractedItems, vlmSnapshotUrl] =
              vlm.analysis.detections.length > 0
                ? await Promise.all([
                    extractDetectionCrops(primary.src, finalDetections, primary.gsdMeters, vlmTint, 12),
                    renderHighlightedSnapshot(primary.src, cover, vlmTint, target, change),
                  ])
                : [local.extractedItems, local.highlightedSnapshotUrl];

            const merged: AnalysisResult = {
              ...local,
              answer: vlm.analysis.answer,
              sceneSummary: vlm.analysis.sceneSummary,
              highlightedTarget: vlm.analysis.highlightedTarget || local.highlightedTarget,
              intent: vlm.analysis.intent,
              tint: vlmTint,
              detections: finalDetections,
              extractedItems: vlmExtractedItems,
              highlightedSnapshotUrl: vlmSnapshotUrl,
              statistics: vlm.analysis.statistics.length ? vlm.analysis.statistics : local.statistics,
              change: vlm.analysis.change
                ? {
                    ...local.change,
                    ...vlm.analysis.change,
                    mask: local.change?.mask,
                    width: local.change?.width,
                    height: local.change?.height,
                  }
                : local.change,
            };
            setAnalysis(merged);

            const updatedActions = buildResponseActions(merged, plan, assistantContext);
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId
                  ? {
                      ...msg,
                      text: merged.answer,
                      analysis: merged,
                      modelLabel: "Google Gemini VLM (Multi-Modal)",
                      isSimulated: false,
                      actions: updatedActions,
                    }
                  : msg,
              ),
            );
            // Update history with improved VLM answer
            saveHistoryEntry(q, primary, merged, plan, before);
          } catch {
            /* keep local answer */
          }
        })();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Analysis failed");
        setMessages((m) => [
          ...m,
          {
            id: uid("m"),
            role: "assistant",
            text: "Something went wrong while analyzing this scene. Try a shorter question or another image.",
            createdAt: Date.now(),
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [before, messages, primary, isSar, showDemoMode],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void runQuery(draft);
        }
        return;
      }
      if (e.key === "0") {
        setActiveDetectionId(null);
        fitRef.current();
      }
      if (e.key === "m" || e.key === "M") setMeasuring((v) => !v);
      if (e.key === "d" || e.key === "D") setShowDetections((v) => !v);
      if (e.key === "s" || e.key === "S") setShowSeg((v) => !v);
      if (e.key === "Escape") {
        setMeasuring(false);
        setMeasure({ a: null, b: null });
        setActiveDetectionId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, runQuery]);

  const chartData = analysis
    ? analysis.segments.map((s) => ({ name: s.label, pct: Number(s.coveragePct.toFixed(1)), fill: s.color }))
    : [];

  const navItems: { id: AppTab; label: string; icon: React.ReactNode }[] = [
    { id: "workspace", label: "Analysis", icon: <Layers className="size-3.5" /> },
    { id: "history", label: "History", icon: <Clock className="size-3.5" /> },
    { id: "registry", label: "Registry", icon: <Database className="size-3.5" /> },
    { id: "about", label: "About", icon: <BookOpen className="size-3.5" /> },
  ];

  return (
    <TooltipProvider>
      <div
        className="flex h-dvh flex-col bg-bg text-fg"
        onDragOver={(e) => {
          e.preventDefault();
          if (appTab === "workspace") setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (appTab === "workspace") void ingestFiles(e.dataTransfer.files);
        }}
      >
        {/* ── Header ── */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Focus className="size-4" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-tight">SatQuery AI</div>
              <div className="hidden text-[10px] text-muted-foreground sm:block">GEO-MINDS · Vision-Language Remote-Sensing</div>
            </div>
          </div>

          {/* Nav */}
          <nav className="ml-4 hidden items-center gap-0.5 sm:flex">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setAppTab(item.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                  appTab === item.id
                    ? "bg-secondary text-fg"
                    : "text-muted-foreground hover:text-fg",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {appTab === "workspace" && (
              <>
                <Tooltip content="Load primary image">
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload />
                    <span className="hidden sm:inline">Upload</span>
                  </Button>
                </Tooltip>
                <Tooltip content="Reset zoom & fit (0)">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setActiveDetectionId(null);
                      fitRef.current();
                    }}
                    aria-label="Fit"
                  >
                    <Focus />
                  </Button>
                </Tooltip>
                <Tooltip content="Measure (M)">
                  <Button
                    variant={measuring ? "default" : "ghost"}
                    size="icon-sm"
                    onClick={() => setMeasuring((v) => !v)}
                    aria-pressed={measuring}
                    aria-label="Measure"
                  >
                    <Ruler />
                  </Button>
                </Tooltip>
              </>
            )}
            <Tooltip content="Toggle theme">
              <Button variant="ghost" size="icon-sm" onClick={() => setLight(!light)} aria-label="Theme">
                {light ? <Moon /> : <Sun />}
              </Button>
            </Tooltip>
            {appTab === "workspace" && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                onClick={() => setPanelOpen((v) => !v)}
                aria-label="Toggle panel"
              >
                {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            )}
          </div>
        </header>

        {/* ── Non-workspace pages ── */}
        {appTab !== "workspace" && (
          <div className="flex-1 overflow-hidden">
            {appTab === "history" && <HistoryPage />}
            {appTab === "registry" && <RegistryPage />}
            {appTab === "about" && <AboutPage />}
          </div>
        )}

        {/* ── Workspace ── */}
        {appTab === "workspace" && (
          <div className="flex min-h-0 flex-1">
            {/* ── Viewer Section ── */}
            <section className={cn("flex min-w-0 flex-1 flex-col", mobileTab === "ask" && "hidden lg:flex")}>
              {/* Viewer toolbar */}
              <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
                {(["primary", "before", "split", "blend"] as ViewerMode[]).map((m) => (
                  <button
                    key={m}
                    className={cn(
                      "h-8 rounded-md px-2.5 text-xs capitalize",
                      mode === m ? "bg-secondary text-fg" : "text-muted-foreground hover:text-fg",
                    )}
                    onClick={() => setMode(m)}
                    disabled={m !== "primary" && !before}
                  >
                    {m === "primary" ? "After / Scene" : m}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-border" />
                <label className="flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={showSeg} onChange={(e) => setShowSeg(e.target.checked)} />
                  Tint Area
                </label>
                {showSeg ? (
                  <label className="flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min={0.15}
                      max={0.8}
                      step={0.05}
                      value={tintOpacity}
                      onChange={(e) => setTintOpacity(Number(e.target.value))}
                      className="w-16 accent-accent"
                    />
                  </label>
                ) : null}
                {before ? (
                  <label className="flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={showChange} onChange={(e) => setShowChange(e.target.checked)} />
                    Change
                  </label>
                ) : null}
                {/* SAR toggle */}
                <label className="ml-1 flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={isSar}
                    onChange={(e) => {
                      setIsSar(e.target.checked);
                      if (e.target.checked) toast.message("SAR mode enabled — cross-modal analysis available");
                    }}
                  />
                  SAR image
                </label>
                <span className="ml-auto hidden items-center gap-1 px-2 text-xs text-muted-foreground sm:flex">
                  <Layers className="size-3.5" />
                  {isSar ? "SAR" : "Optical"} · tinted overlay
                </span>
              </div>
              <div className="relative min-h-0 flex-1">
                <ImageViewer
                  primary={primary}
                  before={before}
                  analysis={analysis}
                  mode={mode}
                  showDetections={showDetections}
                  showLabels={showLabels}
                  showSeg={showSeg}
                  showChange={showChange}
                  tintOpacity={tintOpacity}
                  activeDetectionId={activeDetectionId}
                  onSelectDetection={setActiveDetectionId}
                  classVisibility={classVisibility}
                  measuring={measuring}
                  measure={measure}
                  onMeasure={setMeasure}
                  onFitRequest={(fn) => {
                    fitRef.current = fn;
                  }}
                  onFocusBBoxRequest={(fn) => {
                    focusBBoxRef.current = fn;
                  }}
                  onPickSample={(s) =>
                    loadSample(s, setPrimary, setBefore, setMode, setAnalysis, setMessages, setActiveDetectionId)
                  }
                  captureRef={captureRef}
                />
                {dragOver ? (
                  <div className="absolute inset-0 grid place-items-center bg-bg/80 text-sm font-medium">
                    Drop imagery here (JPEG · PNG · TIFF · GeoTIFF)
                  </div>
                ) : null}
              </div>
              {measureMeters != null ? (
                <div className="border-t border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  Distance {measureMeters.toFixed(1)} m
                </div>
              ) : null}
            </section>

            {/* ── Right Panel ── */}
            <aside
              className={cn(
                "flex w-full shrink-0 flex-col border-l border-border bg-surface lg:w-[440px]",
                mobileTab === "scene" ? "hidden lg:flex" : "flex",
                !panelOpen && "hidden",
              )}
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {/* ── No image loaded ── */}
                {!primary ? (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-lg font-bold tracking-tight">SatQuery AI</h1>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Agentic vision-language assistant for remote-sensing imagery analysis. Upload a satellite scene and ask natural-language questions.
                      </p>
                    </div>

                    {/* Input mode selector */}
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-subtle">Input Mode</div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "Single Image", desc: "Optical or SAR", action: () => fileRef.current?.click() },
                          { label: "Before + After", desc: "Change detection", action: () => fileRef.current?.click() },
                        ].map((btn) => (
                          <button
                            key={btn.label}
                            onClick={btn.action}
                            className="flex flex-col items-start gap-1 rounded-xl border border-dashed border-border bg-bg px-3 py-3 text-left hover:border-accent hover:bg-secondary"
                          >
                            <Upload className="size-4 text-accent" />
                            <div className="text-xs font-medium">{btn.label}</div>
                            <div className="text-[10px] text-muted-foreground">{btn.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-bg px-4 py-8 text-sm text-muted-foreground hover:border-accent hover:text-fg"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload className="size-5" />
                      Drop imagery here or browse
                      <span className="text-xs">JPEG, PNG, TIFF, GeoTIFF · Single or pair</span>
                    </button>
                    <p className="text-xs text-muted-foreground">
                      Sample scenes are available in the viewer. For change detection, drop two files at once or use the "Add before image" link after loading.
                    </p>

                    {/* Demo mode toggle */}
                    <div className="rounded-xl border border-border bg-bg px-3 py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium">Demo Mode</div>
                        <div className="text-[11px] text-muted-foreground">Show demo/simulated results for judging</div>
                      </div>
                      <button
                        onClick={() => setShowDemoMode((v) => !v)}
                        className={cn(
                          "relative h-5 w-9 rounded-full transition-colors",
                          showDemoMode ? "bg-accent" : "bg-border",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform shadow",
                            showDemoMode ? "left-4" : "left-0.5",
                          )}
                        />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Validation warnings */}
                    {validationIssues.length > 0 && <ValidationBanner issues={validationIssues} />}

                    {/* Conversation */}
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-subtle">Query & Results</div>
                      <div className="mt-2 space-y-3">
                        {messages.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Ask about anything in this scene — water, vegetation, buildings, roads, changes, or land-cover statistics.
                          </p>
                        ) : null}

                        {messages.map((m) => (
                          <div
                            key={m.id}
                            className={cn(
                              "rounded-xl px-3 py-2.5 text-sm leading-relaxed",
                              m.role === "user" ? "bg-secondary" : "border border-border bg-bg",
                            )}
                          >
                            <div>{m.text}</div>

                            {m.role === "assistant" && m.analysis && agentPlan ? (
                              <div className="mt-3 space-y-3 border-t border-border/70 pt-2.5">
                                {/* Agent workflow banner */}
                                <AgentWorkflowBanner plan={agentPlan} />

                                {/* Confidence */}
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-muted-foreground">Confidence</span>
                                  <ConfBadge level={agentPlan.confidence} score={agentPlan.confidenceScore} />
                                </div>
                                <p className="text-[10px] text-subtle">{agentPlan.confidenceNote}</p>

                                {/* Tint header */}
                                <div className="flex flex-wrap items-center justify-between gap-1.5">
                                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-fg">
                                    <span
                                      className="size-3 rounded-sm"
                                      style={{
                                        background:
                                          m.analysis.tint?.colorHex || m.analysis.target?.colorHex || "#38bdf8",
                                      }}
                                    />
                                    {m.analysis.highlightedTarget || "Scene area"}
                                  </span>
                                  {m.analysis.tint ? (
                                    <Badge className="text-[10px]">
                                      {m.analysis.tint.coveragePct.toFixed(1)}% area
                                    </Badge>
                                  ) : null}
                                </div>

                                {/* Highlighted snapshot */}
                                {m.analysis.highlightedSnapshotUrl ? (
                                  <div className="overflow-hidden rounded-lg border border-border bg-surface">
                                    <div className="relative">
                                      <img
                                        src={m.analysis.highlightedSnapshotUrl}
                                        alt={`Tinted ${m.analysis.highlightedTarget ?? "scene"}`}
                                        className="max-h-48 w-full object-cover"
                                      />
                                      <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setAnalysis(m.analysis!);
                                            setActiveDetectionId(null);
                                            setShowSeg(true);
                                            setMobileTab("scene");
                                            fitRef.current();
                                          }}
                                          className="inline-flex items-center gap-1 rounded-md bg-bg/90 px-2 py-1 text-[11px] font-medium text-fg shadow backdrop-blur-sm hover:bg-bg"
                                        >
                                          <Focus className="size-3" />
                                          View on map
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            downloadDataUrl(
                                              m.analysis!.highlightedSnapshotUrl!,
                                              `tinted-${(m.analysis!.highlightedTarget || "scene")
                                                .toLowerCase()
                                                .replace(/[^a-z0-9]+/g, "-")}.jpg`,
                                            )
                                          }
                                          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground shadow hover:opacity-90"
                                        >
                                          <Download className="size-3" />
                                          Get image
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {/* Extracted region cards */}
                                {m.analysis.extractedItems && m.analysis.extractedItems.length > 0 ? (
                                  <div>
                                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                                      <span>Evidence regions (click to focus)</span>
                                      <span>Top {Math.min(4, m.analysis.extractedItems.length)}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      {m.analysis.extractedItems.slice(0, 4).map((item) => {
                                        const isSelected = activeDetectionId === item.id;
                                        return (
                                          <div
                                            key={item.id}
                                            className={cn(
                                              "group flex flex-col overflow-hidden rounded-lg border bg-surface text-left transition-colors",
                                              isSelected
                                                ? "border-accent ring-1 ring-accent"
                                                : "border-border hover:border-accent/60",
                                            )}
                                          >
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setAnalysis(m.analysis!);
                                                handleFocusItem(item);
                                              }}
                                              className="relative aspect-16/10 w-full overflow-hidden bg-sidebar text-left"
                                            >
                                              <img
                                                src={item.cropDataUrl}
                                                alt={item.label}
                                                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                              />
                                              <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-0.5 rounded bg-bg/85 px-1.5 py-0.5 text-[10px] text-accent">
                                                <Crosshair className="size-2.5" />
                                                Focus
                                              </span>
                                            </button>
                                            <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                                              <div className="min-w-0">
                                                <div className="truncate text-[11px] font-medium text-fg">{item.label}</div>
                                                <div className="truncate font-mono text-[10px] text-muted-foreground">
                                                  {item.areaText}
                                                </div>
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  downloadDataUrl(
                                                    item.cropDataUrl,
                                                    `${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
                                                  )
                                                }
                                                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-fg"
                                                title="Download region"
                                                aria-label={`Download ${item.label}`}
                                              >
                                                <Download className="size-3.5" />
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}

                                {/* Evidence + Trace panels */}
                                <EvidencePanel
                                  plan={agentPlan}
                                  onViewEvidence={() => {
                                    setAnalysis(m.analysis!);
                                    setShowSeg(true);
                                    setMobileTab("scene");
                                    fitRef.current();
                                  }}
                                />
                                <ExecutionTrace plan={agentPlan} />
                              </div>
                            ) : null}
                          </div>
                        ))}

                        {busy ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <LoaderCircle className="size-4 animate-spin" />
                              Agentic analysis in progress…
                            </div>
                            {agentPlan && (
                              <div className="text-[11px] text-muted-foreground">
                                Task: <span className="text-accent">{agentPlan.taskLabel}</span>
                              </div>
                            )}
                          </div>
                        ) : null}
                        <div ref={chatEnd} />
                      </div>
                    </div>

                    {/* Prompt gallery */}
                    <div className="flex flex-wrap gap-1.5">
                      {PROMPT_GALLERY.filter((p) => before || !/change/i.test(p.text))
                        .slice(0, 6)
                        .map((p) => (
                          <button
                            key={p.label}
                            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-fg"
                            onClick={() => void runQuery(p.text)}
                            disabled={busy}
                          >
                            {p.label}
                          </button>
                        ))}
                    </div>

                    {/* Analysis stats panel */}
                    {analysis ? (
                      <>
                        <Separator />
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-xs font-semibold uppercase tracking-wide text-subtle">Land Cover</div>
                            {analysis.tint ? (
                              <Badge>{analysis.tint.coveragePct.toFixed(1)}% tinted</Badge>
                            ) : (
                              <Badge>{analysis.detections.length} areas</Badge>
                            )}
                          </div>
                          <div className="h-40">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                <XAxis dataKey="name" tick={{ fill: "currentColor", fontSize: 10 }} />
                                <YAxis tick={{ fill: "currentColor", fontSize: 10 }} />
                                <RTooltip
                                  contentStyle={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-border)",
                                  }}
                                />
                                <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                                  {chartData.map((e) => (
                                    <Cell key={e.name} fill={e.fill} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                          <ul className="mt-2 space-y-1">
                            {analysis.statistics.slice(0, 8).map((s) => (
                              <li key={s.name} className="flex justify-between gap-3 text-xs">
                                <span className="text-muted-foreground">{s.name}</span>
                                <span className="font-mono tabular-nums">
                                  {s.value}
                                  {s.hint ? <span className="ml-2 text-subtle">{s.hint}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {analysis.change ? (
                            <p className="mt-3 text-xs text-muted-foreground">{analysis.change.summary}</p>
                          ) : null}
                        </div>

                        {/* Export buttons */}
                        <div>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                            Export & Report
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {agentPlan && (
                              <>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() =>
                                    analysis && primary && agentPlan &&
                                    exportFullReport(analysis, primary, agentPlan, messages.find(m => m.role === "user")?.text ?? "", before)
                                  }
                                >
                                  <FileText /> Analysis Report (PDF)
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    analysis && primary && agentPlan &&
                                    exportFullJson(analysis, primary, agentPlan, messages.find(m => m.role === "user")?.text ?? "", before)
                                  }
                                >
                                  <Download /> JSON
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="secondary" onClick={() => analysis && primary && exportCsv(analysis)}>
                              CSV
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => analysis && primary && exportGeoJson(analysis, primary)}
                            >
                              GeoJSON
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const c = captureRef.current;
                                if (c) void exportAnnotatedPng(c);
                              }}
                            >
                              PNG
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : null}

                    {/* Add before image link */}
                    <div>
                      <button
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => beforeFileRef.current?.click()}
                      >
                        {before ? "Change before image" : "Add a before image for change detection"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Query input */}
              <form
                className="border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runQuery(draft);
                }}
              >
                <label className="sr-only" htmlFor="ask">
                  Ask about the satellite image
                </label>
                <textarea
                  id="ask"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void runQuery(draft);
                    }
                  }}
                  placeholder={
                    primary
                      ? "Ask anything — e.g. 'detect buildings', 'describe the scene', 'what changed?'"
                      : "Load a satellite image, then ask a natural-language question"
                  }
                  disabled={!primary || busy}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-subtle">
                    <Badge className="border-accent/40 bg-secondary text-fg">Agent</Badge>
                    VLM + Spectral Analysis · Enter to send
                  </span>
                  <Button type="submit" size="sm" disabled={!primary || busy || !draft.trim()}>
                    <Send /> Analyze
                  </Button>
                </div>
              </form>
            </aside>
          </div>
        )}

        {/* ── Mobile nav ── */}
        {appTab === "workspace" && (
          <nav className="grid grid-cols-2 border-t border-border bg-surface lg:hidden">
            <button
              className={cn("h-12 text-sm", mobileTab === "scene" ? "text-fg" : "text-muted-foreground")}
              onClick={() => setMobileTab("scene")}
            >
              Scene
            </button>
            <button
              className={cn("h-12 text-sm", mobileTab === "ask" ? "text-fg" : "text-muted-foreground")}
              onClick={() => setMobileTab("ask")}
            >
              Analysis
            </button>
          </nav>
        )}

        {/* File inputs */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.tif,.tiff,.geotiff"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={beforeFileRef}
          type="file"
          accept="image/*,.tif,.tiff,.geotiff"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files, true);
            e.target.value = "";
          }}
        />
        {/* SatQuery Conversational AI Assistant */}
        <SatQueryAssistant
          primary={primary}
          before={before}
          analysis={analysis}
          plan={agentPlan}
          viewerMode={mode}
          isProcessing={busy}
          onRunQuery={runQuery}
          onSelectDetection={(id) => {
            setActiveDetectionId(id);
            if (id) setShowDetections(true);
          }}
          onFocusBBox={(bbox) => {
            focusBBoxRef.current(bbox);
          }}
          onSetViewerMode={(m) => setMode(m)}
          onToggleLayer={(l) => {
            if (l === "detections") setShowDetections((v) => !v);
            if (l === "seg") setShowSeg((v) => !v);
            if (l === "change") setShowChange((v) => !v);
          }}
          onExportPdf={() => {
            if (primary && analysis && agentPlan) {
              exportFullReport(analysis, primary, agentPlan, draft || "Analysis", before);
            }
          }}
          onExportGeoJson={() => {
            if (primary && analysis) {
              exportGeoJson(analysis, primary);
            }
          }}
          onShowRegistry={() => setAppTab("registry")}
          messages={messages}
          setMessages={setMessages}
        />

        <Toaster theme={light ? "light" : "dark"} />
      </div>
    </TooltipProvider>
  );
}
