import { parseArgs } from "util";
import { writeFileSync } from "fs";
import { loadGraph } from "../storage";
import { buildActiveGraph, buildFullGraph } from "../graph/dag";
import { renderAscii, renderMermaid, renderDot } from "../graph/render";
import { describeTask } from "../task-state";
import { printJson } from "./shared";

export async function graphCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      mermaid: { type: "boolean", default: false },
      png: { type: "string" },
      dot: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });

  const data = await loadGraph();
  const mapData = { ...data, tasks: data.tasks.filter(t => t.progress !== "backlog") };
  const graph = values.all ? buildFullGraph(mapData) : buildActiveGraph(mapData);

  if (values.json) {
    printJson({
      tasks: [...graph.tasks.values()].map((t) => describeTask(t, data.tasks, data.edges)),
      edges: data.edges.filter((e) => graph.tasks.has(e.from) && graph.tasks.has(e.to)),
    });
    return;
  }

  if (values.mermaid) {
    console.log(renderMermaid(graph));
    return;
  }

  if (values.png != null) {
    const outFile = (values.png as string) || "dagdo.png";
    if (values.dot) {
      await renderWithGraphviz(graph, outFile);
    } else {
      await renderWithMermaid(graph, outFile);
    }
    return;
  }

  console.log(renderAscii(graph));
}

async function renderWithMermaid(graph: Parameters<typeof renderMermaid>[0], outFile: string): Promise<void> {
  let createMermaidRenderer: any;
  try {
    const mod = await import("mermaid-isomorphic");
    createMermaidRenderer = mod.createMermaidRenderer;
  } catch {
    console.error("Mermaid rendering requires mermaid-isomorphic.");
    console.error("Install it: bun add mermaid-isomorphic");
    process.exit(1);
  }

  const renderer = createMermaidRenderer();
  const mermaidSyntax = renderMermaid(graph);
  const results = await renderer([mermaidSyntax]);
  const result = results[0] as any;
  const svg: string = result.value?.svg ?? result.svg;
  if (!svg) {
    console.error("Mermaid rendering failed.");
    process.exit(1);
  }

  if (outFile.endsWith(".svg")) {
    writeFileSync(outFile, svg);
    console.log(`Saved: ${outFile}`);
    return;
  }

  // Use playwright (already loaded by mermaid-isomorphic) for PNG
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;background:white">${svg}</body></html>`);
  const svgEl = await page.$("svg");
  if (!svgEl) {
    console.error("Failed to render SVG.");
    await browser.close();
    process.exit(1);
  }
  const pngBuffer = await svgEl.screenshot({ type: "png", omitBackground: false });
  await browser.close();
  writeFileSync(outFile, pngBuffer);
  console.log(`Saved: ${outFile}`);
}

async function renderWithGraphviz(graph: Parameters<typeof renderDot>[0], outFile: string): Promise<void> {
  let Graphviz: any;
  try {
    const mod = await import("@hpcc-js/wasm-graphviz");
    Graphviz = mod.Graphviz;
  } catch {
    console.error("Graphviz rendering requires @hpcc-js/wasm-graphviz.");
    console.error("Install it: bun add @hpcc-js/wasm-graphviz");
    process.exit(1);
  }

  const graphviz = await Graphviz.load();
  const dot = renderDot(graph);
  const svg = graphviz.layout(dot, "svg", "dot");

  if (outFile.endsWith(".svg")) {
    writeFileSync(outFile, svg);
    console.log(`Saved: ${outFile}`);
    return;
  }

  let Resvg: any;
  try {
    const mod = await import("@resvg/resvg-js");
    Resvg = mod.Resvg;
  } catch {
    console.error("PNG rendering requires @resvg/resvg-js.");
    console.error("Install it: bun add @resvg/resvg-js");
    process.exit(1);
  }

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  writeFileSync(outFile, pngBuffer);
  console.log(`Saved: ${outFile}`);
}
