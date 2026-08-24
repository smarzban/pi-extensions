import { createHash } from "node:crypto";
import { open, readdir, readFile, rename, stat, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total"];
const CODEX_KEYS = ["input_tokens", "output_tokens", "cached_input_tokens", "cache_write_input_tokens", "reasoning_output_tokens", "total_tokens"];
const n = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const parse = line => { try { return JSON.parse(line); } catch { return undefined; } };
const validTimestamp = value => {
 if (Number.isFinite(value)) return value < 1_000_000_000_000 ? value * 1000 : value;
 const timestamp = Date.parse(value);
 return Number.isFinite(timestamp) ? timestamp : undefined;
};
const hash = value => createHash("sha256").update(value).digest("hex");
// Pi fork/clone records are byte-for-byte copied into another session file, so their
// serialized-entry hash deliberately spans the entire Pi lineage rather than one session.
const identity = (source, sessionId, key) => source === "pi" || source === "claude" ? `${source}:${key}` : `${source}:${sessionId}:${key}`;

function makeEvent(base, usage = {}) {
 const timestamp = validTimestamp(base.timestamp);
 if (timestamp === undefined) return undefined;
 const event = { source:base.source, sessionId:base.sessionId || "unknown", key:base.key, timestamp, provider:base.provider || "unknown", model:base.model || "unknown", kind:base.kind || "main", costBasis:base.costBasis || "unavailable", origin:base.origin };
 for (const key of TOKEN_KEYS) event[key] = n(usage[key]);
 if (event.reasoning > event.output) event.reasoning = event.output;
 if (usage.cacheWrite5m !== undefined) event.cacheWrite5m = n(usage.cacheWrite5m);
 if (usage.cacheWrite1h !== undefined) event.cacheWrite1h = n(usage.cacheWrite1h);
 if (usage.costNativeTicks !== undefined) event.costNativeTicks = n(usage.costNativeTicks);
 if (usage.costUsd !== undefined && Number.isFinite(usage.costUsd) && usage.costUsd >= 0) event.costUsd = usage.costUsd;
 return event;
}

const piUsage = usage => usage && ({ input:usage.input, output:usage.output, cacheRead:usage.cacheRead, cacheWrite:usage.cacheWrite, cacheWrite5m:Math.max(0,n(usage.cacheWrite)-n(usage.cacheWrite1h)), cacheWrite1h:usage.cacheWrite1h, reasoning:usage.reasoning, total:usage.totalTokens, costUsd:usage.cost?.total });
const claudeUsage = usage => ({ input:usage.input_tokens, output:usage.output_tokens, cacheRead:usage.cache_read_input_tokens, cacheWrite:usage.cache_creation_input_tokens, cacheWrite5m:usage.cache_creation?.ephemeral_5m_input_tokens, cacheWrite1h:usage.cache_creation?.ephemeral_1h_input_tokens, total:n(usage.input_tokens) + n(usage.output_tokens) + n(usage.cache_read_input_tokens) + n(usage.cache_creation_input_tokens) });
const codexDelta = (current, previous) => Object.fromEntries(CODEX_KEYS.map(key => [key, Math.max(0, n(current[key]) - n(previous?.[key]))]));
const hasTokens = usage => CODEX_KEYS.some(key => n(usage[key]) > 0);

function piEvents(file, health) {
 const result = [];
 let sessionId = basename(file.path);
 for (const line of file.lines) {
  const row = parse(line); if (!row) { health.malformed++; continue; }
  if (row.type === "session") { sessionId = row.id || sessionId; continue; }
  let usage, provider, model, kind = "main", timestamp;
  if (row.type === "message") { usage = piUsage(row.message?.usage); provider = row.provider || row.message?.provider; model = row.model || row.message?.model; kind = row.message?.role === "toolResult" ? "nested-tool" : "main"; timestamp = row.timestamp || row.message?.timestamp; }
  else if (row.type === "compaction" || row.type === "branch_summary") { usage = piUsage(row.usage); kind = "summary"; timestamp = row.timestamp; provider = row.provider; model = row.model; }
  else continue;
  if (!usage) continue;
  const event = makeEvent({source:"pi",sessionId,key:hash(line),timestamp,provider,model,kind,costBasis:"recorded",origin:file.path}, usage);
  if (event) result.push(event); else health.skipped++;
 }
 return result;
}

function claudeCandidates(file, health) {
 const result = [];
 for (const line of file.lines) {
  const row = parse(line); if (!row) { health.malformed++; continue; }
  if (row.type !== "assistant" || row.message?.model === "<synthetic>" || !row.message?.usage) continue;
  // message.id is stable across snapshots even when requestId is missing on one of them.
  const key = row.message.id || row.requestId; if (!key) { health.skipped++; continue; }
  const event = makeEvent({source:"claude",sessionId:row.sessionId || basename(file.path),key,timestamp:row.timestamp,provider:"anthropic",model:row.message.model,kind:file.path.includes("/subagents/") ? "subagent" : "main",origin:file.path}, claudeUsage(row.message.usage));
  if (event) result.push(event); else health.skipped++;
 }
 return result;
}

function grokEvents(file, health) {
 const result = [];
 const directorySessionId = basename(dirname(file.path));
 for (const line of file.lines) {
  if (!line.includes("turn_completed")) continue;
  const row = parse(line); if (!row) { health.malformed++; continue; }
  const update = row.params?.update;
  if (update?.sessionUpdate !== "turn_completed" || !update.usage) continue;
  const promptId = update.prompt_id || update.promptId; if (!promptId) { health.skipped++; continue; }
  const aggregate = update.usage;
  const models = aggregate.modelUsage && typeof aggregate.modelUsage === "object"
   ? Object.entries(aggregate.modelUsage)
   : [["unknown", aggregate]];
  const sessionId = row.params?.sessionId || directorySessionId;
  for (const [model, modelUsage] of models) {
   const usage = modelUsage && typeof modelUsage === "object" ? modelUsage : aggregate;
   const event = makeEvent({source:"grok",sessionId,key:`${promptId}:${model}`,timestamp:row.timestamp,provider:"xai",model,kind:"main",costBasis:"recorded",origin:file.path},{input:usage.inputTokens,output:usage.outputTokens,cacheRead:usage.cachedReadTokens,cacheWrite:usage.cacheCreationTokens,reasoning:usage.reasoningTokens,total:usage.totalTokens,costNativeTicks:usage.costUsdTicks ?? (models.length === 1 ? aggregate.costUsdTicks : undefined)});
   if (event) result.push(event); else health.skipped++;
  }
 }
 return result;
}

function codexEvents(file, health, state, parserState = {}) {
 const result = [];
 let sessionId = parserState.sessionId || basename(file.path);
 let provider = parserState.provider || "openai";
 let model = parserState.model || "unknown";
 let kind = parserState.kind || "main";
 let metadataSeen = parserState.metadataSeen === true;
 for (const line of file.lines) {
  if (!line.includes("token_count") && !line.includes("session_meta") && !line.includes("turn_context")) continue;
  const row = parse(line); if (!row) { health.malformed++; continue; }
  if (row.type === "session_meta") {
   // The first id is the independently billed rollout. Later copied metadata can
   // refer back to the root thread and must not collapse subagent rollouts.
   if (!metadataSeen) {
    sessionId = row.payload?.id || sessionId;
    provider = row.payload?.model_provider || provider;
    kind = row.payload?.thread_source === "subagent" ? "subagent" : "main";
    parserState.threadId = row.payload?.session_id;
    metadataSeen = true;
   }
   continue;
  }
  if (row.type === "turn_context") { model = row.payload?.model || model; continue; }
  const current = row.type === "event_msg" && row.payload?.type === "token_count" ? row.payload.info?.total_token_usage : undefined;
  if (!current) continue;
  const previous = state[sessionId]?.usage || {};
  const delta = codexDelta(current, previous);
  // A resumed rollout commonly starts below an existing high-water mark. It is replay, not negative spend.
  const grew = CODEX_KEYS.some(key => n(current[key]) > n(previous[key]));
  if (!grew || !hasTokens(delta)) continue;
  state[sessionId] = { usage:Object.fromEntries(CODEX_KEYS.map(key => [key, Math.max(n(previous[key]), n(current[key]))])), model, provider };
  const event = makeEvent({source:"codex",sessionId,key:`${sessionId}:${n(current.total_tokens)}:${hash(JSON.stringify(delta)).slice(0,12)}`,timestamp:row.timestamp,provider,model,kind,costBasis:"unavailable",origin:file.path},{input:delta.input_tokens,output:delta.output_tokens,cacheRead:delta.cached_input_tokens,cacheWrite:delta.cache_write_input_tokens,reasoning:delta.reasoning_output_tokens,total:delta.total_tokens});
  if (event) result.push(event); else health.skipped++;
 }
 parserState.sessionId = sessionId;
 parserState.provider = provider;
 parserState.model = model;
 parserState.kind = kind;
 parserState.metadataSeen = metadataSeen;
 return result;
}

/** Parse in-memory synthetic files. Pi's hashed serialized-entry key is independent of file order. */
export function collectLines(source, files) {
 const health = { malformed:0, skipped:0 };
 const candidates = [], codexState = {};
 for (const file of files) {
  if (source === "pi") candidates.push(...piEvents(file, health));
  if (source === "claude") candidates.push(...claudeCandidates(file, health));
  if (source === "grok") candidates.push(...grokEvents(file, health));
  if (source === "codex") candidates.push(...codexEvents(file, health, codexState));
 }
 const map = new Map();
 for (const event of candidates) {
  const id = identity(event.source, event.sessionId, event.key);
  const old = map.get(id);
  // Claude streams snapshots: preserve the largest/latest usage, never first-wins.
  if (!old || source === "claude" && (event.total > old.total || event.total === old.total && event.timestamp >= old.timestamp)) map.set(id, event);
 }
 return [...map.values()];
}

export async function walkJsonl(root, matcher = () => true) { const result=[]; async function visit(dir) { let entries; try { entries=await readdir(dir,{withFileTypes:true}); } catch { return; } for (const entry of entries) { const path=join(dir,entry.name); if (entry.isDirectory()) await visit(path); else if (entry.isFile() && matcher(path)) result.push(path); } } await visit(root); return result; }

async function appendedLines(path, offset, size) {
 const handle = await open(path, "r");
 let position = offset;
 let carry = Buffer.alloc(0);
 const lines = [];
 try {
  while (position < size) {
   const length = Math.min(64 * 1024, size - position);
   const buffer = Buffer.allocUnsafe(length);
   const {bytesRead} = await handle.read(buffer, 0, length, position);
   if (!bytesRead) break;
   position += bytesRead;
   const combined = carry.length
    ? Buffer.concat([carry, buffer.subarray(0, bytesRead)])
    : buffer.subarray(0, bytesRead);
   const newline = combined.lastIndexOf(0x0a);
   if (newline < 0) { carry = Buffer.from(combined); continue; }
   const complete = combined.subarray(0, newline + 1).toString("utf8");
   const parts = complete.split("\n");
   parts.pop();
   lines.push(...parts);
   carry = Buffer.from(combined.subarray(newline + 1));
  }
 } finally { await handle.close(); }
 // Do not advance beyond an incomplete write. It is re-read after the writer terminates its line.
 return { lines, offset: position - carry.length };
}

const specs = roots => [["pi",roots.pi,path=>path.endsWith(".jsonl")],["claude",roots.claude,path=>path.endsWith(".jsonl")],["codex",roots.codex,path=>path.endsWith(".jsonl")],["grok",roots.grok,path=>basename(path)==="updates.jsonl"]];
const emptyIndex = () => ({version:3,events:[],files:{},codex:{}});
export async function loadIndex(path) { try { const index=JSON.parse(await readFile(path,"utf8")); return index?.version === 3 ? index : emptyIndex(); } catch { return emptyIndex(); } }
export async function saveIndex(path,index) { await mkdir(dirname(path),{recursive:true}); const temporary=`${path}.${process.pid}.${Date.now()}.tmp`; await writeFile(temporary,JSON.stringify(index),"utf8"); await rename(temporary,path); }

export async function importAll(roots, index = emptyIndex()) {
 const next = structuredClone(index); const health=[];
 for (const [source, root, matcher] of specs(roots)) {
  const rootList = (Array.isArray(root) ? root : [root]).filter(Boolean); if (!rootList.length) { health.push({source,status:"unavailable",files:0,malformed:0,skipped:0}); continue; }
  const availableRoots = await Promise.all(rootList.map(async value => { try { return (await stat(value)).isDirectory(); } catch { return false; } }));
  if (!availableRoots.some(Boolean)) { health.push({source,status:"unavailable",files:0,malformed:0,skipped:0}); continue; }
  const paths=(await Promise.all(rootList.map(value=>walkJsonl(value,matcher)))).flat(); const known=Object.entries(next.files).filter(([,cursor])=>cursor.source === source);
  let reconcile = known.some(([path]) => !paths.includes(path));
  for (const path of paths) { try { const info=await stat(path); const cursor=next.files[path]; if (cursor && (info.size < cursor.size || info.mtimeMs < cursor.mtimeMs || info.size === cursor.size && info.mtimeMs !== cursor.mtimeMs || cursor.ino !== undefined && info.ino !== cursor.ino)) reconcile=true; } catch { reconcile=true; } }
  if (reconcile) { next.events=next.events.filter(event=>event.source !== source); for (const [path] of known) delete next.files[path]; if (source === "codex") next.codex={}; }
  const sourceHealth={source,status:"ok",files:paths.length,malformed:0,skipped:0,reconciled:reconcile}; const candidates=[];
  for (const path of paths) {
   const info=await stat(path); const cursor=next.files[path]; if (!reconcile && cursor?.size === info.size && cursor.mtimeMs === info.mtimeMs) continue;
   const {lines,offset}=await appendedLines(path,reconcile ? 0 : cursor?.offset || 0,info.size); const file={path,lines};
   if (source === "pi") candidates.push(...piEvents(file,sourceHealth));
   if (source === "claude") candidates.push(...claudeCandidates(file,sourceHealth));
   if (source === "grok") candidates.push(...grokEvents(file,sourceHealth));
   const parserState = reconcile ? {} : structuredClone(cursor?.parserState || {});
   if (source === "codex") candidates.push(...codexEvents(file,sourceHealth,next.codex,parserState));
   next.files[path]={source,size:info.size,mtimeMs:info.mtimeMs,ino:info.ino,offset};
   if (source === "codex") next.files[path].parserState=parserState;
  }
  const map=new Map(next.events.map(event=>[identity(event.source,event.sessionId,event.key),event]));
  for (const event of candidates) { const id=identity(event.source,event.sessionId,event.key), old=map.get(id); if (!old || source !== "claude" || event.total > old.total || event.total === old.total && event.timestamp >= old.timestamp) map.set(id,event); }
  next.events=[...map.values()]; sourceHealth.status=sourceHealth.malformed || sourceHealth.skipped ? "partial" : "ok"; health.push(sourceHealth);
 }
 return {events:next.events,health,index:next};
}

// Retained for callers with an externally assembled batch.
export function mergeIndex(index,events) { const map=new Map(index.events.map(event=>[identity(event.source,event.sessionId,event.key),event])); for(const event of events) map.set(identity(event.source,event.sessionId,event.key),event); return {...index,events:[...map.values()]}; }
export function eventsForPeriod(events,period="all",now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone) {
 const formatter=new Intl.DateTimeFormat("en",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"});
 const day=date=>{const parts=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value])); return `${parts.year}-${parts.month}-${parts.day}`;};
 const today=day(now);
 let startDay=today;
 if (period === "month") startDay=`${today.slice(0,7)}-01`;
 else if (period !== "all") { const [year,month,date]=today.split("-").map(Number); const start=new Date(Date.UTC(year,month-1,date)); start.setUTCDate(start.getUTCDate()-(period==="today"?0:period==="7d"?6:29)); startDay=start.toISOString().slice(0,10); }
 return events.filter(event=>period==="all" || day(new Date(event.timestamp))>=startDay && day(new Date(event.timestamp))<=today);
}
export function totalsForPeriod(events,period="all",now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone) { return eventsForPeriod(events,period,now,timeZone).reduce((total,event)=>{total.requests++; for(const key of TOKEN_KEYS) total[key]+=event[key]; total.cacheWrite5m+=event.cacheWrite5m || 0; total.cacheWrite1h+=event.cacheWrite1h || 0; const cost=(event.costUsd || 0)+(event.costNativeTicks || 0)/1e10; if(event.costBasis === "recorded") { total.recordedCost+=cost; total.recordedCostItems++; } else if(event.costBasis === "estimated") { total.estimatedCost+=cost; total.estimatedCostItems++; } else total.unavailableCost++; return total;},{requests:0,input:0,output:0,cacheRead:0,cacheWrite:0,cacheWrite5m:0,cacheWrite1h:0,reasoning:0,total:0,recordedCost:0,recordedCostItems:0,estimatedCost:0,estimatedCostItems:0,unavailableCost:0}); }
export function estimateModelCost(usages,model) {
 const base=model?.cost;
 if (!base) return undefined;
 const items=Array.isArray(usages) ? usages : [usages];
 let total=0;
 for (const usage of items) {
  const inputTokens=n(usage.input)+n(usage.cacheRead)+n(usage.cacheWrite);
  let rates=base, threshold=-1;
  for (const tier of base.tiers || []) if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > threshold) { rates=tier; threshold=tier.inputTokensAbove; }
  for (const key of ["input","output","cacheRead","cacheWrite"]) if (!Number.isFinite(rates[key])) return undefined;
  const longWrite=Math.min(n(usage.cacheWrite1h),n(usage.cacheWrite));
  const shortWrite=n(usage.cacheWrite)-longWrite;
  total+=(rates.input*n(usage.input)+rates.output*n(usage.output)+rates.cacheRead*n(usage.cacheRead)+rates.cacheWrite*shortWrite+rates.input*2*longWrite)/1_000_000;
 }
 return total;
}
export const groupEvents = events => [...events.reduce((map,event)=>{const key=`${event.source} | ${event.provider} | ${event.model}`; const group=map.get(key)||{label:key,events:[]}; group.events.push(event); map.set(key,group); return map;},new Map()).values()];
