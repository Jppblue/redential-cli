import { createServer } from "node:http";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface MockServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

type Handler = (req: RecordedRequest) => { status: number; body: unknown };

/** A real local HTTP server (not a fetch mock) so login/submit are tested
 * against actual network I/O, per the milestone's "mocked local server"
 * requirement — see docs/login-submit.md. */
export function startMockServer(handler: Handler): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const recorded: RecordedRequest = {
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        requests.push(recorded);
        const { status, body } = handler(recorded);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
