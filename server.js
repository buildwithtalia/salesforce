const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/sf-proxy")) {
      return handleProxy(req, res);
    }
    return serveStatic(req, res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(ROOT, relPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function handleProxy(req, res) {
  const instanceUrl = req.headers["x-sf-instance-url"];
  const accessToken = req.headers["x-sf-access-token"];
  const apiVersion = req.headers["x-sf-api-version"] || "v66.0";

  if (!instanceUrl || !accessToken) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({ error: "Missing x-sf-instance-url or x-sf-access-token headers." })
    );
  }

  // Strip /sf-proxy prefix; whatever follows is appended to the Salesforce base path.
  const subPath = req.url.replace(/^\/sf-proxy/, "");
  let target;
  try {
    target = new URL(`/services/data/${apiVersion}${subPath}`, instanceUrl);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Invalid instance URL." }));
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const bodyBuf = Buffer.concat(chunks);

    const options = {
      method: req.method,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };
    if (bodyBuf.length) {
      options.headers["Content-Length"] = bodyBuf.length;
    }

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        "Content-Type": proxyRes.headers["content-type"] || "application/json",
      });
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Upstream error: ${err.message}` }));
    });

    if (bodyBuf.length) proxyReq.write(bodyBuf);
    proxyReq.end();
  });
}

server.listen(PORT, () => {
  console.log(`Salesforce Leads app running at http://localhost:${PORT}`);
});
