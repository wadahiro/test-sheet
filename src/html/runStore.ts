// Which test runs exist for this sheet, and where their results live.
// A run is a named container for one sheet's per-case results. The list of runs and the one last
// used are shared by every tab of the browser (localStorage), so a run chosen anywhere is the run
// recorded into everywhere; each case's marks are stored under the run's own prefix.

import { removeImagesWithPrefix, retagLegacyImages } from "./runImages";

export interface RunMeta {
  id: string;
  name: string;
  /** Created, ISO */
  c: string;
  /** Last recorded into, ISO */
  u: string;
}

export interface RunIndex {
  v: 1;
  /** The run recording goes into; null before any run exists */
  last: string | null;
  runs: RunMeta[];
}

/**
 * Over file:// every local HTML file shares one storage origin, so two sheets with the same case
 * ids would overwrite each other's results; the path keeps them apart.
 */
export function runNamespace(): string {
  let hash = 5381;
  for (const ch of location.pathname) hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

export function runIndexKey(): string {
  return `test-sheet-runs:${runNamespace()}`;
}

/** Ids are base36, so they never contain the ":" that separates key parts */
export function newRunId(): string {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 8);
  } catch {
    return Date.now().toString(36);
  }
}

/** Prefix of every key holding one run's per-case results */
export function runKeyPrefix(runId: string): string {
  return `test-sheet-run:${runNamespace()}:${runId}:`;
}

export function caseRunKey(runId: string, tcId: string): string {
  return `${runKeyPrefix(runId)}${tcId}`;
}

/** The images' key prefix for a run, to match IndexedDB records by */
export function runImagePrefix(runId: string): string {
  return `${runNamespace()}:${runId}:`;
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIndex(raw: string | null): RunIndex | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RunIndex;
    return parsed.v === 1 && Array.isArray(parsed.runs) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRunIndex(index: RunIndex) {
  try {
    localStorage.setItem(runIndexKey(), JSON.stringify(index));
  } catch {
    // Blocked storage (e.g. over file://): the runs last for this visit only
  }
}

/**
 * Before runs existed there was one set of results per case, under `test-sheet-run:<ns>:<case>`.
 * Fold them into a first run, once: the index key not existing yet is what says it has not been done.
 * A tab of the older build left open could still write the old form afterwards; that is ignored.
 */
function migrateSingleRun(): RunIndex {
  const index: RunIndex = { v: 1, last: null, runs: [] };
  try {
    const oldPrefix = `test-sheet-run:${runNamespace()}:`;
    const oldKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(oldPrefix)) oldKeys.push(key);
    }
    if (oldKeys.length > 0) {
      const id = newRunId();
      const now = new Date().toISOString();
      index.runs.push({ id, name: "Run 1", c: now, u: now });
      index.last = id;
      writeRunIndex(index);
      for (const key of oldKeys) {
        const value = localStorage.getItem(key);
        if (value !== null) localStorage.setItem(caseRunKey(id, key.slice(oldPrefix.length)), value);
        localStorage.removeItem(key);
      }
      void retagLegacyImages(runNamespace(), id);
    } else {
      writeRunIndex(index);
    }
  } catch {
    // Blocked storage: no runs to carry over
  }
  return index;
}

/**
 * Recording used to be a separate on/off flag beside the chosen run. Now having a run chosen is
 * recording, so a flag left off becomes "no run chosen", and both old keys are dropped.
 */
function foldLegacyRunModeFlag(index: RunIndex): RunIndex {
  try {
    const flag = localStorage.getItem("test-sheet-run-mode") ?? localStorage.getItem("test-sheet-checklist-mode");
    if (flag === null) return index;
    localStorage.removeItem("test-sheet-run-mode");
    localStorage.removeItem("test-sheet-checklist-mode");
    if (flag !== "0" || index.last === null) return index;
    const stopped = { ...index, last: null };
    writeRunIndex(stopped);
    return stopped;
  } catch {
    return index;
  }
}

export function readRunIndex(): RunIndex {
  try {
    return foldLegacyRunModeFlag(parseIndex(localStorage.getItem(runIndexKey())) ?? migrateSingleRun());
  } catch {
    return { v: 1, last: null, runs: [] };
  }
}

/** Without migrating: for reacting to another tab's change, which has already done it */
export function rereadRunIndex(): RunIndex {
  try {
    return parseIndex(localStorage.getItem(runIndexKey())) ?? { v: 1, last: null, runs: [] };
  } catch {
    return { v: 1, last: null, runs: [] };
  }
}

export function withNewRun(index: RunIndex, name: string): RunIndex {
  const now = new Date().toISOString();
  const run: RunMeta = { id: newRunId(), name: name.trim() || todayStamp(), c: now, u: now };
  return { ...index, last: run.id, runs: [...index.runs, run] };
}

export function withRenamedRun(index: RunIndex, id: string, name: string): RunIndex {
  const trimmed = name.trim();
  if (trimmed === "") return index;
  return { ...index, runs: index.runs.map((run) => (run.id === id ? { ...run, name: trimmed } : run)) };
}

/** Deleting the run in use stops recording; it does not move to another run the tester did not choose */
export function withoutRun(index: RunIndex, id: string): RunIndex {
  return { ...index, last: index.last === id ? null : index.last, runs: index.runs.filter((run) => run.id !== id) };
}

/** Stamps the run as just recorded into, so the list can say when it was last used */
export function touchRun(runId: string) {
  try {
    const index = parseIndex(localStorage.getItem(runIndexKey()));
    if (!index) return;
    const now = new Date().toISOString();
    writeRunIndex({ ...index, runs: index.runs.map((run) => (run.id === runId ? { ...run, u: now } : run)) });
  } catch {
    // Not worth failing a mark over
  }
}

/** How many cases have results in each run, from one walk over the stored keys */
export function countCasesPerRun(): Record<string, number> {
  const counts: Record<string, number> = {};
  try {
    const prefix = `test-sheet-run:${runNamespace()}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const runId = key.slice(prefix.length).split(":")[0];
      counts[runId] = (counts[runId] ?? 0) + 1;
    }
  } catch {
    // Blocked storage: no counts
  }
  return counts;
}

/** Removes a run's results and screenshots; the caller updates the index */
export async function deleteRunData(runId: string): Promise<void> {
  try {
    const prefix = runKeyPrefix(runId);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // Blocked storage: nothing was stored
  }
  await removeImagesWithPrefix(runImagePrefix(runId));
}
