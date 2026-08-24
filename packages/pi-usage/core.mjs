import { createHash, randomUUID } from "node:crypto";
import { chmod, open, readdir, readFile, rename, stat, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

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
const LABEL_LIMIT = 160;
export const sanitizeLabel = value => String(value ?? "unknown").replace(/\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|O.|[()][0-?]*[ -/]*[@-~])|[\x00-\x1f\x7f]/gu, "").replace(/\s+/gu, " ").trim().slice(0, LABEL_LIMIT) || "unknown";
export const sanitizeFilterInput = value => String(value ?? "").replace(/\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|O.)/gu, "").replace(/[\x00-\x1f\x7f]/gu, "").slice(0,LABEL_LIMIT);
export const freshTokens = usage => n(usage.input) + n(usage.output) + n(usage.cacheWrite);
export const filterEvents = (events, query = "") => {
 const needle = query.trim().toLocaleLowerCase();
 return needle ? events.filter(event => [event.source,event.provider,event.model].some(value => String(value).toLocaleLowerCase().includes(needle))) : events;
};
// Pi entry ids survive fork serialization and format migration, so identities span a lineage.
// Rows without ids fall back to a normalized accounting fingerprint rather than raw JSON bytes.
const identity = (source, sessionId, key) => source === "pi" || source === "claude" ? `${source}:${key}` : `${source}:${sessionId}:${key}`;
const piKey = (row, usage, timestamp) => {
 const accounting = {type:row.type,role:row.message?.role,parentId:row.parentId ?? row.message?.parentId,timestamp,usage:{input:n(usage?.input),output:n(usage?.output),cacheRead:n(usage?.cacheRead),cacheWrite:n(usage?.cacheWrite),reasoning:n(usage?.reasoning),total:n(usage?.totalTokens)}};
 const stable = row.id || row.message?.id;
 return `${stable ? `entry:${stable}` : "normalized"}:${hash(JSON.stringify(accounting))}`;
};

function makeEvent(base, usage = {}) {
 const timestamp = validTimestamp(base.timestamp);
 if (timestamp === undefined) return undefined;
 const event = { source:base.source, sessionId:base.sessionId || "unknown", key:base.key, timestamp, provider:sanitizeLabel(base.provider), model:sanitizeLabel(base.model), kind:base.kind || "main", costBasis:base.costBasis || "unavailable", origin:base.origin };
 for (const key of TOKEN_KEYS) event[key] = n(usage[key]);
 if (event.reasoning > event.output) event.reasoning = event.output;
 if (usage.cacheWrite5m !== undefined) event.cacheWrite5m = n(usage.cacheWrite5m);
 if (usage.cacheWrite1h !== undefined) event.cacheWrite1h = n(usage.cacheWrite1h);
 if (usage.costNativeTicks !== undefined) event.costNativeTicks = n(usage.costNativeTicks);
 if (usage.costUsd !== undefined && Number.isFinite(usage.costUsd) && usage.costUsd >= 0) event.costUsd = usage.costUsd;
 return event;
}

const disjointInput = (input, cacheRead, cacheWrite) => Math.max(0,n(input)-n(cacheRead)-n(cacheWrite));
const piUsage = usage => usage && ({ input:usage.input, output:usage.output, cacheRead:usage.cacheRead, cacheWrite:usage.cacheWrite, cacheWrite5m:Math.max(0,n(usage.cacheWrite)-n(usage.cacheWrite1h)), cacheWrite1h:usage.cacheWrite1h, reasoning:usage.reasoning, total:usage.totalTokens, ...(Number.isFinite(usage.cost?.total) ? {costUsd:usage.cost.total} : {}) });
const claudeUsage = usage => ({ input:usage.input_tokens, output:usage.output_tokens, cacheRead:usage.cache_read_input_tokens, cacheWrite:usage.cache_creation_input_tokens, cacheWrite5m:usage.cache_creation?.ephemeral_5m_input_tokens, cacheWrite1h:usage.cache_creation?.ephemeral_1h_input_tokens, total:n(usage.input_tokens) + n(usage.output_tokens) + n(usage.cache_read_input_tokens) + n(usage.cache_creation_input_tokens) });
const codexDelta = (current, previous) => Object.fromEntries(CODEX_KEYS.map(key => [key, Math.max(0, n(current[key]) - n(previous?.[key]))]));
const hasTokens = usage => CODEX_KEYS.some(key => n(usage[key]) > 0);

function piEvents(file, health) {
 const result = [];
 let sessionId = basename(file.path);
 let lastProvider = "unknown", lastModel = "unknown";
 for (const line of file.lines) {
  const row = parse(line); if (!row) { health.malformed++; continue; }
  if (row.type === "session") { sessionId = row.id || sessionId; continue; }
  let usage, provider, model, kind = "main", timestamp;
  if (row.type === "message") { usage = piUsage(row.message?.usage); provider = row.provider || row.message?.provider; model = row.model || row.message?.model; kind = row.message?.role === "toolResult" ? "nested-tool" : "main"; timestamp = row.timestamp || row.message?.timestamp; if (row.message?.role === "assistant" && provider && model) { lastProvider = provider; lastModel = model; } }
  else if (row.type === "compaction" || row.type === "branch_summary") { usage = piUsage(row.usage); kind = "summary"; timestamp = row.timestamp; provider = row.provider || lastProvider; model = row.model || lastModel; }
  else continue;
  if (!usage) continue;
  const hasCost = Number.isFinite(usage.costUsd) && usage.costUsd >= 0;
  const event = makeEvent({source:"pi",sessionId,key:piKey(row, row.message?.usage || row.usage, timestamp),timestamp,provider,model,kind,costBasis:hasCost ? "recorded" : "unavailable",origin:file.path}, usage);
  if (event) {
   // Keep only accounting-safe child references, never the tool payload that contained them.
   const messageDetails = row.message?.details;
   const details = row.details;
   const results = Array.isArray(messageDetails?.results) ? messageDetails.results : Array.isArray(details?.results) ? details.results : [];
   const sessionFiles = results.map(item => typeof item?.sessionFile === "string" ? item.sessionFile : undefined).filter(Boolean);
   const runId = typeof details?.runId === "string" ? details.runId : typeof messageDetails?.runId === "string" ? messageDetails.runId : undefined;
   // This is the complete persisted link allowlist. Results themselves can carry prompts,
   // tool output, and other transcript data, so retain only their count and file links.
   if (results.length || runId) event.childLinks = { sessionFiles, runId, resultCount:results.length };
   result.push(event);
  } else health.skipped++;
 }
 return result;
}

function piSuppressedIdentities(candidates, files) {
 const linked = candidates.filter(event => event.kind === "nested-tool" && event.childLinks);
 const suppressed = new Set();
 if (!linked.length) return suppressed;
 const paths = new Set(files.map(file => resolve(file.path)));
 const runDirectories = new Map();
 for (const event of linked) if (event.childLinks.resultCount > event.childLinks.sessionFiles.length && event.childLinks.runId) runDirectories.set(`${resolve(dirname(event.origin),event.childLinks.runId)}${sep}`,0);
 for (const path of paths) for (const directory of runDirectories.keys()) if (path.startsWith(directory) && path.endsWith(".jsonl")) runDirectories.set(directory,runDirectories.get(directory)+1);
 for (const event of linked) {
  const { sessionFiles = [], runId, resultCount = 0 } = event.childLinks;
  // No result references means this is an ordinary tool aggregate, regardless of runId.
  if (!resultCount) continue;
  // Explicit file references must always resolve from this copy's parent directory.
  if (!sessionFiles.every(link => paths.has(resolve(dirname(event.origin), link)))) continue;
  const unresolved = resultCount - sessionFiles.length;
  if (!unresolved) { suppressed.add(identity(event.source,event.sessionId,event.key)); continue; }
  // Results without a file reference may belong to a run directory next to this session.
  // Count only scanned JSONL files beneath that directory, never session ids or raw rows.
  if (!runId) continue;
  const runDirectory = `${resolve(dirname(event.origin), runId)}${sep}`;
  const scannedChildren = runDirectories.get(runDirectory) ?? 0;
  const explicitInRun = sessionFiles.filter(link => resolve(dirname(event.origin), link).startsWith(runDirectory)).length;
  if (scannedChildren - explicitInRun >= unresolved) suppressed.add(identity(event.source,event.sessionId,event.key));
 }
 return suppressed;
}

function piReconciledEvents(candidates, files) {
 const suppressed = piSuppressedIdentities(candidates, files);
 return candidates.filter(event => !suppressed.has(identity(event.source,event.sessionId,event.key)));
}

function claudeCandidates(file, health) {
 const result = [];
 for (const line of file.lines) {
  const row = parse(line); if (!row) { health.malformed++; continue; }
  if (row.type !== "assistant" || row.message?.model === "<synthetic>" || !row.message?.usage) continue;
  // message.id is stable across snapshots even when requestId is missing on one of them.
  const key = row.message.id || row.requestId; if (!key) { health.skipped++; continue; }
  const event = makeEvent({source:"claude",sessionId:row.sessionId || basename(file.path),key,timestamp:row.timestamp,provider:"anthropic",model:row.message.model,kind:/(^|[\\/])subagents([\\/]|$)/u.test(file.path) ? "subagent" : "main",origin:file.path}, claudeUsage(row.message.usage));
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
   const ticks = usage.costUsdTicks ?? (models.length === 1 ? aggregate.costUsdTicks : undefined);
   const event = makeEvent({source:"grok",sessionId,key:`${promptId}:${model}`,timestamp:row.timestamp,provider:"xai",model,kind:"main",costBasis:Number.isSafeInteger(ticks) && ticks >= 0 ? "recorded" : "unavailable",origin:file.path},{input:disjointInput(usage.inputTokens,usage.cachedReadTokens,usage.cacheCreationTokens),output:usage.outputTokens,cacheRead:usage.cachedReadTokens,cacheWrite:usage.cacheCreationTokens,reasoning:usage.reasoningTokens,total:usage.totalTokens,costNativeTicks:ticks});
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
  const event = makeEvent({source:"codex",sessionId,key:`${sessionId}:${n(current.total_tokens)}:${hash(JSON.stringify(delta)).slice(0,12)}`,timestamp:row.timestamp,provider,model,kind,costBasis:"unavailable",origin:file.path},{input:disjointInput(delta.input_tokens,delta.cached_input_tokens,delta.cache_write_input_tokens),output:delta.output_tokens,cacheRead:delta.cached_input_tokens,cacheWrite:delta.cache_write_input_tokens,reasoning:delta.reasoning_output_tokens,total:delta.total_tokens});
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
 for (const event of source === "pi" ? piReconciledEvents(candidates, files) : candidates) {
  const id = identity(event.source, event.sessionId, event.key);
  const old = map.get(id);
  // Claude streams snapshots: preserve the largest/latest usage, never first-wins.
  if (!old || source === "claude" && (event.total > old.total || event.total === old.total && event.timestamp >= old.timestamp)) map.set(id, event);
 }
 return [...map.values()];
}

export async function walkJsonl(root, matcher = () => true) { const result=[]; async function visit(dir) { let entries; try { entries=await readdir(dir,{withFileTypes:true}); } catch { return; } for (const entry of entries) { const path=join(dir,entry.name); if (entry.isDirectory()) await visit(path); else if (entry.isFile() && matcher(path)) result.push(path); } } await visit(root); return result; }

export const MAX_JSONL_LINE_BYTES = 64 * 1024 * 1024;
/** Bounded scanner: oversized lines are discarded without retaining their contents. */
export function scanJsonlChunks(chunks, cap = MAX_JSONL_LINE_BYTES, state = {}) {
 const lines=[]; let parts=state.parts || [], carryBytes=state.carryBytes || 0, discarding=state.discarding || false, consumed=0, skipped=state.skipped || 0;
 for (const chunk of chunks) {
  consumed+=chunk.length; let start=0;
  while (start < chunk.length) {
   const newline=chunk.indexOf(0x0a,start), end=newline < 0 ? chunk.length : newline, part=chunk.subarray(start,end);
   if (discarding) { if (newline >= 0) discarding=false; }
   else if (carryBytes + part.length > cap) { skipped++; parts=[]; carryBytes=0; discarding=newline < 0; }
   else {
    if (part.length) { parts.push(Buffer.from(part)); carryBytes+=part.length; }
    if (newline >= 0) { lines.push(parts.length === 1 ? parts[0].toString("utf8") : Buffer.concat(parts,carryBytes).toString("utf8")); parts=[]; carryBytes=0; }
   }
   if (newline < 0) break;
   start=newline+1;
  }
 }
 return {lines,parts,carryBytes,discarding,skipped,consumed};
}
async function appendedLines(path, offset, size, cap = MAX_JSONL_LINE_BYTES) {
 const handle=await open(path,"r"); let position=offset,state={},skipped=0; const lines=[];
 try { while (position < size) { const buffer=Buffer.allocUnsafe(Math.min(64*1024,size-position)); const {bytesRead}=await handle.read(buffer,0,buffer.length,position); if (!bytesRead) break; position+=bytesRead; const scanned=scanJsonlChunks([buffer.subarray(0,bytesRead)],cap,state); lines.push(...scanned.lines); state=scanned; skipped=scanned.skipped; } } finally { await handle.close(); }
 // A normal torn tail remains for next scan; a malformed oversized tail is consumed permanently.
 return {lines,offset:state.discarding ? position : position-(state.carryBytes || 0),skipped};
}

export const sourceRoots = (home,agentDir) => ({pi:join(agentDir,"sessions"),claude:join(home,".claude","projects"),codex:[join(home,".codex","sessions"),join(home,".codex","archived_sessions")],grok:join(home,".grok","sessions")});
const specs = roots => [["pi",roots.pi,path=>path.endsWith(".jsonl")],["claude",roots.claude,path=>path.endsWith(".jsonl")],["codex",roots.codex,path=>path.endsWith(".jsonl")],["grok",roots.grok,path=>basename(path)==="updates.jsonl"]];
const emptyIndex = () => ({version:7,events:[],files:{},codex:{}});
export async function loadIndex(path) { try { const index=JSON.parse(await readFile(path,"utf8")); return index?.version === 7 ? index : emptyIndex(); } catch { return emptyIndex(); } }
export async function saveIndex(path,index) { await mkdir(dirname(path),{recursive:true,mode:0o700}); await chmod(dirname(path),0o700); const temporary=`${path}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temporary,JSON.stringify(index),{encoding:"utf8",mode:0o600,flag:"wx"}); await rename(temporary,path); await chmod(path,0o600); } catch (error) { await unlink(temporary).catch(()=>{}); throw error; } }

export async function importAll(roots, index = emptyIndex(), hooks = {}) {
 const next = structuredClone(index); const health=[];
 for (const [source, root, matcher] of specs(roots)) {
  const rootList = (Array.isArray(root) ? root : [root]).filter(Boolean); if (!rootList.length) { const stale=Object.entries(next.files).filter(([,cursor])=>cursor.source===source); const reconciled=stale.length>0 || next.events.some(event=>event.source===source); next.events=next.events.filter(event=>event.source!==source); for(const [path] of stale) delete next.files[path]; if(source==="codex") next.codex={}; health.push({source,status:"unavailable",files:0,malformed:0,skipped:0,reconciled}); continue; }
  const availableRoots = await Promise.all(rootList.map(async value => { try { return (await stat(value)).isDirectory(); } catch { return false; } }));
  if (!availableRoots.some(Boolean)) { const stale=Object.entries(next.files).filter(([,cursor])=>cursor.source===source); const reconciled=stale.length>0 || next.events.some(event=>event.source===source); next.events=next.events.filter(event=>event.source!==source); for(const [path] of stale) delete next.files[path]; if(source==="codex") next.codex={}; health.push({source,status:"unavailable",files:0,malformed:0,skipped:0,reconciled}); continue; }
  const paths=(await Promise.all(rootList.map(value=>walkJsonl(value,matcher)))).flat(); const known=Object.entries(next.files).filter(([,cursor])=>cursor.source === source);
  let reconcile = known.some(([path]) => !paths.includes(path));
  for (const path of paths) { try { const info=await stat(path); const cursor=next.files[path]; if (cursor && (info.size < cursor.size || info.mtimeMs < cursor.mtimeMs || info.size === cursor.size && info.mtimeMs !== cursor.mtimeMs || cursor.ino !== undefined && info.ino !== cursor.ino)) reconcile=true; } catch { reconcile=true; } }
  if (reconcile) { next.events=next.events.filter(event=>event.source !== source); for (const [path] of known) delete next.files[path]; if (source === "codex") next.codex={}; }
  const sourceHealth={source,status:"ok",files:paths.length,malformed:0,skipped:0,reconciled:reconcile}; const candidates=[];
  // Reconciliation resolves links against every currently scanned Pi path, including
  // unchanged files during a warm append. File paths are safe index metadata.
  const piFiles = source === "pi" ? paths.map(path => ({path,lines:[]})) : [];
  for (const path of paths) {
   let info; try { info=await stat(path); } catch (error) { if (error?.code === "ENOENT") { reconcile=true; sourceHealth.reconciled=true; sourceHealth.skipped++; continue; } throw error; }
   const cursor=next.files[path]; if (!reconcile && cursor?.size === info.size && cursor.mtimeMs === info.mtimeMs) continue;
   let read; try { await hooks.beforeRead?.(path); read=await appendedLines(path,reconcile ? 0 : cursor?.offset || 0,info.size); } catch (error) { if (error?.code === "ENOENT") { reconcile=true; sourceHealth.reconciled=true; sourceHealth.skipped++; continue; } throw error; }
   const {lines,offset,skipped}=read; sourceHealth.skipped+=skipped; const file={path,lines};
   if (source === "pi") candidates.push(...piEvents(file,sourceHealth));
   if (source === "claude") candidates.push(...claudeCandidates(file,sourceHealth));
   if (source === "grok") candidates.push(...grokEvents(file,sourceHealth));
   const parserState = reconcile ? {} : structuredClone(cursor?.parserState || {});
   if (source === "codex") candidates.push(...codexEvents(file,sourceHealth,next.codex,parserState));
   next.files[path]={source,size:info.size,mtimeMs:info.mtimeMs,ino:info.ino,offset};
   if (source === "codex") next.files[path].parserState=parserState;
  }
  const hasChildLinks = source === "pi" && (candidates.some(event => event.childLinks) || next.events.some(event => event.source === "pi" && event.childLinks));
  const allCandidates = hasChildLinks ? [...next.events.filter(event => event.source === "pi"),...candidates] : candidates;
  const suppressed = hasChildLinks ? piSuppressedIdentities(allCandidates,piFiles) : new Set();
  const sourceCandidates = source === "pi" ? candidates.filter(event => !suppressed.has(identity(event.source,event.sessionId,event.key))) : candidates;
  const map=new Map(next.events.filter(event => !suppressed.has(identity(event.source,event.sessionId,event.key))).map(event=>[identity(event.source,event.sessionId,event.key),event]));
  for (const event of sourceCandidates) { const id=identity(event.source,event.sessionId,event.key), old=map.get(id); if (!old || source !== "claude" || event.total > old.total || event.total === old.total && event.timestamp >= old.timestamp) map.set(id,event); }
  next.events=[...map.values()]; sourceHealth.status=sourceHealth.malformed || sourceHealth.skipped ? "partial" : "ok"; health.push(sourceHealth);
 }
 return {events:next.events,health,index:next};
}

// Retained for callers with an externally assembled batch.
export function mergeIndex(index,events) { const map=new Map(index.events.map(event=>[identity(event.source,event.sessionId,event.key),event])); for(const event of events) map.set(identity(event.source,event.sessionId,event.key),event); return {...index,events:[...map.values()]}; }
export function eventsForPeriod(events,period="all",now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone) {
 if (period === "all") return events;
 const formatter=new Intl.DateTimeFormat("en",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"});
 const day=date=>{const parts=formatter.formatToParts(date); return `${parts.find(part=>part.type==="year").value}-${parts.find(part=>part.type==="month").value}-${parts.find(part=>part.type==="day").value}`;};
 const today=day(now); let startDay=today;
 if (period === "month") startDay=`${today.slice(0,7)}-01`;
 else { const [year,month,date]=today.split("-").map(Number); const start=new Date(Date.UTC(year,month-1,date)); start.setUTCDate(start.getUTCDate()-(period==="today"?0:period==="7d"?6:29)); startDay=start.toISOString().slice(0,10); }
 return events.filter(event=>{const eventDay=day(new Date(event.timestamp)); return eventDay>=startDay && eventDay<=today;});
}
export function totalsForPeriod(events,period="all",now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone) { return eventsForPeriod(events,period,now,timeZone).reduce((total,event)=>{total.requests++; for(const key of TOKEN_KEYS) total[key]+=event[key]; total.fresh+=freshTokens(event); total.cacheWrite5m+=event.cacheWrite5m || 0; total.cacheWrite1h+=event.cacheWrite1h || 0; const cost=(event.costUsd || 0)+(event.costNativeTicks || 0)/1e10; if(event.costBasis === "recorded") { total.recordedCost+=cost; total.recordedCostItems++; } else if(event.costBasis === "estimated") { total.estimatedCost+=cost; total.estimatedCostItems++; } else total.unavailableCost++; return total;},{requests:0,input:0,output:0,cacheRead:0,cacheWrite:0,fresh:0,cacheWrite5m:0,cacheWrite1h:0,reasoning:0,total:0,recordedCost:0,recordedCostItems:0,estimatedCost:0,estimatedCostItems:0,unavailableCost:0}); }
export function pricingModelsFromRegistry(models) {
 const complete = cost => [cost?.input,cost?.output,cost?.cacheRead,cost?.cacheWrite].every(Number.isFinite);
 const result=new Map();
 for(const model of models || []) { const cost=model?.cost; if(!complete(cost) || !(cost.tiers||[]).every(complete) || ![cost.input,cost.output,cost.cacheRead,cost.cacheWrite].some(rate=>rate>0)) continue; const provider=sanitizeLabel(model.provider), id=sanitizeLabel(model.id); if (!result.has(`${provider}/${id}`)) result.set(`${provider}/${id}`,{provider,id,name:sanitizeLabel(model.name || model.id),cost:{...cost,tiers:cost.tiers?.map(tier=>({...tier}))}}); }
 return [...result.values()];
}
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
