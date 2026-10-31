import { it, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { startServer } from "../src/server/server";
import { loadGraph, saveGraph, withGraphLock } from "../src/storage";

it("CLI and HTTP refuse blocked completion and allow completion after prerequisites", async () => {
  const data = mkdtempSync(join(tmpdir(), "dagdo-blocked-"));
  const original = process.env.DAGDO_DATA_DIR;
  process.env.DAGDO_DATA_DIR = data;
  const server = await startServer({ preferredPort: 0 });
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args], {
      env: { ...process.env, DAGDO_DATA_DIR: data, DAGDO_LOCAL_MODE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { out, err, code };
  };
  const patch = (id: string, body: unknown) => fetch(`${server.url}/api/projects/default/tasks/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), proxy: "",
  });
  try {
    await withGraphLock(() => saveGraph({
      version: 1,
      tasks: ["aaa111", "bbb222"].map(id => ({
        id, title: id, progress: "in_progress", createdAt: "2026-01-01T00:00:00Z", doneAt: null,
      })),
      edges: [{ from: "aaa111", to: "bbb222" }],
    }));
    const before = readFileSync(join(data, "data.json"), "utf8");
    const denied = await cli("done", "bbb222");
    expect(denied.code).toBe(1);
    expect(denied.err).toContain("blocked");
    for (const flag of ["--force", "-f"]) {
      expect((await cli("done", "bbb222", flag)).code).not.toBe(0);
    }
    const response = await patch("bbb222", { doneAt: "2026-01-02T00:00:00Z", title: "Must not change" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "task_blocked" });
    expect(readFileSync(join(data, "data.json"), "utf8")).toBe(before);

    // A batch can complete prerequisites before dependents in the same call.
    expect((await cli("done", "aaa111", "bbb222")).code).toBe(0);
    expect((await loadGraph()).tasks.every(t => t.doneAt != null && t.progress === "in_progress")).toBe(true);
    expect((await patch("bbb222", { doneAt: null })).status).toBe(200);
    expect((await patch("bbb222", { doneAt: "2026-01-02T00:00:00Z" })).status).toBe(200);
    // Reopening a prerequisite blocks the dependent again once it is reopened.
    expect((await patch("aaa111", { doneAt: null })).status).toBe(200);
    expect((await patch("bbb222", { doneAt: null })).status).toBe(200);
    expect((await patch("bbb222", { doneAt: "2026-01-02T00:00:00Z" })).status).toBe(409);
  } finally {
    await server.stop();
    if (original === undefined) delete process.env.DAGDO_DATA_DIR;
    else process.env.DAGDO_DATA_DIR = original;
    rmSync(data, { recursive: true, force: true });
  }
});

it("real HTTP and parallel CLI writers preserve Unicode tasks, dependencies and safe recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "dagdo-integration-"));
  const data = join(root,"data");
  const backups = join(root,"backups");
  const original = process.env.DAGDO_DATA_DIR;
  process.env.DAGDO_DATA_DIR = data;
  const env = {...process.env, DAGDO_DATA_DIR:data, DAGDO_BACKUP_DIR:backups, DAGDO_LOCAL_MODE:"1"};
  const app = resolve(import.meta.dir,"..");
  const cli = async (...args:string[]) => {
    const child = Bun.spawn([process.execPath, join(app,"src/cli.ts"), ...args], {cwd:root, env, stdout:"pipe", stderr:"pipe"});
    const out = await new Response(child.stdout).text(), err = await new Response(child.stderr).text();
    return {code:await child.exited, out, err};
  };
  const local = async (...args:string[]) => {
    const child = Bun.spawn([process.execPath,join(app,"scripts/local.ts"),...args],{cwd:root,env,stdout:"pipe",stderr:"pipe"});
    const out=await new Response(child.stdout).text(); const err=await new Response(child.stderr).text();
    expect(await child.exited,err).toBe(0); return out.trim();
  };
  const server = await startServer({preferredPort:0});
  try {
    await saveGraph({version:1,tasks:[],edges:[]});
    const request = (route:string, method:string, body:unknown) => fetch(server.url+route,{method,body:JSON.stringify(body),headers:{"Content-Type":"application/json"},proxy:""});
    const results=await Promise.all([
      ...Array.from({length:16},(_,i)=>cli("add","CLI task \u{1F527} "+i).then(r=>expect(r.code,r.err).toBe(0))),
      ...Array.from({length:16},(_,i)=>request("/api/projects/default/tasks","POST",{title:"UI task \u{1F4DD} "+i}).then(r=>expect(r.status).toBe(201))),
    ]);
    const graph=await loadGraph(); expect(graph.tasks).toHaveLength(32);
    const a=graph.tasks[0]!.id,b=graph.tasks[1]!.id;
    expect((await cli("link",a,"--before",b)).code).toBe(0);
    expect((await request("/api/projects/default/edges","POST",{from:b,to:a})).status).toBe(409);
    expect((await cli("link",b,"--before",a)).code).toBe(1);
    expect((await request("/api/projects/default/tasks/"+a,"PATCH",{title:"Edited in UI \u{1F4DD}"})).status).toBe(200);
    expect((await cli("list")).out).toContain("Edited in UI \u{1F4DD}");
    expect((await cli("edit",a,"--title","Edited by agent \u{1F527}")).code).toBe(0);
    const visible=await (await fetch(server.url+"/api/projects/default/graph",{proxy:""})).json() as any;
    expect(visible.tasks.find((t:any)=>t.id===a).title).toBe("Edited by agent \u{1F527}");
    let snapshot=await local("backup");
    expect(JSON.parse(readFileSync(join(snapshot,"data.json"),"utf8")).projects[0].tasks).toHaveLength(32);
    expect((await cli("add","Removed by restore")).code).toBe(0);
    await local("restore",snapshot); expect((await loadGraph()).tasks).toHaveLength(32);
    for(let i=0;i<31;i++) snapshot=await local("backup");
    expect(readdirSync(backups).filter(n=>/^\d{4}-/.test(n))).toHaveLength(30);
    const stableBytes = readFileSync(join(data,"data.json"),"utf8");
    const unserializable = await loadGraph(); (unserializable as any).self = unserializable;
    await expect(saveGraph(unserializable)).rejects.toThrow();
    expect(readFileSync(join(data,"data.json"),"utf8")).toBe(stableBytes);
    expect(readdirSync(data).filter(n=>n.endsWith(".tmp"))).toHaveLength(0);
    // A live holder times out; after a killed holder, the next real CLI recovers.
    const holder=Bun.spawn([process.execPath,"-e", 'import {writeFileSync} from "fs"; import {withGraphLock,globalDataFile} from '+JSON.stringify(join(app,"src/storage.ts"))+'; await withGraphLock(async()=>{writeFileSync(globalDataFile()+".interrupted.tmp","{partial");console.log("locked");setInterval(()=>{},1000);await new Promise(()=>{});});'],{env,stdout:"pipe",stderr:"pipe"});
    const reader=holder.stdout.getReader(); await reader.read();
    try { await expect(withGraphLock(async()=>{},100)).rejects.toThrow("timed out"); }
    finally { holder.kill(); await holder.exited; reader.releaseLock(); }
    expect(readFileSync(join(data,"data.json"),"utf8")).toBe(stableBytes);
    expect((await cli("add","Recovered after interrupted write")).code).toBe(0);
    const file=join(data,"data.json"), bytes=readFileSync(file,"utf8");
    writeFileSync(file,"{broken");
    expect((await cli("add","Must not save")).code).not.toBe(0);
    expect(readFileSync(file,"utf8")).toBe("{broken");
    expect((await request("/api/projects/default/tasks","POST",{title:"Must not save"})).status).toBe(500);
    expect(readFileSync(file,"utf8")).toBe("{broken");
    await local("restore",snapshot); expect((await loadGraph()).tasks).toHaveLength(32);
    expect((await cli("upgrade")).code).toBe(1);
    expect((await cli("sync")).code).toBe(1);
    // Strict local UI mode must fail instead of silently selecting another port.
    const conflict=Bun.spawn([process.execPath,join(app,"src/cli.ts"),"ui","--port",String(server.port),"--no-open"],{env,stdout:"pipe",stderr:"pipe"});
    expect(await conflict.exited).not.toBe(0);
  } finally { await server.stop(); if(original===undefined)delete process.env.DAGDO_DATA_DIR; else process.env.DAGDO_DATA_DIR=original; }
},60000);
