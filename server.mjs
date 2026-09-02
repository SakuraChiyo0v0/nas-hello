import { createServer } from "node:http";
import os from "node:os";

const app = "nas-hello";
const version = process.env.APP_VERSION || "dev";
const commit = process.env.APP_COMMIT || "local";
const port = Number(process.env.PORT || 3000);

const server = createServer((req, res) => {
  const body = JSON.stringify(
    {
      app,
      version,
      commit,
      host: os.hostname(),
      time: new Date().toISOString(),
      path: req.url,
    },
    null,
    2
  );
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body + "\n");
});

server.listen(port, () => {
  console.log(`${app} v${version} (${commit}) listening on :${port}`);
});
