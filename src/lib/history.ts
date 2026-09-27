/**
 * SatQuery AI — Analysis History
 * Persists analysis sessions to localStorage for retrieval
 * GEO-MINDS Team
 */

import type { AnalysisResult, RasterSlot } from "./types";
import type { AgentPlan } from "./agent-router";

const STORAGE_KEY = "satquery-history-v1";
const MAX_ENTRIES = 50;

export interface HistoryEntry {
  id: string;
  createdAt: number;
  query: string;
  imageName: string;
  beforeName?: string;
  inputMode: string;
  taskLabel: string;
  confidence: number;
  answer: string;
  intent: string;
  snapshotUrl?: string;
  changePercent?: number;
}

function readAll(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage full — silently fail
  }
}

export function saveHistoryEntry(
  query: string,
  primary: RasterSlot,
  analysis: AnalysisResult,
  plan: AgentPlan,
  before?: RasterSlot,
) {
  const entry: HistoryEntry = {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    query,
    imageName: primary.name,
    beforeName: before?.name,
    inputMode: plan.inputMode,
    taskLabel: plan.taskLabel,
    confidence: plan.confidenceScore,
    answer: analysis.answer.slice(0, 400),
    intent: analysis.intent,
    snapshotUrl: analysis.highlightedSnapshotUrl,
    changePercent: analysis.change?.percent,
  };

  const existing = readAll();
  writeAll([entry, ...existing]);
}

export function loadHistory(): HistoryEntry[] {
  return readAll();
}

export function clearHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
