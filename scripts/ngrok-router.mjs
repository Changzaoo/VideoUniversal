import crypto from "node:crypto";
import http from "node:http";

const port = Number(process.env.NGROK_ROUTER_PORT ?? 3099);
const host = process.env.NGROK_ROUTER_HOST ?? "127.0.0.1";
const sentinelTarget = new URL(process.env.SENTINELSCOPE_TARGET ?? "http://127.0.0.1:3005");
const videoTarget = new URL(process.env.VIDEO_UNIVERSAL_TARGET ?? "http://127.0.0.1:3333");
const videoAccessToken = process.env.VIDEO_UNIVERSAL_PC_TOKEN?.trim() ?? "";
const videoAccessHeader = "x-video-universal-key";

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
  if (isVideoRoute && !isPublicVideoRoute(request, originalUrl)) {
    if (!videoAccessToken) {
      sendJson(response, 503, { error: "Router local sem chave de acesso configurada." });
      return;
    }

    if (!isVideoRequestAuthorized(request)) {
      sendJson(response, 401, { error: "Chave de acesso do PC invalida ou ausente." });
      return;
    }
  }

  const target = isVideoRoute ? videoTarget : sentinelTarget;
  const targetPath = isVideoRoute
    ? `${originalUrl.pathname.replace(/^\/vu(?=\/|$)/, "") || "/"}${originalUrl.search}`
    : `${originalUrl.pathname}${originalUrl.search}`;

  proxyRequest(request, response, target, targetPath, [videoAccessHeader]);
});

server.listen(port, host, () => {
  console.log(`ngrok router online em http://${host}:${port}`);
  console.log(`/vu -> ${videoTarget.origin}${videoAccessToken ? " protegido por chave" : " sem chave configurada"}`);
  console.log(`/ -> ${sentinelTarget.origin}`);
});

function proxyRequest(request, response, target, targetPath, droppedHeaders = []) {
  const headers = { ...request.headers, host: target.host };
  delete headers.connection;
  delete headers["content-length"];
  for (const header of droppedHeaders) {
    delete headers[header.toLowerCase()];
  }

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

function isPublicVideoRoute(request, originalUrl) {
  return (request.method === "GET" || request.method === "HEAD") && originalUrl.pathname === "/vu/api/health";
}

function isVideoRequestAuthorized(request) {
  const providedToken = getSingleHeader(request.headers[videoAccessHeader]);
  return timingSafeEqual(providedToken, videoAccessToken);
}

function getSingleHeader(value) {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }

  return typeof value === "string" ? value.trim() : "";
}

function timingSafeEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}
