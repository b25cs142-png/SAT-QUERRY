import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Focus,
  HelpCircle,
  Info,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Move,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn, uid } from "@/lib/utils";
import type {
  AnalysisResult,
  BBox,
  ChatAction,
  ChatMessage,
  LandClass,
  RasterSlot,
  ViewerMode,
} from "@/lib/types";
import type { AgentPlan } from "@/lib/agent-router";
import {
  type AssistantContext,
  buildConciseTraceSteps,
  buildResponseActions,
  generateSuggestedFollowUps,
  handleMetaQuery,
} from "@/lib/assistant-engine";

interface SatQueryAssistantProps {
  primary?: RasterSlot;
  before?: RasterSlot;
  analysis?: AnalysisResult | null;
  plan?: AgentPlan | null;
  viewerMode: ViewerMode;
  isProcessing: boolean;
  onRunQuery: (query: string) => Promise<void>;
  onSelectDetection?: (id: string | null) => void;
  onFocusBBox?: (bbox: BBox) => void;
  onSetViewerMode?: (mode: ViewerMode) => void;
  onToggleLayer?: (layer: "detections" | "seg" | "change") => void;
  onExportPdf?: () => void;
  onExportGeoJson?: () => void;
  onShowRegistry?: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

export function SatQueryAssistant({
  primary,
  before,
  analysis,
  plan,
  viewerMode,
  isProcessing,
  onRunQuery,
  onSelectDetection,
  onFocusBBox,
  onSetViewerMode,
  onToggleLayer,
  onExportPdf,
  onExportGeoJson,
  onShowRegistry,
  messages,
  setMessages,
}: SatQueryAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [showTraceForMsg, setShowTraceForMsg] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isSar = primary?.name.toLowerCase().includes("sar") ?? false;
  const isOpticalSarPair = Boolean(primary && before && (isSar || before.name.toLowerCase().includes("sar")));
  const isBiTemporal = Boolean(primary && before && !isOpticalSarPair);

  const assistantCtx: AssistantContext = useMemo(
    () => ({
      primary,
      before,
      analysis,
      plan,
      viewerMode,
      isSar,
      isOpticalSarPair,
      isBiTemporal,
    }),
    [primary, before, analysis, plan, viewerMode, isSar, isOpticalSarPair, isBiTemporal],
  );

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isProcessing]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Initial welcome message if empty
  useEffect(() => {
    if (messages.length === 0) {
      const welcome: ChatMessage = {
        id: "welcome-msg",
        role: "assistant",
        text: `Hello! I'm **SatQuery Assistant** 🤖🛰️, your agentic vision-language copilot for Earth observation.\n\nI understand satellite sensor modalities (Optical & SAR), multi-temporal changes, and spatial grounding. Ask me anything about the active scene, request object localizations, or examine land cover changes.`,
        confidenceScore: 100,
        confidenceLevel: "high",
        modelLabel: "Agentic VLM Copilot",
        isSimulated: false,
        suggestedQuestions: generateSuggestedFollowUps(assistantCtx),
        actions: [
          { id: "act-desc", label: "Describe Active Scene", action: "highlight" },
          { id: "act-why", label: "Model Architecture", action: "why" },
        ],
        createdAt: Date.now(),
      };
      setMessages([welcome]);
    }
  }, [assistantCtx, messages.length, setMessages]);

  const handleSend = async (overrideText?: string) => {
    const textToSend = (overrideText ?? inputVal).trim();
    if (!textToSend || isProcessing) return;

    setInputVal("");

    const userMsg: ChatMessage = {
      id: uid("usr"),
      role: "user",
      text: textToSend,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);

    // Check if it's a meta query (architecture, why, sar explanation)
    const metaResponse = handleMetaQuery(textToSend, assistantCtx);
    if (metaResponse) {
      const botMsg: ChatMessage = {
        id: uid("ast"),
        role: "assistant",
        text: metaResponse.answer,
        evidenceSummary: metaResponse.evidenceSummary,
        whyExplain: metaResponse.whyExplain,
        confidenceScore: metaResponse.confidenceScore,
        confidenceLevel: metaResponse.confidenceLevel,
        modelLabel: metaResponse.modelLabel,
        isSimulated: metaResponse.isSimulated,
        suggestedQuestions: metaResponse.suggestedQuestions,
        actions: metaResponse.actions,
        traceSteps: metaResponse.traceSteps,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, botMsg]);
      return;
    }

    // Otherwise run through main query pipeline
    await onRunQuery(textToSend);
  };

  const handleActionClick = (action: ChatAction, msg: ChatMessage) => {
    switch (action.action) {
      case "highlight": {
        onToggleLayer?.("detections");
        if (msg.analysis?.detections && msg.analysis.detections.length > 0) {
          onSelectDetection?.(msg.analysis.detections[0].id);
        }
        break;
      }
      case "zoom-detection": {
        const topBbox = msg.analysis?.detections?.[0]?.bbox || analysis?.detections?.[0]?.bbox;
        if (topBbox && onFocusBBox) {
          onFocusBBox(topBbox);
        }
        break;
      }
      case "change-map": {
        onSetViewerMode?.("diff");
        onToggleLayer?.("change");
        break;
      }
      case "switch-view": {
        const targetMode = action.payload || (viewerMode === "split" ? "primary" : "split");
        onSetViewerMode?.(targetMode);
        break;
      }
      case "why": {
        onShowRegistry?.();
        break;
      }
      case "export-pdf": {
        onExportPdf?.();
        break;
      }
      case "export-geojson": {
        onExportGeoJson?.();
        break;
      }
      default:
        break;
    }
  };

  const currentSuggestions = useMemo(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.suggestedQuestions && lastMsg.suggestedQuestions.length > 0) {
      return lastMsg.suggestedQuestions;
    }
    return generateSuggestedFollowUps(assistantCtx);
  }, [messages, assistantCtx]);

  return (
    <>
      {/* Floating Trigger Button */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-40 flex items-center gap-3">
          <button
            onClick={() => setIsOpen(true)}
            className="group flex items-center gap-2.5 rounded-full border border-accent/40 bg-surface/90 px-4 py-3 text-sm font-medium text-fg shadow-2xl backdrop-blur-md transition-all duration-300 hover:border-accent hover:bg-surface hover:shadow-accent/20 hover:scale-105 active:scale-95"
            aria-label="Open SatQuery Assistant"
          >
            <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-accent group-hover:bg-accent group-hover:text-bg transition-colors">
              <Bot className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            </div>
            <span className="font-semibold text-xs tracking-wide">SatQuery Assistant</span>
            <Badge className="border-accent/30 bg-accent/10 text-[10px] text-accent px-1.5 py-0 h-4">
              AI Copilot
            </Badge>
          </button>
        </div>
      )}

      {/* Main Chat Drawer / Panel */}
      {isOpen && (
        <div
          className={cn(
            "fixed z-50 flex flex-col rounded-2xl border border-border bg-surface/95 text-fg shadow-2xl backdrop-blur-xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-6",
            isExpanded
              ? "inset-4 md:inset-8 w-auto h-auto max-w-none"
              : "bottom-4 right-4 w-[92vw] sm:w-[460px] h-[640px] max-h-[85vh]",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/80 px-4 py-3 bg-surface-2/60 rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent shadow-inner">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-fg">SatQuery Assistant</h3>
                  <Badge className="border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-400 font-mono px-1.5 py-0 h-4">
                    Active
                  </Badge>
                </div>
                <p className="text-[10px] text-muted truncate max-w-[220px]">
                  {primary ? `${primary.name} · GSD ${primary.gsdMeters}m` : "Ready for satellite image analysis"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip content="Clear Conversation">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted hover:text-fg"
                    onClick={() => {
                      setMessages([]);
                    }}
                    title="Clear Conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              </TooltipProvider>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted hover:text-fg"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted hover:text-fg"
                onClick={() => setIsOpen(false)}
                title="Close Assistant"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Context Banner */}
          <div className="flex items-center justify-between px-4 py-1.5 bg-surface/80 border-b border-border/40 text-[11px] text-muted font-mono">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span>
                Mode:{" "}
                <strong className="text-fg font-medium">
                  {isBiTemporal ? "Before/After Pair" : isOpticalSarPair ? "Optical+SAR Fusion" : isSar ? "SAR" : "Optical"}
                </strong>
              </span>
            </div>
            {analysis?.detections && analysis.detections.length > 0 && (
              <span className="text-accent text-[10px]">
                {analysis.detections.length} objects grounded
              </span>
            )}
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm font-sans scrollbar-thin scrollbar-thumb-border">
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const showTrace = showTraceForMsg[msg.id] ?? false;

              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex flex-col gap-1.5 animate-in fade-in duration-200",
                    isUser ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-xs leading-relaxed max-w-[88%] shadow-sm",
                      isUser
                        ? "bg-accent text-bg font-medium rounded-tr-none"
                        : "bg-surface-2/90 border border-border/80 text-fg rounded-tl-none",
                    )}
                  >
                    {/* Header badge for assistant */}
                    {!isUser && (
                      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-border/40">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="h-3 w-3 text-accent" />
                          <span className="text-[10px] font-mono font-medium text-accent">
                            {msg.modelLabel || "SatQuery VLM"}
                          </span>
                        </div>
                        {msg.confidenceScore !== undefined && (
                          <span
                            className={cn(
                              "text-[9px] font-mono px-1.5 py-0.5 rounded",
                              msg.confidenceScore >= 85
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                                : "bg-amber-500/10 text-amber-400 border border-amber-500/30",
                            )}
                          >
                            {msg.confidenceScore}% Confidence
                          </span>
                        )}
                      </div>
                    )}

                    {/* Execution status trace preview if available */}
                    {!isUser && msg.traceSteps && msg.traceSteps.length > 0 && (
                      <div className="mb-2.5 rounded-lg bg-surface/70 border border-border/60 p-2 text-[10px] font-mono">
                        <button
                          onClick={() =>
                            setShowTraceForMsg((prev) => ({ ...prev, [msg.id]: !showTrace }))
                          }
                          className="flex items-center justify-between w-full text-muted hover:text-fg text-left"
                        >
                          <span className="flex items-center gap-1 font-semibold text-[10px] text-accent">
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            Execution Status ({msg.traceSteps.length} steps)
                          </span>
                          {showTrace ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>

                        {showTrace && (
                          <div className="mt-2 space-y-1 pl-1 border-t border-border/40 pt-1.5">
                            {msg.traceSteps.map((step, idx) => (
                              <div key={idx} className="flex items-start gap-1.5 text-muted-foreground">
                                <span className="text-emerald-400 font-bold">✓</span>
                                <div>
                                  <span className="text-fg font-medium">{step.label}</span>
                                  {step.detail && <span className="text-muted ml-1">· {step.detail}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Main text content */}
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>

                    {/* Evidence summary if provided */}
                    {!isUser && msg.evidenceSummary && (
                      <div className="mt-2 rounded bg-surface/50 border-l-2 border-accent p-2 text-[10px] text-muted font-mono">
                        <strong className="text-fg font-semibold">Evidence: </strong>
                        {msg.evidenceSummary}
                      </div>
                    )}

                    {/* Model notice if simulated */}
                    {!isUser && msg.isSimulated && (
                      <div className="mt-1.5 text-[9px] text-muted-foreground/80 italic">
                        * Grounded via local spectral analysis & remote sensing benchmark rules
                      </div>
                    )}
                  </div>

                  {/* Contextual Action Buttons */}
                  {!isUser && msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1 max-w-[90%]">
                      {msg.actions.map((act) => (
                        <button
                          key={act.id}
                          onClick={() => handleActionClick(act, msg)}
                          className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-surface-2/80 px-2.5 py-1 text-[10px] font-medium text-fg hover:border-accent hover:bg-accent/10 active:scale-95 transition-all shadow-sm"
                        >
                          {act.action === "highlight" && <Crosshair className="h-2.5 w-2.5 text-accent" />}
                          {act.action === "zoom-detection" && <Focus className="h-2.5 w-2.5 text-emerald-400" />}
                          {act.action === "change-map" && <Activity className="h-2.5 w-2.5 text-amber-400" />}
                          {act.action === "switch-view" && <Layers className="h-2.5 w-2.5 text-blue-400" />}
                          {act.action === "why" && <Info className="h-2.5 w-2.5 text-indigo-400" />}
                          {act.action === "export-pdf" && <Download className="h-2.5 w-2.5 text-accent" />}
                          {act.action === "show-crops" && <Eye className="h-2.5 w-2.5 text-teal-400" />}
                          <span>{act.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <span className="text-[9px] text-muted px-1 font-mono">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}

            {/* Processing loading step indicator */}
            {isProcessing && (
              <div className="flex flex-col items-start gap-1.5 animate-in fade-in">
                <div className="rounded-2xl rounded-tl-none border border-accent/40 bg-surface-2 px-4 py-3 text-xs text-fg shadow-md">
                  <div className="flex items-center gap-2 text-accent font-semibold mb-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    <span>SatQuery Reasoning in Progress...</span>
                  </div>
                  <div className="space-y-1.5 text-[10px] font-mono text-muted pl-1">
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <span>✓</span>
                      <span>Query understood & intent routed</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-accent">
                      <span className="animate-pulse">⟳</span>
                      <span>Running specialist remote sensing model...</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground/60">
                      <span>○</span>
                      <span>Extracting bounding box evidence & confidence</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Dynamic Suggested Follow-ups */}
          {currentSuggestions.length > 0 && !isProcessing && (
            <div className="border-t border-border/50 bg-surface-2/40 px-3 py-2">
              <div className="flex items-center gap-1 mb-1.5 text-[10px] font-mono text-muted">
                <Sparkles className="h-2.5 w-2.5 text-accent" />
                <span>Suggested Questions:</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {currentSuggestions.map((sug, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(sug)}
                    className="rounded-full border border-border/80 bg-surface/80 px-2.5 py-1 text-[10px] text-fg/90 hover:border-accent/60 hover:bg-surface hover:text-fg transition-all text-left truncate max-w-full"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Footer */}
          <div className="border-t border-border p-3 bg-surface-2/60 rounded-b-2xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                ref={inputRef}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  primary
                    ? `Ask anything about ${primary.name}... (e.g. "Find water bodies", "What changed?")`
                    : "Ask about satellite imagery or load a sample scene..."
                }
                rows={1}
                className="flex-1 resize-none rounded-xl border border-input bg-surface px-3 py-2 text-xs text-fg placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent max-h-24 min-h-[38px]"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!inputVal.trim() || isProcessing}
                className="h-[38px] px-3.5 rounded-xl bg-accent text-bg hover:bg-accent/90 disabled:opacity-40"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
