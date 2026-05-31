import http from "node:http";

const port = Number(process.env.NGROK_ROUTER_PORT ?? 3099);
const host = process.env.NGROK_ROUTER_HOST ?? "127.0.0.1";
const sentinelTarget = new URL(process.env.SENTINELSCOPE_TARGET ?? "http://127.0.0.1:3005");
const videoTarget = new URL(process.env.VIDEO_UNIVERSAL_TARGET ?? "http://127.0.0.1:3333");

const server = http.createServer((request, response) => {
  const originalUrl = new URL(request.url ?? "/", "http://local-router");

  if (originalUrl.pathname === "/__router/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(
      JSON.stringify({
        ok: true,
        routes: {
          "/vu": videoTarget.origin,
          "/": sentinelTarget.origin
        }
      })
    );
    return;
  }

  const isVideoRoute = originalUrl.pathname === "/vu" || originalUrl.pathname.startsWith("/vu/");
  const target = isVideoRoute ? videoTarget : sentinelTarget;
  const targetPath = isVideoRoute
    ? `${originalUrl.pathname.replace(/^\/vu(?=\/|$)/, "") || "/"}${originalUrl.search}`
    : `${originalUrl.pathname}${originalUrl.search}`;

  proxyRequest(request, response, target, targetPath);
});

server.listen(port, host, () => {
  console.log(`ngrok router online em http://${host}:${port}`);
  console.log(`/vu -> ${videoTarget.origin}`);
  console.log(`/ -> ${sentinelTarget.origin}`);
});

function proxyRequest(request, response, target, targetPath) {
  const headers = { ...request.headers, host: target.host };
  delete headers.connection;
  delete headers["content-length"];

  const proxy = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: request.method,
      path: targetPath,
      headers
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    }
  );

  proxy.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }

    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: "Router local nao conseguiu acessar a aplicacao de destino." }));
  });

  request.pipe(proxy);
}
