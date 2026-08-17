import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePurchase, serializeRecommendation } from "./engine.ts";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "public");
const monitoring = {
  streams: [
    { streamId: "rewards.payments.daily", status: "healthy", lastTerminalRunAt: "2026-08-17T09:06:00+09:00", findingCount: 0, note: "Completed successfully with zero findings." },
    { streamId: "rewards.transfer.daily", status: "overdue", lastTerminalRunAt: "2026-08-15T09:00:00+09:00", findingCount: 0, note: "A run was expected but never arrived; related sources are stale." },
    { streamId: "rewards.security.fixture", status: "quarantined", lastTerminalRunAt: "2026-08-17T10:02:00+09:00", findingCount: 1, note: "Hostile 100% reward claim rejected; canonical evidence remains empty." }
  ],
  realtimeRequired: false,
};
function json(res: any, status: number, body: unknown) { const text = JSON.stringify(body, null, 2); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) }); res.end(text); }
function contentType(path: string) { return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" } as Record<string,string>)[extname(path)] ?? "application/octet-stream"; }
const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok: true, service: "rewards-prototype", version: "0.4.1" });
    if (req.method === "GET" && req.url === "/api/monitoring") return json(res, 200, monitoring);
    if (req.method === "POST" && req.url === "/api/evaluate") { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const input = JSON.parse(Buffer.concat(chunks).toString("utf8")); return json(res, 200, serializeRecommendation(evaluatePurchase(input))); }
    const requestPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
    const safe = normalize(requestPath).replace(/^(\.\.[/\\])+/, ""); const path = join(root, safe);
    if (!path.startsWith(root)) return json(res, 403, { error: "forbidden" });
    const body = await readFile(path); res.writeHead(200, { "content-type": contentType(path) }); res.end(body);
  } catch (error: any) { if (error?.code === "ENOENT") return json(res, 404, { error: "not_found" }); return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(Number(process.env.PORT ?? 8788), () => console.log("Rewards prototype: http://localhost:8788"));
