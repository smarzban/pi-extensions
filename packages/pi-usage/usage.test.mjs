import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectLines, importAll, loadIndex, saveIndex, totalsForPeriod } from "./core.mjs";

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
 const meta=(id,threadSource="user")=>line({type:"session_meta",payload:{id,session_id:"logical",thread_source:threadSource,model_provider:"openai"}});
 const copiedRootMeta=meta("root");
 const events=collectLines("codex",[{path:"/sessions/one.jsonl",lines:[meta("root"),line({type:"turn_context",payload:{model:"gpt-a"}}),token(10,7,3,2,1,1),token(10,7,3,2,1,1),token(12,7,3,4,1,1)]},{path:"/archived/two.jsonl",lines:[meta("child","subagent"),copiedRootMeta,line({type:"turn_context",payload:{model:"gpt-b"}}),token(10,7,3,2,1,1),token(18,12,6,5,2,2),token(16,10,6,5,2,2)]}]);
 assert.equal(events.reduce((sum,event)=>sum+event.total,0),30); assert.equal(events.reduce((sum,event)=>sum+event.cacheRead,0),9); assert.equal(events.at(-1).model,"gpt-b"); assert.equal(events.at(-1).kind,"subagent"); assert.ok(events.every(event=>event.reasoning <= event.output));
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
 const turn=line({timestamp:1786816800,params:{sessionId:"s",update:{sessionUpdate:"turn_completed",prompt_id:"p",usage:{inputTokens:12,outputTokens:6,totalTokens:18,cachedReadTokens:2,cacheCreationTokens:1,reasoningTokens:4,costUsdTicks:600000000,modelUsage:{"grok-a":{inputTokens:10,outputTokens:5,cachedReadTokens:2,cacheCreationTokens:1,reasoningTokens:3,totalTokens:15,costUsdTicks:500000000},"grok-b":{inputTokens:2,outputTokens:1,cachedReadTokens:0,cacheCreationTokens:0,reasoningTokens:1,totalTokens:3,costUsdTicks:100000000}}}}}});
 const events=collectLines("grok",[{path:"/grok/s/updates.jsonl",lines:[turn,turn]}]);
 assert.equal(events.length,2); assert.equal(events.reduce((sum,event)=>sum+event.costNativeTicks,0),600000000); assert.deepEqual(events.map(event=>event.model).sort(),["grok-a","grok-b"]);
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

test("truncation and deleted files reconcile the index, malformed timestamps are skipped, and periods use local dates", async () => {
 const root=await fixture(); try {
  const pi=join(root,"pi"), one=join(pi,"one.jsonl"), two=join(pi,"two.jsonl"); const good=id=>line({type:"message",id,timestamp:iso,message:{role:"assistant",usage:piUsage}});
  await jsonl(one,[line({type:"session",id:"one"}),good("a")]); await jsonl(two,[line({type:"session",id:"two"}),good("b")]);
  let result=await importAll({pi}); assert.equal(result.events.length,2);
  await truncate(two,0); result=await importAll({pi},result.index); assert.equal(result.events.length,1); assert.equal(result.health[0].reconciled,true);
  const invalid=line({type:"message",id:"bad",timestamp:"not-a-date",message:{role:"assistant",usage:piUsage}}); await writeFile(one,`\n${invalid}\n`,{flag:"a"}); result=await importAll({pi},result.index); assert.equal(result.events.length,1); assert.equal(result.health[0].status,"partial");
  const event={...result.events[0],timestamp:Date.parse("2026-08-15T23:30:00.000Z")};
  const old={...event,key:"old",timestamp:Date.parse("2026-07-15T23:30:00.000Z")};
  assert.equal(totalsForPeriod([event,old],"today",new Date("2026-08-16T01:00:00Z"),"America/Los_Angeles").requests,1);
 } finally { await rm(root,{recursive:true,force:true}); }
});
