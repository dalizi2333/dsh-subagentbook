import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const stateFor = reason => ({ completed: 'completed', aborted: 'interrupted', 'max-tokens': 'limited', refusal: 'blocked', blocked: 'blocked', error: 'failed' })[reason] ?? 'failed';

// Latest activation only; a delayed terminal edge cannot finish a newer run.
// Independent from immutable composition records and native lifecycle ownership.
export function activityStore(directory) {
  const file = id => { if (!validId(id)) throw new TypeError('Invalid activity id'); return join(directory, `${id}.json`); };
  return {
    read(id) {
      try {
        const value = JSON.parse(readFileSync(file(id), 'utf8'));
        if (value.version !== 1 || value.id !== id || !validId(value.runId) || !['active', 'settled'].includes(value.phase)
          || !Number.isFinite(value.at) || value.phase === 'settled' && typeof value.stopReason !== 'string') throw new Error('Invalid activity record');
        return value;
      } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    record(info, phase) {
      if (!validId(info.id) || !validId(info.runId) || !['active', 'settled'].includes(phase)) throw new TypeError('Invalid activity edge');
      const previous = this.read(info.id);
      if (phase === 'settled' && previous?.runId !== info.runId) return;
      const value = { version: 1, id: info.id, runId: info.runId, phase, at: Date.now(),
        ...(phase === 'settled' ? { stopReason: String(info.stopReason) } : {}) };
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const destination = file(info.id), temporary = `${destination}.${randomUUID()}.tmp`;
      try { writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, destination); }
      finally { rmSync(temporary, { force: true }); }
    },
  };
}

export function activityView({ liveStatus, settlement, events = [], notices = [], id, runtimeStartedAt } = {}) {
  // Running is asserted only by an actual live Agent, never by server liveness.
  if (liveStatus === 'running') return { state: 'running', source: 'live' };
  const start = events.filter(e => e.type === 'turn/start').at(-1);
  if (settlement?.phase === 'settled' && settlement.at >= (start?.time ?? 0)) return { state: stateFor(settlement.stopReason), source: 'lifecycle', reason: settlement.stopReason, at: settlement.at };
  const activeAt = settlement?.phase === 'active' && Number.isFinite(settlement.at) ? settlement.at : 0;
  const latestStartAt = Math.max(start?.time ?? 0, activeAt);
  const end = events.filter(e => e.type === 'turn/end').at(-1);
  if (start && end && end.seq > start.seq && (end.time ?? 0) >= activeAt) return { state: stateFor(end.data.reason?.kind), source: 'turn', reason: end.data.reason?.kind, at: end.time };
  const notice = notices.filter(e => e.data?.source?.kind === 'subagent-settled' && e.data.source.senderSessionId === id && e.time >= latestStartAt).at(-1);
  if (notice) {
    const summary = notice.data.source.summary ?? '';
    // Host-authored notice vocabulary, not arbitrary assistant/user text.
    const state = summary.includes('failed before it finished') ? 'failed' : summary.includes('finished and will do no further work') ? 'completed' : 'unknown';
    return { state, source: 'parent-notice', ...(state === 'failed' ? { reason: 'error' } : {}), at: notice.time };
  }
  // Only a previous runtime's unfinished activation is recovery evidence.
  // Absence of turn/end alone says nothing about the cause or live execution.
  const unfinishedAt = latestStartAt || undefined;
  if (Number.isFinite(runtimeStartedAt) && Number.isFinite(unfinishedAt) && unfinishedAt < runtimeStartedAt) {
    return { state: 'interrupted', source: 'recovery', reason: 'previous-runtime-unsettled', at: unfinishedAt };
  }
  return { state: liveStatus === 'idle' ? 'idle' : 'unknown', source: 'observation' };
}
