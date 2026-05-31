import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] ?? 9222);
const repoRoot = process.cwd();
const cookiesPath = path.join(repoRoot, "youtube.cookies.txt");
const base64Path = path.join(repoRoot, "youtube.cookies.base64.txt");

const targetsResponse = await fetch(`http://127.0.0.1:${port}/json`);

if (!targetsResponse.ok) {
  throw new Error(`CDP nao respondeu na porta ${port}.`);
}

const targets = await targetsResponse.json();
const pageTarget =
  targets.find((target) => target.type === "page" && /youtube\.com/i.test(target.url ?? "")) ??
  targets.find((target) => target.type === "page");
const websocketUrl = pageTarget?.webSocketDebuggerUrl;

if (typeof websocketUrl !== "string") {
  throw new Error("CDP nao retornou webSocketDebuggerUrl.");
}

const cookies = await getAllCookies(websocketUrl);
const allowedDomains = new Set([".youtube.com", "youtube.com", ".google.com", "google.com", "accounts.google.com", "www.google.com"]);
const filteredCookies = cookies.filter((cookie) => {
  const domain = String(cookie.domain ?? "").toLowerCase();
  return allowedDomains.has(domain);
});

if (!filteredCookies.length) {
  throw new Error("Nao encontrei cookies do YouTube/Google no perfil aberto.");
}

const netscape = [
  "# Netscape HTTP Cookie File",
  "# Exported locally for yt-dlp. Keep this file secret.",
  ...filteredCookies
    .sort((left, right) => `${left.domain}\t${left.name}`.localeCompare(`${right.domain}\t${right.name}`))
    .map(formatNetscapeCookie),
  ""
].join("\n");

await fs.writeFile(cookiesPath, netscape, { encoding: "utf8", mode: 0o600 });
await fs.chmod(cookiesPath, 0o600).catch(() => undefined);

const base64 = Buffer.from(netscape, "utf8").toString("base64");
await fs.writeFile(base64Path, base64, { encoding: "utf8", mode: 0o600 });
await fs.chmod(base64Path, 0o600).catch(() => undefined);

console.log(
  JSON.stringify({
    cookiesPath,
    base64Path,
    cookieCount: filteredCookies.length,
    domains: Array.from(new Set(filteredCookies.map((cookie) => cookie.domain))).sort()
  })
);

function getAllCookies(websocketUrl) {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(websocketUrl);
    let nextId = 1;
    const pending = new Map();
    const timer = setTimeout(() => {
      websocket.close();
      reject(new Error("Timeout lendo cookies via CDP."));
    }, 15000);

    websocket.addEventListener("open", async () => {
      try {
        await send("Network.enable");

        for (const request of [
          { method: "Network.getAllCookies" },
          { method: "Storage.getCookies" },
          { method: "Network.getCookies", params: { urls: ["https://www.youtube.com/"] } }
        ]) {
          const payload = await send(request.method, request.params);
          const cookies = payload.result?.cookies;

          if (Array.isArray(cookies)) {
            clearTimeout(timer);
            websocket.close();
            resolve(cookies);
            return;
          }
        }

        throw new Error("CDP sem cookies.");
      } catch (error) {
        clearTimeout(timer);
        websocket.close();
        reject(error);
      }
    });
    websocket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Falha no WebSocket CDP."));
    });
    websocket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data));
      const callbacks = pending.get(payload.id);

      if (!callbacks) {
        return;
      }

      pending.delete(payload.id);

      if (payload.error) {
        callbacks.reject(new Error(payload.error.message ?? "CDP retornou erro."));
        return;
      }

      callbacks.resolve(payload);
    });

    function send(method, params) {
      const id = nextId++;
      websocket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolvePayload, rejectPayload) => {
        pending.set(id, { resolve: resolvePayload, reject: rejectPayload });
      });
    }
  });
}

function formatNetscapeCookie(cookie) {
  const rawDomain = cookie.domain || "";
  const domain = cookie.httpOnly ? `#HttpOnly_${rawDomain}` : rawDomain;
  const includeSubdomains = rawDomain.startsWith(".") ? "TRUE" : "FALSE";
  const pathValue = cookie.path || "/";
  const secure = cookie.secure ? "TRUE" : "FALSE";
  const expires = Number.isFinite(cookie.expires) && cookie.expires > 0 ? Math.floor(cookie.expires) : 0;
  const name = cookie.name ?? "";
  const value = cookie.value ?? "";
  return [domain, includeSubdomains, pathValue, secure, expires, name, value].join("\t");
}
