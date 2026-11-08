// What a Worker imports from `cloudflare:workers`, for a Worker run in Node (lib/workers.mjs points
// that name here): a named entrypoint is a class with the Worker's settings as this.env.
export class WorkerEntrypoint {
  constructor(ctx, env) { this.ctx = ctx; this.env = env }
}
