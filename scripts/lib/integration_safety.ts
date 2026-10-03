import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export const LIMITS = { databases: 4, pages: 6, blocks: 9, requests: 120, cleanupRequests: 30, intervalMs: 1000, maxRuns: 5 } as const;
type Resource = { id: string; trashed: boolean };
export interface RunState {
  id: string; parent: string; startedAt: string; status: 'running' | 'cleanup' | 'complete';
  resources: { databases: Resource[]; pages: Resource[]; blocks: string[]; sources: string[] };
  counts: { databases: number; pages: number; blocks: number; requests: number; cleanupRequests: number };
  lastRequestAt: number; stopped: boolean; retryAfter: number;
  pending: { sequence: number; method: string; endpoint: string }[];
}
const normalized = (id: string) => id.replace(/-/g, '').toLowerCase();
const same = (left: string, right: string) => normalized(left) === normalized(right);
export const validId = (id: string) => /^[0-9a-f]{32}$/i.test(normalized(id));
export const readState = (file: string): RunState => JSON.parse(readFileSync(file, 'utf8'));
function durable(file: string, value: string, append = false): void {
  const fd = openSync(file, append ? 'a' : 'w', 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
}
function save(file: string, state: RunState): void {
  const temporary = file + '.tmp'; durable(temporary, JSON.stringify(state, null, 2) + '\n'); renameSync(temporary, file);
  const fd = openSync(path.dirname(file), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function record(file: string, event: string, detail: Record<string, unknown> = {}): void {
  const state = readState(file);
  durable(file.replace(/\.json$/, '.jsonl'), JSON.stringify({ time: new Date().toISOString(), runId: state.id, event, ...detail }) + '\n', true);
}
export function acquireLock(dir: string, recover = false): () => void {
  mkdirSync(dir, { recursive: true, mode: 0o700 }); const lock = path.join(dir, 'lock.json');
  if (recover && existsSync(lock)) {
    const owner = JSON.parse(readFileSync(lock, 'utf8')) as { pid: number };
    try { process.kill(owner.pid, 0); throw new Error('Run is locked by a live process.'); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error; }
    unlinkSync(lock);
  }
  let fd: number;
  try { fd = openSync(lock, 'wx', 0o600); } catch { throw new Error('Run is locked. For a crashed process use cleanup --recover-lock.'); }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); fsyncSync(fd); } finally { closeSync(fd); }
  return () => unlinkSync(lock);
}
export function createRun(dir: string, parent: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!validId(parent)) throw new Error('Test parent must be a page UUID.');
  const previous = readdirSync(dir).filter(name => name !== 'lock.json' && name.endsWith('.json')).map(name => readState(path.join(dir, name)));
  if (previous.some(state => state.status !== 'complete')) throw new Error('An unfinished run exists. Complete cleanup before creating resources.');
  if (previous.length >= LIMITS.maxRuns) throw new Error('Lifetime run limit reached. Review retained resources before further testing.');
  const now = Date.now();
  if (previous.some(state => now - Date.parse(state.startedAt) < 86400000)) throw new Error('Only one resource-creating run is allowed per 24 hours.');
  const id = randomUUID(); const file = path.join(dir, id + '.json');
  save(file, { id, parent, startedAt: new Date(now).toISOString(), status: 'running',
    resources: { databases: [], pages: [], blocks: [], sources: [] }, counts: { databases: 0, pages: 0, blocks: 0, requests: 0, cleanupRequests: 0 },
    lastRequestAt: 0, stopped: false, retryAfter: 0, pending: [] });
  record(file, 'run_started', { parent, limits: LIMITS }); return file;
}
export function completeRun(file: string): void {
  const state = readState(file);
  if (state.resources.databases.some(item => !item.trashed) || state.pending.length) throw new Error('Cleanup incomplete or request outcome unknown. Inspect the audit log.');
  state.status = 'complete'; save(file, state); record(file, 'run_complete', { counts: state.counts });
}
function countBlocks(children: unknown): number {
  if (!Array.isArray(children)) return 0;
  return children.reduce((sum: number, block: Record<string, unknown>) => sum + 1 + Object.values(block).reduce((n: number, value) => n + (value && typeof value === 'object' && 'children' in value ? countBlocks(value.children) : 0), 0), 0);
}
/** One serial transport is shared through its durable state by the verifier and CLI children. */
export class IntegrationTransport {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly file: string, private nativeFetch: typeof globalThis.fetch = globalThis.fetch,
    private clock: { now: () => number; sleep: (ms: number) => Promise<unknown> } = { now: Date.now, sleep }) {}
  cleanup(): void { const state = readState(this.file); state.status = 'cleanup'; save(this.file, state); record(this.file, 'cleanup_started'); }
  fetch: typeof globalThis.fetch = (input, init) => {
    const task = this.queue.then(() => this.request(input, init)); this.queue = task.catch(() => undefined); return task;
  };
  private async request(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const state = readState(this.file); const endpoint = url.pathname; const id = decodeURIComponent(endpoint.split('/')[3] || '');
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : {};
    const cleanup = state.status === 'cleanup';
    const owns = (type: 'databases' | 'pages', value: string) => state.resources[type].some(item => same(item.id, value));
    const source = (value: string) => state.resources.sources.some(item => same(item, value));
    const block = (value: string) => owns('pages', value) || state.resources.blocks.some(item => same(item, value));
    let creation: 'databases' | 'pages' | 'blocks' | undefined; let amount = 1;
    try {
      if (state.status === 'complete') throw new Error('Run is already complete.');
      if (url.origin !== 'https://api.notion.com' || url.username || url.password) throw new Error('Only the Notion API host is allowed.');
      if (state.stopped && !cleanup) throw new Error('API stopped after a failed request.');
      if (state.retryAfter > this.clock.now()) throw new Error('Retry-After has not elapsed.');
      if (cleanup && method !== 'GET' && !(method === 'PATCH' && Object.keys(body).length === 1 && body.in_trash === true)) throw new Error('Only trash operations are allowed during cleanup.');
      if (method === 'POST' && endpoint === '/v1/databases') {
        if (!same(body.parent?.page_id || '', state.parent)) throw new Error('Database parent is not the dedicated test parent.');
        creation = 'databases';
      } else if (method === 'POST' && endpoint === '/v1/pages') {
        if (body.template || countBlocks(body.children)) throw new Error('Page templates and inline blocks are not permitted in this test.');
        if (!source(body.parent?.data_source_id || '')) throw new Error('Page parent is not an owned test data source.'); creation = 'pages';
      } else if (method === 'PATCH' && /^\/v1\/blocks\/[^/]+\/children$/.test(endpoint) && block(id)) {
        creation = 'blocks'; amount = countBlocks(body.children);
      } else if (method === 'PATCH' && /^\/v1\/(databases|pages)\/[^/]+$/.test(endpoint) && body.in_trash === true && Object.keys(body).length === 1 && owns(endpoint.split('/')[2] as 'databases' | 'pages', id)) {
        // Only resources recorded as created by this run may be moved to trash.
      } else if (!(method === 'GET' && (endpoint === '/v1/users' || /^\/v1\/databases\/[^/]+$/.test(endpoint) && owns('databases', id) || /^\/v1\/data_sources\/[^/]+$/.test(endpoint) && source(id) || /^\/v1\/pages\/[^/]+$/.test(endpoint) && (owns('pages', id) || same(id, state.parent)) || /^\/v1\/blocks\/[^/]+\/children$/.test(endpoint) && block(id)) || method === 'POST' && /^\/v1\/data_sources\/[^/]+\/query$/.test(endpoint) && source(id))) throw new Error('Endpoint or resource is not owned by this test run.');
      if (creation && state.counts[creation] + amount > LIMITS[creation]) throw new Error(({ databases: 'Database', pages: 'Page', blocks: 'Block' })[creation] + ' creation limit exceeded.');
      if (cleanup ? state.counts.cleanupRequests >= LIMITS.cleanupRequests : state.counts.requests >= LIMITS.requests) throw new Error('Request limit exceeded.');
    } catch (error) {
      record(this.file, 'request_blocked', { method, endpoint, reason: error instanceof Error ? error.message : 'Blocked' }); throw error;
    }
    await this.clock.sleep(Math.max(0, state.lastRequestAt + LIMITS.intervalMs - this.clock.now()));
    state.lastRequestAt = this.clock.now(); if (creation) state.counts[creation] += amount;
    if (cleanup) state.counts.cleanupRequests++; else state.counts.requests++;
    const sequence = state.counts.requests + state.counts.cleanupRequests;
    state.pending.push({ sequence, method, endpoint }); save(this.file, state);
    record(this.file, 'request_started', { sequence, method, endpoint, creation, amount: creation ? amount : undefined });
    try {
      const response = await this.nativeFetch(input, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
      const payload = await response.clone().json() as Record<string, any>;
      let resourceIds: string[] = [];
      if (response.ok) {
        if (creation === 'databases' || creation === 'pages') {
          if (typeof payload.id !== 'string') throw new Error('Missing created resource ID.');
          state.resources[creation].push({ id: payload.id, trashed: false }); resourceIds = [payload.id];
        }
        if (creation === 'blocks') {
          const collect = (blocks: Record<string, any>[]) => { for (const item of blocks) { if (typeof item.id !== 'string') throw new Error('Missing block ID.'); resourceIds.push(item.id); for (const value of Object.values(item)) if (value && typeof value === 'object' && 'children' in value && Array.isArray(value.children)) collect(value.children); } };
          collect(payload.results || []); state.resources.blocks.push(...resourceIds);
        }
        if (Array.isArray(payload.data_sources)) state.resources.sources.push(...payload.data_sources.map((item: { id: string }) => item.id).filter((value: string) => !state.resources.sources.includes(value)));
        if (method === 'GET' && /^\/v1\/blocks\/[^/]+\/children$/.test(endpoint)) {
          state.resources.blocks.push(...(payload.results || []).map((item: { id: string }) => item.id).filter((value: string) => !state.resources.blocks.includes(value)));
        }
        if (method === 'PATCH' && body.in_trash) {
          const resource = state.resources[endpoint.split('/')[2] as 'databases' | 'pages'].find(item => same(item.id, id)); if (resource) resource.trashed = true;
        }
      } else {
        state.stopped = true;
        if (response.status === 429 || response.status === 529) state.retryAfter = this.clock.now() + Math.max(60, Number(response.headers.get('Retry-After')) || 60) * 1000;
      }
      // 5xx writes may have committed even if the response reports an error.
      if (response.ok || response.status < 500 || !creation) state.pending = state.pending.filter(item => item.sequence !== sequence);
      save(this.file, state); record(this.file, 'request_finished', { sequence, method, endpoint, status: response.status, resourceIds, code: typeof payload.code === 'string' ? payload.code : undefined, retryAfter: state.retryAfter || undefined });
      return response;
    } catch {
      state.stopped = true; save(this.file, state); record(this.file, 'request_unknown', { sequence, method, endpoint });
      throw new Error('Integration request failed; outcome unknown. See the audit log.');
    }
  }
}

/** Kill the CLI process group before cleanup, including Yarn's Node children. */
export async function runCli(file: string, command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number }): Promise<void> {
  record(file, 'cli_started', { command: args[0] });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: options.env, detached: true, stdio: 'ignore' });
    let interrupted = false;
    const stop = () => { interrupted = true; if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
    const timer = setTimeout(stop, options.timeout);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const finish = () => { clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
    child.once('error', () => { finish(); record(file, 'cli_failed', { command: args[0], reason: 'spawn' }); reject(new Error('CLI start failed.')); });
    child.once('close', code => {
      finish(); record(file, code === 0 && !interrupted ? 'cli_succeeded' : 'cli_failed', { command: args[0], exitCode: code, interrupted });
      if (code === 0 && !interrupted) resolve(); else reject(new Error('CLI verification failed.'));
    });
  });
}
