import type { GraphData } from "./types";
export function developmentSample(): GraphData {
  const createdAt = "2026-01-01T00:00:00.000Z";
  return { version: 1, tasks: [
    { id: "sample-design", title: "Sample: Design the screen", progress: "ready", createdAt, doneAt: null },
    { id: "sample-build", title: "Sample: Build the screen", progress: "ready", createdAt, doneAt: null },
    { id: "sample-done", title: "Sample: Complete setup", progress: "ready", createdAt, doneAt: createdAt },
  ], edges: [{ from: "sample-design", to: "sample-build" }] };
}
