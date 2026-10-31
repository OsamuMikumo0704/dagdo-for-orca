import { it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { startServer } from "../src/server/server";
import { readStore, withGraphLock } from "../src/storage";

it("migrates tabs and review without loss and isolates projects across API, streams and CLI", async () => {
  const dir=mkdtempSync(join(tmpdir(),"dagdo-projects-"));
  const previous=process.env.DAGDO_DATA_DIR; process.env.DAGDO_DATA_DIR=dir;
  let server:Awaited<ReturnType<typeof startServer>>|undefined;
  let reader:{cancel:()=>Promise<void>}|undefined;
  try {
    const task={id:"aaa111",title:"日本語",progress:"review",tags:["tag"],notes:"memo",createdAt:"2026-01-01",doneAt:null};
    const legacy={version:1,tasks:[task],edges:[],tabs:[{id:"old",name:"Old",taskIds:[task.id]}]};
    await withGraphLock(async()=>writeFileSync(join(dir,"data.json"),JSON.stringify(legacy)));
    const {tags: _removedTags, ...retainedTask} = task;
    expect(readStore().projects[0]!.tasks[0]).toEqual({...retainedTask,progress:"in_progress"});
    expect(JSON.parse(readFileSync(join(dir,"data.json"),"utf8"))).toEqual(legacy);
    server=await startServer({preferredPort:0});
    const request=(path:string,method="GET",body?:unknown)=>fetch(server!.url+"/api/"+path,{method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    const created=await (await request("projects","POST",{name:"Second"})).json() as any;
    const id=created.project.id;
    const streamReader=(await request(`projects/${id}/events`)).body!.getReader();
    reader=streamReader;
    const initial=new TextDecoder().decode((await streamReader.read()).value);
    expect(initial).not.toContain("日本語");
    expect((await request(`projects/${id}/tasks/aaa111`,"PATCH",{title:"Wrong"})).status).toBe(404);
    expect((await request(`projects/${id}/edges`,"POST",{from:"aaa111",to:"bbb222"})).status).toBe(404);
    expect((await request(`projects/${id}/tasks`,"POST",{title:"Invalid",progress:"review"})).status).toBe(400);
    await Promise.all([request("projects/default/tasks","POST",{title:"First only"}),request(`projects/${id}/tasks`,"POST",{title:"Second only"})]);
    const second=await (await request(`projects/${id}/graph`)).json() as any;
    expect(second.tasks.map((t:any)=>t.title)).toEqual(["Second only"]);
    const cli=async(...args:string[])=>{
      const child=Bun.spawn([process.execPath,resolve("src/cli.ts"),...args],{env:{...process.env,DAGDO_DATA_DIR:dir,DAGDO_LOCAL_MODE:"1"},stdout:"pipe",stderr:"pipe"});
      return {code:await child.exited,out:await new Response(child.stdout).text(),err:await new Response(child.stderr).text()};
    };
    expect((await cli("next")).code).not.toBe(0);
    expect((await cli("list","--project",id,"--json")).out).toContain("Second only");
    expect((await cli("list","--project",id,"--json")).out).not.toContain("First only");
    expect(JSON.parse((await cli("projects","--json")).out)).toHaveLength(2);
    expect((await request(`projects/${id}`,"PATCH",{name:"Renamed"})).status).toBe(200);
    await reader.cancel();reader=undefined;
    expect((await request(`projects/${id}`,"DELETE")).status).toBe(200);
    expect((await request("projects/default","DELETE")).status).toBe(409);
    expect(readStore().projects[0]!.tasks).toHaveLength(2);
    expect(readFileSync(join(dir,"data.json"),"utf8")).not.toContain('"tabs"');
    expect(readFileSync(join(dir,"data.json"),"utf8")).not.toContain('"review"');
    expect(readFileSync(join(dir,"data.json"),"utf8")).not.toContain('"tags"');
  } finally {
    await reader?.cancel();await server?.stop();
    if(previous===undefined) delete process.env.DAGDO_DATA_DIR;else process.env.DAGDO_DATA_DIR=previous;
    rmSync(dir,{recursive:true,force:true});
  }
});

