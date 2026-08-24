import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectLines, estimateModelCost, eventsForPeriod, filterEvents, importAll, loadIndex, MAX_JSONL_LINE_BYTES, pricingModelsFromRegistry, sanitizeFilterInput, sanitizeLabel, saveIndex, scanJsonlChunks, sourceRoots, totalsForPeriod } from "./core.mjs";
import { bucketEvents, compressBuckets, renderBrailleGraph } from "./graph.mjs";

const iso = "2026-08-15T12:00:00.000Z";
const piUsage = { input:10, output:4, cacheRead:2, cacheWrite:1, reasoning:3, totalTokens:14, cost:{total:.02} };
const line = value => JSON.stringify(value);

async function fixture() { return mkdtemp(join(tmpdir(),"pi-usage-")); }
async function jsonl(path, rows) { await mkdir(join(path,".."),{recursive:true}); await writeFile(path,rows.join("\n") + "\n"); }

test("Pi counts assistant, tool, compaction and branch summary once even when a fork is supplied first", () => {
 const parent=[line({type:"session",id:"parent"}),line({type:"message",id:"a",timestamp:iso,message:{role:"assistant",provider:"anthropic",model:"claude",usage:piUsage}}),line({type:"compaction",id:"b",timestamp:iso,usage:piUsage}),line({type:"branch_summary",id:"c",timestamp:iso,usage:piUsage}),line({type:"message",id:"d",timestamp:iso,message:{role:"toolResult",usage:piUsage}})];
 const fork=[line({type:"session",id:"fork",parentSession:"/parent.jsonl"}),...parent.slice(1),line({type:"message",id:"e",timestamp:iso,message:{role:"assistant",provider:"openai",model:"gpt",usage:piUsage}})];
 const events=collectLines("pi",[{path:"/fork.jsonl",lines:fork},{path:"/parent.jsonl",lines:parent}]);
 assert.equal(events.length,5); assert.equal(events.reduce((sum,event)=>sum+event.input,0),50); assert.ok(events.every(event=>event.reasoning <= event.output));
 assert.ok(events.filter(event=>event.kind==="summary").every(event=>event.provider==="anthropic"&&event.model==="claude"));
});

test("Pi fork identity survives serialization changes without collapsing distinct entries", () => {
 const first=line({type:"message",id:"shared",parentId:"parent",timestamp:iso,message:{role:"assistant",provider:"anthropic",model:"claude",usage:piUsage}});
 const reordered=line({message:{usage:piUsage,model:"claude",provider:"anthropic",role:"assistant"},timestamp:iso,parentId:"parent",id:"shared",type:"message"});
 assert.equal(collectLines("pi",[{path:"/one.jsonl",lines:[first]},{path:"/two.jsonl",lines:[reordered]}]).length,1);
 const distinct=line({type:"message",id:"shared",parentId:"parent",timestamp:iso,message:{role:"assistant",provider:"anthropic",model:"claude",usage:{...piUsage,output:5,totalTokens:15}}});
 assert.equal(collectLines("pi",[{path:"/one.jsonl",lines:[first]},{path:"/independent.jsonl",lines:[distinct]}]).length,2);
});

test("Pi reconciles nested aggregates only when every linked child is scanned, including fork-relative copies", () => {
 const usage={input:100,output:20,cacheRead:50,cacheWrite:10,totalTokens:180};
 const child=line({type:"message",timestamp:iso,message:{role:"assistant",usage:piUsage}});
 const aggregate=line({type:"message",timestamp:iso,message:{role:"toolResult",usage,details:{results:[{sessionFile:"children/child.jsonl"}]}}});
 const parent=[line({type:"session",id:"parent"}),aggregate];
 const fork=[line({type:"session",id:"fork"}),aggregate];
 const missing=collectLines("pi",[{path:"/sessions/parent.jsonl",lines:parent}]);
 assert.equal(missing.length,1, "unavailable children retain the aggregate");
 const resolved=collectLines("pi",[{path:"/copies/fork.jsonl",lines:fork},{path:"/sessions/parent.jsonl",lines:parent},{path:"/copies/children/child.jsonl",lines:[line({type:"session",id:"child"}),child]}]);
 assert.equal(resolved.length,1, "a resolvable duplicate suppresses the shared aggregate identity");
 assert.equal(resolved[0].kind,"main");
});

test("Pi nested reconciliation does not let an explicit child also cover an unresolved result", () => {
 const aggregate=line({type:"message",timestamp:iso,message:{role:"toolResult",usage:piUsage},details:{runId:"children",results:[{sessionFile:"children/one.jsonl"},{}]}});
 const parent={path:"/sessions/parent.jsonl",lines:[line({type:"session",id:"parent"}),aggregate]};
 const child=id=>({path:`/sessions/children/${id}.jsonl`,lines:[line({type:"session",id}),line({type:"message",id,timestamp:iso,message:{role:"assistant",usage:piUsage}})]});
 const incomplete=collectLines("pi",[parent,child("one")]); assert.equal(incomplete.some(event=>event.kind==="nested-tool"),true);
 const complete=collectLines("pi",[parent,child("one"),child("two")]); assert.equal(complete.some(event=>event.kind==="nested-tool"),false); assert.equal(complete.length,2);
});

test("Pi nested reconciliation re-runs against unchanged children and fork-relative paths", async () => {
 const root=await fixture(); try {
  const pi=join(root,"pi"), parent=join(pi,"parent.jsonl"), child=join(pi,"runs","child","one.jsonl"), fork=join(pi,"copies","parent.jsonl"), forkChild=join(pi,"copies","runs","child","one.jsonl");
  const aggregate=line({type:"message",timestamp:iso,message:{role:"toolResult",usage:piUsage},details:{runId:"runs/child",results:[{}]}});
  await jsonl(parent,[line({type:"session",id:"parent"}),aggregate]);
  let result=await importAll({pi}); assert.equal(result.events.length,1, "missing run child retains aggregate");
  await jsonl(child,[line({type:"session",id:"child"}),line({type:"message",timestamp:iso,message:{role:"assistant",usage:piUsage}})]);
  result=await importAll({pi},result.index); assert.equal(result.health[0].reconciled,false,"a new child remains incremental"); assert.equal(result.events.length,1); assert.equal(result.events[0].sessionId,"child");
  await writeFile(parent,`\n${aggregate}\n`,{flag:"a"}); result=await importAll({pi},result.index); assert.equal(result.events.length,1, "a parent append resolves against an unchanged child");
  await jsonl(fork,[line({type:"session",id:"fork"}),aggregate]);
  await jsonl(forkChild,[line({type:"session",id:"fork-child"}),line({type:"message",timestamp:iso,message:{role:"assistant",usage:piUsage}})]);
  result=await importAll({pi},result.index); assert.equal(result.events.every(event=>event.kind!=="nested-tool"),true, "a later fork copy can suppress an indexed parent");
  await rm(child,{force:true}); await rm(forkChild,{force:true}); result=await importAll({pi},result.index); assert.equal(result.events.some(event=>event.kind==="nested-tool"),true, "child disappearance restores aggregate");
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("Pi retains runId-only aggregates without results and persists only child-link allowlist", () => {
 const aggregate=line({type:"message",timestamp:iso,message:{role:"toolResult",usage:piUsage},details:{runId:"run",secret:"PRIVATE_SENTINEL"}});
 const result=collectLines("pi",[{path:"/sessions/parent.jsonl",lines:[line({type:"session",id:"parent"}),aggregate]},{path:"/sessions/run/child.jsonl",lines:[line({type:"session",id:"child"})]}]);
 assert.equal(result.length,1);
 assert.equal(result[0].kind,"nested-tool");
 assert.deepEqual(result[0].childLinks,{sessionFiles:[],runId:"run",resultCount:0});
 assert.equal(JSON.stringify(result).includes("PRIVATE_SENTINEL"),false);
});

test("fresh totals exclude cache reads and filtering matches providers or models", () => {
 const events=[
  {source:"pi",provider:"Anthropic",model:"Claude A",timestamp:Date.now(),input:10,output:5,cacheWrite:2,cacheRead:90,total:107},
  {source:"pi",provider:"OpenAI",model:"GPT Match",timestamp:Date.now(),input:3,output:4,cacheWrite:1,cacheRead:20,total:28},
 ];
 assert.equal(totalsForPeriod(events).fresh,25);
 assert.deepEqual(filterEvents(events,"anthropic").map(event=>event.model),["Claude A"]);
 assert.deepEqual(filterEvents(events,"match").map(event=>event.model),["GPT Match"]);
 assert.deepEqual(filterEvents(events,"pi").map(event=>event.model),["Claude A","GPT Match"]);
 assert.equal(filterEvents(events,"missing").length,0);
});

test("graph domains retain local zero gaps, compress totals, and render a bounded multiline braille line", () => {
 const events=[
  {timestamp:new Date(2026,7,15,1,10).getTime(),input:2,output:3,cacheWrite:1,cacheRead:8},
  {timestamp:new Date(2026,7,13,23,50).getTime(),input:1,output:1,cacheWrite:0,cacheRead:1},
 ];
 const now=new Date(2026,7,15,12);
 const today=bucketEvents(events,"today",now); assert.equal(today.length,13); assert.equal(today[0].label.endsWith("00:00"),true); assert.equal(today[1].fresh,6); assert.equal(today[2].fresh,0);
 const week=bucketEvents(events,"7d",now); assert.equal(week.length,7); assert.equal(week[5].fresh,0);
 assert.equal(bucketEvents(events,"30d",now).length,30); assert.equal(bucketEvents(events,"month",now).length,15); assert.equal(bucketEvents(events,"all",now).length,3);
 const source=Array.from({length:100},(_,index)=>({label:String(index),fresh:index,cacheRead:index * 2}));
 const compressed=compressBuckets(source,8); assert.equal(compressed.length,8); assert.equal(compressed.reduce((sum,bucket)=>sum+bucket.fresh,0),4950); assert.equal(compressed.reduce((sum,bucket)=>sum+bucket.cacheRead,0),9900);
 const rendered=renderBrailleGraph(compressed,"fresh",24); assert.ok(rendered.length>=5); assert.ok(rendered.some(row=>/[\u2801-\u28ff]/.test(row))); assert.ok(rendered.every(row=>row.length<=24));
 const zero=renderBrailleGraph([{label:"zero",fresh:0,cacheRead:0}],"fresh",10); assert.ok(zero.every(row=>row.length<=10)); assert.ok(zero.some(row=>row.includes("No Fresh")));
 assert.ok(renderBrailleGraph([],"cacheRead",12).some(line=>line.includes("No data")));
 const many=Array.from({length:150_000},(_,index)=>({timestamp:events[0].timestamp+index,input:1,output:0,cacheWrite:0,cacheRead:0})); assert.equal(bucketEvents(many,"all",now).reduce((sum,bucket)=>sum+bucket.fresh,0),150_000);
 assert.equal(bucketEvents([{timestamp:1,input:1}],"all",now).length,5000,"corrupt ancient timestamps cannot create an unbounded domain");
});

test("Claude deduplicates mixed request/message identities with max/latest semantics and includes subagents", () => {
 const assistant=(requestId,id,output,timestamp=iso) => line({type:"assistant",timestamp,requestId,message:{id,model:"claude",content:"PRIVATE_SENTINEL",usage:{input_tokens:10,output_tokens:output,cache_read_input_tokens:2,cache_creation_input_tokens:1,cache_creation:{ephemeral_5m_input_tokens:1,ephemeral_1h_input_tokens:0}}}});
 const events=collectLines("claude",[
  {path:"/project/a.jsonl",lines:[assistant("request","message",1),assistant(undefined,"message",4),assistant(undefined,"message-only",2),assistant("synthetic","x",99)]},
  {path:"/project/subagents/agent.jsonl",lines:[assistant("other-request","message",3,"2026-08-15T12:00:30.000Z"),assistant("sub","sub-message",3,"2026-08-15T12:01:00.000Z"),line({type:"assistant",timestamp:iso,message:{id:"no-usage",model:"claude"}})]}
 ]);
 assert.equal(events.length,4); assert.equal(events.find(event=>event.key==="message").output,4); assert.equal(events.find(event=>event.key==="message").total,17); assert.equal(events.find(event=>event.key==="message").cacheWrite5m,1); assert.equal(events.find(event=>event.key==="sub-message").kind,"subagent"); assert.equal(JSON.stringify(events).includes("PRIVATE_SENTINEL"),false);
});

test("Codex maintains high-water deltas through stale updates, cache-only changes, resumes, model changes and archived files", () => {
 const token=(total,input,output,cache=0,write=0,reasoning=0) => line({timestamp:iso,type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{total_tokens:total,input_tokens:input,output_tokens:output,cached_input_tokens:cache,cache_write_input_tokens:write,reasoning_output_tokens:reasoning}}}});
 const meta=(id,threadSource="user")=>line({type:"session_meta",payload:{id,session_id:"logical",thread_source:threadSource,model_provider:"openai",apiKey:"CODEX_CREDENTIAL_SENTINEL"}});
 const copiedRootMeta=meta("root");
 const events=collectLines("codex",[{path:"/sessions/one.jsonl",lines:[meta("root"),line({type:"turn_context",payload:{model:"gpt-a"}}),token(10,7,3,2,1,1),token(10,7,3,2,1,1),token(12,7,3,4,1,1)]},{path:"/archived/two.jsonl",lines:[meta("child","subagent"),copiedRootMeta,line({type:"turn_context",payload:{model:"gpt-b"}}),token(10,7,3,2,1,1),token(18,12,6,5,2,2),token(16,10,6,5,2,2)]}]);
 assert.equal(events.reduce((sum,event)=>sum+event.total,0),30); assert.equal(events.reduce((sum,event)=>sum+event.input,0),9); assert.equal(events.reduce((sum,event)=>sum+event.cacheRead,0),9); assert.equal(events.at(-1).model,"gpt-b"); assert.equal(events.at(-1).kind,"subagent"); assert.ok(events.every(event=>event.reasoning <= event.output)); assert.equal(JSON.stringify(events).includes("CODEX_CREDENTIAL_SENTINEL"),false);
});

test("Codex incremental imports retain rollout identity and model state across appends", async () => {
 const root=await fixture(); try {
  const codex=join(root,"codex"), file=join(codex,"rollout.jsonl");
  const meta=line({type:"session_meta",payload:{id:"rollout",session_id:"thread",thread_source:"subagent",model_provider:"openai"}});
  const context=line({type:"turn_context",payload:{model:"gpt-a"}});
  const token=(total,input,output)=>line({timestamp:iso,type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{total_tokens:total,input_tokens:input,output_tokens:output}}}});
  await jsonl(file,[meta,context,token(10,7,3)]);
  let result=await importAll({codex});
  assert.equal(result.events.reduce((sum,event)=>sum+event.total,0),10);
  await writeFile(file,`${token(18,12,6)}\n`,{flag:"a"});
  result=await importAll({codex},result.index);
  const events=result.events.filter(event=>event.source==="codex");
  assert.equal(events.reduce((sum,event)=>sum+event.total,0),18);
  assert.ok(events.every(event=>event.sessionId==="rollout"&&event.model==="gpt-a"&&event.kind==="subagent"));
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("Grok reads nested update usage, splits modelUsage, deduplicates prompts and keeps integer ticks", () => {
 const turn=line({timestamp:1786816800,params:{sessionId:"s",update:{sessionUpdate:"turn_completed",prompt_id:"p",credential:"GROK_CREDENTIAL_SENTINEL",usage:{inputTokens:12,outputTokens:6,totalTokens:18,cachedReadTokens:2,cacheCreationTokens:1,reasoningTokens:4,costUsdTicks:600000000,modelUsage:{"grok-a":{inputTokens:10,outputTokens:5,cachedReadTokens:2,cacheCreationTokens:1,reasoningTokens:3,totalTokens:15,costUsdTicks:500000000},"grok-b":{inputTokens:2,outputTokens:1,cachedReadTokens:0,cacheCreationTokens:0,reasoningTokens:1,totalTokens:3,costUsdTicks:100000000}}}}}});
 const events=collectLines("grok",[{path:"/grok/s/updates.jsonl",lines:[turn,turn]}]);
 assert.equal(events.length,2); assert.equal(events.reduce((sum,event)=>sum+event.input,0),9); assert.equal(events.reduce((sum,event)=>sum+event.costNativeTicks,0),600000000); assert.deepEqual(events.map(event=>event.model).sort(),["grok-a","grok-b"]); assert.equal(JSON.stringify(events).includes("GROK_CREDENTIAL_SENTINEL"),false);
});

test("incremental import is idempotent, skips a torn tail, then imports its completed append without retaining prompt content", async () => {
 const root=await fixture(); try {
  const pi=join(root,"pi"), indexPath=join(root,"index","usage.json"), file=join(pi,"one.jsonl");
  const row=line({type:"message",id:"one",timestamp:iso,message:{role:"assistant",provider:"anthropic",model:"claude",content:"PRIVATE_SENTINEL",usage:piUsage}});
  await jsonl(file,[line({type:"session",id:"one"}),row]);
  let index=await loadIndex(indexPath); let result=await importAll({pi},index); index=result.index; assert.equal(result.events.length,1);
  result=await importAll({pi},index); assert.equal(result.events.length,1);
  await writeFile(file,line({type:"message",id:"two",timestamp:iso,message:{role:"assistant",usage:piUsage}}),{flag:"a"});
  result=await importAll({pi},index); assert.equal(result.events.length,1);
  await writeFile(file,"\n",{flag:"a"}); result=await importAll({pi},result.index); assert.equal(result.events.length,2); assert.equal(JSON.stringify(result.index).includes("PRIVATE_SENTINEL"),false);
  await saveIndex(indexPath,result.index); assert.deepEqual(await loadIndex(indexPath),result.index); assert.equal((await readFile(indexPath,"utf8")).includes("PRIVATE_SENTINEL"),false);
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("bounded JSONL scanner and terminal input sanitizers handle oversized and escaped data", () => {
 const oversized=Buffer.alloc(1024,"x"); const scanned=scanJsonlChunks([oversized,Buffer.from("\n{\"ok\":true}\n")],128);
 assert.equal(scanned.skipped,1); assert.deepEqual(scanned.lines,["{\"ok\":true}"]); assert.ok(MAX_JSONL_LINE_BYTES >= 64 * 1024 * 1024);
 assert.equal(sanitizeLabel("safe\x1b]8;;https://bad\x07name\x1b]8;;\x07\n"),"safename");
 assert.equal(sanitizeFilterInput("\x1b[A"),""); assert.equal(sanitizeFilterInput("\x1b[200~qwen max\x1b[201~"),"qwen max"); assert.equal(sanitizeFilterInput(" ")," ");
});

test("registry pricing mapping keeps complete tiers without credentials and excludes unusable models", () => {
 const models=pricingModelsFromRegistry([{provider:"p",id:"a",name:"A",cost:{input:1,output:2,cacheRead:.1,cacheWrite:1,tiers:[{inputTokensAbove:10,input:2,output:3,cacheRead:.2,cacheWrite:2}]}},{provider:"p",id:"a",name:"duplicate",cost:{input:1,output:2,cacheRead:.1,cacheWrite:1}},{provider:"p",id:"bad",cost:{input:1,output:2,cacheRead:.1,cacheWrite:1,tiers:[{inputTokensAbove:1,input:2}]}},{provider:"p",id:"zero",cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]);
 assert.equal(models.length,1); assert.equal(models[0].cost.tiers.length,1); assert.equal(models[0].name,"A");
 assert.deepEqual(sourceRoots("/home/user","/agent"),{pi:join("/agent","sessions"),claude:join("/home/user",".claude","projects"),codex:[join("/home/user",".codex","sessions"),join("/home/user",".codex","archived_sessions")],grok:join("/home/user",".grok","sessions")});
});

test("Codex and Grok sentinels never survive persisted imports", async () => {
 const root=await fixture(); try {
  const codex=join(root,"codex"), grok=join(root,"grok"), indexPath=join(root,"index","usage.json");
  await jsonl(join(codex,"rollout.jsonl"),[line({type:"session_meta",payload:{id:"rollout",model_provider:"openai",credential:"CODEX_PERSIST_SENTINEL"}}),line({type:"turn_context",payload:{model:"gpt",prompt:"CODEX_PROMPT_SENTINEL"}}),line({timestamp:iso,type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{total_tokens:4,input_tokens:3,output_tokens:1}}}})]);
  await jsonl(join(grok,"session","updates.jsonl"),[line({timestamp:1786816800,params:{credential:"GROK_PERSIST_SENTINEL",update:{sessionUpdate:"turn_completed",prompt_id:"p",prompt:"GROK_PROMPT_SENTINEL",usage:{inputTokens:3,outputTokens:1,totalTokens:4}}}})]);
  const result=await importAll({codex,grok}); await saveIndex(indexPath,result.index); const persisted=await readFile(indexPath,"utf8"); assert.equal(/CODEX_|GROK_/.test(persisted),false);
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("PAYG estimates apply model tiers and long-cache pricing", () => {
 const totals={input:1_000_000,output:500_000,cacheRead:2_000_000,cacheWrite:1_000_000,cacheWrite1h:250_000};
 const model={cost:{input:2,output:10,cacheRead:.2,cacheWrite:2.5,tiers:[{inputTokensAbove:3_000_000,input:3,output:12,cacheRead:.3,cacheWrite:3.75}]}};
 assert.equal(estimateModelCost([totals],model),13.9125);
 assert.equal(estimateModelCost([{input:2_000_000},{input:2_000_000}],model),8);
 assert.equal(estimateModelCost([{cacheWrite:1_000_000,cacheWrite1h:2_000_000}],{cost:{input:2,output:10,cacheRead:.2,cacheWrite:2.5}}),4);
 assert.equal(estimateModelCost([{input:4_000_000}],{cost:{input:2,output:10,cacheRead:.2,cacheWrite:2.5,tiers:[{inputTokensAbove:3_000_000,input:3}]}}),undefined);
});

test("the packaged entrypoint registers and runs /usage against an isolated agent directory", async t => {
 const root=await fixture(); try {
  const entry=join(dirname(fileURLToPath(import.meta.url)),"index.ts"), agent=join(root,"agent");
  const run=spawnSync("pi",["--offline","--no-extensions","-e",entry,"--no-session","-p","/usage today"],{env:{...process.env,HOME:root,PI_CODING_AGENT_DIR:agent},encoding:"utf8",timeout:30_000});
  if (run.error?.code === "ENOENT") { t.skip("pi executable is unavailable"); return; }
  assert.equal(run.status,0,run.stderr); const index=await loadIndex(join(agent,"pi-usage","index.json")); assert.equal(index.version,7);
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("cost classification, exact rolling boundaries, private saves, and absent roots reconcile", async () => {
 const now=new Date("2026-08-16T12:00:00Z"), event=(day,costBasis="unavailable",costUsd)=>({source:"pi",provider:"p",model:"m",key:day,timestamp:Date.parse(`${day}T12:00:00Z`),input:0,output:0,cacheRead:0,cacheWrite:0,total:0,costBasis,...(costUsd===undefined?{}:{costUsd})});
 const events=[event("2026-08-10"),event("2026-08-09"),event("2026-07-18"),event("2026-07-17"),event("2026-08-16","recorded",0),event("2026-08-16","estimated",2),{...event("2026-08-16","recorded"),key:"ticks",costNativeTicks:1_000_000_000}];
 assert.equal(eventsForPeriod(events,"7d",now,"UTC").length,4); assert.equal(eventsForPeriod(events,"30d",now,"UTC").length,6); const totals=totalsForPeriod(events); assert.equal(totals.recordedCostItems,2); assert.equal(totals.recordedCost,.1); assert.equal(totals.estimatedCostItems,1); assert.equal(totals.unavailableCost,4);
 const piWithoutCost=collectLines("pi",[{path:"/pi.jsonl",lines:[line({type:"message",id:"no-cost",timestamp:iso,message:{role:"assistant",usage:{input:1,output:1,totalTokens:2}}})]}]); assert.equal(piWithoutCost[0].costBasis,"unavailable");
 const grokWithoutCost=collectLines("grok",[{path:"/grok/s/updates.jsonl",lines:[line({timestamp:1786816800,params:{sessionId:"s",update:{sessionUpdate:"turn_completed",prompt_id:"p",usage:{inputTokens:1,outputTokens:1,totalTokens:2}}}})]}]); assert.equal(grokWithoutCost[0].costBasis,"unavailable");
 const root=await fixture(); try { const indexPath=join(root,"private","index.json"); await Promise.all([saveIndex(indexPath,{version:7,events:[],files:{},codex:{}}),saveIndex(indexPath,{version:7,events:[],files:{},codex:{}})]); assert.equal((await stat(indexPath)).mode & 0o777,0o600); assert.equal((await stat(join(root,"private"))).mode & 0o777,0o700); let result=await importAll({pi:join(root,"gone")},{version:7,events:[event("2026-08-16")],files:{[join(root,"gone","x")]:{source:"pi"}},codex:{}}); assert.equal(result.events.length,0); assert.equal(result.health[0].reconciled,true); } finally { await rm(root,{recursive:true,force:true}); }
});

test("a file removed between walk and read is skipped without failing the import", async () => {
 const root=await fixture(); try { const pi=join(root,"pi"), file=join(pi,"one.jsonl"); await jsonl(file,[line({type:"session",id:"one"}),line({type:"message",id:"one",timestamp:iso,message:{role:"assistant",usage:piUsage}})]); const result=await importAll({pi},undefined,{beforeRead:async path=>rm(path,{force:true})}); assert.equal(result.events.length,0); assert.equal(result.health[0].status,"partial"); } finally { await rm(root,{recursive:true,force:true}); }
});

test("truncation and deleted files reconcile the index, malformed timestamps are skipped, and periods use local dates", async () => {
 const root=await fixture(); try {
  const pi=join(root,"pi"), one=join(pi,"one.jsonl"), two=join(pi,"two.jsonl"); const good=id=>line({type:"message",id,timestamp:iso,message:{role:"assistant",usage:piUsage}});
  await jsonl(one,[line({type:"session",id:"one"}),good("a")]); await jsonl(two,[line({type:"session",id:"two"}),good("b")]);
  let result=await importAll({pi}); assert.equal(result.events.length,2);
  await truncate(two,0); result=await importAll({pi},result.index); assert.equal(result.events.length,1); assert.equal(result.health[0].reconciled,true);
  const invalid=line({type:"message",id:"bad",timestamp:"not-a-date",message:{role:"assistant",usage:piUsage}}); await writeFile(one,`\n${invalid}\n`,{flag:"a"}); result=await importAll({pi},result.index); assert.equal(result.events.length,1); assert.equal(result.health[0].status,"partial");
  const event={...result.events[0],timestamp:Date.parse("2026-08-15T23:30:00.000Z")};
  const monthStart={...event,key:"month-start",timestamp:Date.parse("2026-08-01T19:00:00.000Z")};
  const previousMonth={...event,key:"previous-month",timestamp:Date.parse("2026-08-01T06:00:00.000Z")};
  const old={...event,key:"old",timestamp:Date.parse("2026-07-15T23:30:00.000Z")};
  assert.equal(totalsForPeriod([event,old],"today",new Date("2026-08-16T01:00:00Z"),"America/Los_Angeles").requests,1);
  assert.equal(totalsForPeriod([event,monthStart,previousMonth],"month",new Date("2026-08-16T01:00:00Z"),"America/Los_Angeles").requests,2);
 } finally { await rm(root,{recursive:true,force:true}); }
});
