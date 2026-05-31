import cors from "cors";
import type { CorsOptions } from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import morgan from "morgan";
import { nanoid } from "nanoid";
import { z } from "zod";

dotenv.config();

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";
const ytdlpBin = process.env.YTDLP_BIN?.trim() || "yt-dlp";
const ffmpegBin = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
let ytdlpCookiesPath = process.env.YTDLP_COOKIES_PATH?.trim() || "";
const ytdlpProxy = process.env.YTDLP_PROXY?.trim();
const hasConfiguredCookies = hasYtDlpCookiesConfig();
const ytdlpExtractorArgs = process.env.YTDLP_EXTRACTOR_ARGS?.trim() || "youtube:player_client=android_vr";
const ytdlpRemoteComponents = process.env.YTDLP_REMOTE_COMPONENTS?.trim() || (hasConfiguredCookies ? "ejs:github" : "");
const youtubeFallbackClients = getYoutubeFallbackClients(process.env.YTDLP_YOUTUBE_FALLBACK_CLIENTS);
const streamDownloads = process.env.STREAM_DOWNLOADS === "true";
const allowedOrigins = getAllowedOrigins(process.env.ALLOWED_ORIGINS ?? process.env.FRONTEND_ORIGIN);
const browserUserAgent =
  process.env.YTDLP_USER_AGENT?.trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new HttpError(403, "Origem nao permitida pelo CORS."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Ngrok-Skip-Browser-Warning",
    "X-Video-Universal-Key"
  ],
  exposedHeaders: ["Content-Disposition"],
  credentials: false,
  optionsSuccessStatus: 204
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadsDir = path.resolve(__dirname, "..", "downloads");

const allowedUrl = z
  .string()
  .trim()
  .url("Informe uma URL valida.")
  .refine((value) => {
    try {
      const parsed = new URL(value);
      const protocol = parsed.protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "A URL precisa usar http ou https.")
  .refine((value) => {
    try {
      return !isBlockedUrlHost(new URL(value).hostname);
    } catch {
      return false;
    }
  }, "Nao use URLs locais, privadas ou internas.");

const infoSchema = z.object({
  url: allowedUrl
});

const downloadSchema = z.object({
  url: allowedUrl,
  type: z.enum(["video", "audio"]),
  quality: z.enum(["best", "2160p", "1440p", "1080p", "720p", "480p", "360p"]).optional()
});

type VideoInfo = {
  title: string | null;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
  webpage_url: string | null;
  extractor: string | null;
};

type YtDlpOutput = {
  title?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  uploader?: unknown;
  channel?: unknown;
  webpage_url?: unknown;
  extractor?: unknown;
};

type OEmbedOutput = {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
};

type YtDlpArgOptions = {
  extractorArgs?: string | null;
  extraExtractorArgs?: string[];
};

type YtDlpAttempt = {
  label: string;
  args: string[];
};

type FileDownloadAttempt = YtDlpAttempt & {
  directory: string;
  preferredExtension: ".mp3" | ".mp4";
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function assertPublicDownloadUrl(value: string): Promise<void> {
  const parsed = new URL(value);
  const hostname = normalizeUrlHostname(parsed.hostname);

  if (isBlockedUrlHost(hostname)) {
    throw new HttpError(400, "Nao use URLs locais, privadas ou internas.");
  }

  if (isIP(hostname)) {
    return;
  }

  let addresses: Array<{ address: string }> = [];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new HttpError(400, "Nao foi possivel validar o dominio informado.");
  }

  if (!addresses.length || addresses.some(({ address }) => isBlockedIpAddress(address))) {
    throw new HttpError(400, "Nao use URLs locais, privadas ou internas.");
  }
}

function isBlockedUrlHost(hostname: string): boolean {
  const host = normalizeUrlHostname(hostname);

  if (!host) {
    return true;
  }

  if (
    host === "localhost" ||
    host === "0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return true;
  }

  return isBlockedIpAddress(host);
}

function isBlockedIpAddress(address: string): boolean {
  const host = normalizeUrlHostname(address);
  const version = isIP(host);

  if (version === 4) {
    return isBlockedIpv4(host);
  }

  if (version === 6) {
    return isBlockedIpv6(host);
  }

  return false;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  const [a = 0, b = 0, c = 0] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isBlockedIpv6(address: string): boolean {
  const host = normalizeUrlHostname(address);
  const embeddedIpv4 = host.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];

  if (embeddedIpv4 && isBlockedIpv4(embeddedIpv4)) {
    return true;
  }

  if (host === "::" || host === "::1") {
    return true;
  }

  const firstHextet = Number.parseInt(host.split(":")[0] || "0", 16);
  return (
    firstHextet === 0 ||
    (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
    (firstHextet >= 0xff00 && firstHextet <= 0xffff)
  );
}

function normalizeUrlHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' https://fonts.googleapis.com",
  "script-src 'self'",
  "connect-src 'self' https://videouniversal.vercel.app https://videouniversal-backend.onrender.com https://*.ngrok-free.dev https://*.ngrok.io https://*.ngrok.app",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests"
].join("; ");

const securityHeaders = {
  "Content-Security-Policy": contentSecurityPolicy,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=()"
} as const;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(applySecurityHeaders);
app.use(enforceHttps);
app.use(blockReservedPublicRoutes);
app.use(protectAdminRoutes);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: "text/plain", limit: "1mb" }));
app.use(morgan("dev"));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Muitas requisicoes. Aguarde um pouco e tente novamente." }
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.redirect(302, process.env.FRONTEND_ORIGIN?.trim() || "https://videouniversal.vercel.app");
});

app.get("/api/info", async (req, res, next) => {
  try {
    const { url } = infoSchema.parse(parseQueryObject(req.query));
    await assertPublicDownloadUrl(url);
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (error) {
    next(error);
  }
});

app.post("/api/info", async (req, res, next) => {
  try {
    const { url } = infoSchema.parse(parseRequestBody(req.body));
    await assertPublicDownloadUrl(url);
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (error) {
    next(error);
  }
});

app.get("/api/download", async (req, res, next) => {
  await handleDownloadRequest(parseQueryObject(req.query), res, next, { forceStream: true });
});

app.post("/api/download", async (req, res, next) => {
  await handleDownloadRequest(parseRequestBody(req.body), res, next);
});

async function handleDownloadRequest(
  input: unknown,
  res: Response,
  next: NextFunction,
  options: { forceStream?: boolean } = {}
): Promise<void> {
  const tempDir = path.join(downloadsDir, nanoid());

  try {
    const { url, type, quality = "best" } = downloadSchema.parse(input);
    await assertPublicDownloadUrl(url);

    if (options.forceStream || streamDownloads || (isProduction && type === "video")) {
      await streamDownload(url, type, quality, res);
      return;
    }

    await fs.mkdir(tempDir, { recursive: true });

    const info = await getVideoInfo(url);
    const attempt = await runFileDownloadAttempts(buildFileDownloadAttempts(url, type, quality, tempDir), 10 * 60 * 1000);
    const downloadedFile = await findDownloadedFile(attempt.directory, attempt.preferredExtension);
    const downloadName = buildDownloadFileName(info?.title ?? null, type);

    res.download(downloadedFile, downloadName, async (error) => {
      await cleanupTempDir(tempDir);

      if (error && !res.headersSent) {
        next(new HttpError(500, "Nao foi possivel enviar o arquivo baixado."));
      }
    });
  } catch (error) {
    await cleanupTempDir(tempDir);
    next(error);
  }
}

app.use((_req, res) => {
  res.status(404).json({ error: "Nao encontrado." });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    res.end();
    return;
  }

  const directDownloadError = isDirectDownloadDocumentRequest(_req);

  if (isJsonParseError(error)) {
    sendErrorResponse(_req, res, 400, "JSON invalido.", directDownloadError);
    return;
  }

  if (error instanceof z.ZodError) {
    sendErrorResponse(_req, res, 400, error.issues[0]?.message ?? "Dados invalidos.", directDownloadError);
    return;
  }

  if (error instanceof HttpError) {
    sendErrorResponse(_req, res, error.status, error.message, directDownloadError);
    return;
  }

  logUnexpectedError(error);
  const message = error instanceof Error ? error.message : "Erro inesperado.";
  sendErrorResponse(
    _req,
    res,
    500,
    isProduction ? "Erro interno no servidor." : normalizeYtDlpError(message),
    directDownloadError
  );
});

await prepareYtDlpCookiesFile();
await fs.mkdir(downloadsDir, { recursive: true });

app.listen(port, host, () => {
  console.log(`API online em http://${host}:${port}`);
});

function getAllowedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>(["https://videouniversal.vercel.app"]);
  const configuredOrigins = (value ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  for (const origin of configuredOrigins) {
    if (origin === "*" || (isProduction && isLocalOrigin(origin))) {
      continue;
    }

    origins.add(origin);
  }

  if (!isProduction) {
    for (const origin of [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174"
    ]) {
      origins.add(origin);
    }
  }

  return origins;
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function applySecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  for (const [key, value] of Object.entries(securityHeaders)) {
    res.setHeader(key, value);
  }

  const origin = req.header("origin") ?? "";

  // Chrome may preflight a public HTTPS page before it talks to a localhost companion API.
  if (
    isLocalRequest(req) &&
    allowedOrigins.has(origin) &&
    req.header("access-control-request-private-network")?.toLowerCase() === "true"
  ) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.vary("Access-Control-Request-Private-Network");
  }

  if (isProduction && !isLocalRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  next();
}

function enforceHttps(req: Request, res: Response, next: NextFunction): void {
  if (!isProduction || isLocalRequest(req)) {
    next();
    return;
  }

  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();

  if (forwardedProto === "http") {
    res.redirect(301, `https://${req.header("host") ?? "videouniversal-backend.onrender.com"}${req.originalUrl}`);
    return;
  }

  next();
}

function isLocalRequest(req: Request): boolean {
  const hostname = req.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function blockReservedPublicRoutes(req: Request, res: Response, next: NextFunction): void {
  if (isReservedPublicPath(req.path)) {
    res.status(404).json({ error: "Nao encontrado." });
    return;
  }

  next();
}

function isReservedPublicPath(pathname: string): boolean {
  return [
    /^\/\.env(?:\..*)?$/i,
    /^\/env$/i,
    /^\/config\.json$/i,
    /^\/secrets\.json$/i,
    /^\/.*\.(?:pem|key)$/i,
    /^\/\.git(?:\/.*)?$/i,
    /^\/(?:swagger|api-docs|docs|openapi(?:\.json)?|swagger\.json)(?:\/.*)?$/i,
    /^\/graphql(?:\/.*)?$/i,
    /^\/(?:debug|server-status|status|diagnostics|diag|test)(?:\/.*)?$/i,
    /^\/api\/(?:debug|server-status|status|diagnostics|diag|test)(?:\/.*)?$/i
  ].some((pattern) => pattern.test(pathname));
}

function protectAdminRoutes(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminPath(req.path)) {
    next();
    return;
  }

  const token = getAdminToken(req);

  if (!token) {
    res.status(401).json({ error: "Autenticacao requerida." });
    return;
  }

  const expectedToken = process.env.ADMIN_TOKEN?.trim();

  if (!expectedToken || token !== expectedToken) {
    res.status(403).json({ error: "Acesso negado." });
    return;
  }

  next();
}

function isAdminPath(pathname: string): boolean {
  return /^\/(?:admin|dashboard\/admin|painel|painel-admin|api\/admin)(?:\/.*)?$/i.test(pathname);
}

function getAdminToken(req: Request): string | null {
  const authorization = req.header("authorization")?.trim();

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim() || null;
  }

  return req.header("x-admin-token")?.trim() || null;
}

function logUnexpectedError(error: unknown): void {
  if (error instanceof Error) {
    console.error("Erro inesperado no servidor", {
      name: error.name,
      message: error.message,
      stack: isProduction ? undefined : error.stack
    });
    return;
  }

  console.error("Erro inesperado no servidor", { error });
}

function isDirectDownloadDocumentRequest(req: Request): boolean {
  return req.method === "GET" && req.path === "/api/download" && req.accepts(["html", "json"]) === "html";
}

function sendErrorResponse(
  req: Request,
  res: Response,
  status: number,
  message: string,
  asHtml = false
): void {
  if (!asHtml) {
    res.status(status).json({ error: message });
    return;
  }

  const frontendOrigin = process.env.FRONTEND_ORIGIN?.trim() || "https://videouniversal.vercel.app";
  const retryUrl = new URL(frontendOrigin);
  const requestedUrl = typeof req.query.url === "string" ? req.query.url : "";

  if (requestedUrl) {
    retryUrl.searchParams.set("url", requestedUrl);
  }

  res
    .status(status)
    .type("html")
    .send(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Video Universal</title>
  </head>
  <body>
    <main>
      <h1>Nao foi possivel iniciar o download</h1>
      <p>${escapeHtml(message)}</p>
      <a href="${escapeHtml(retryUrl.toString())}">Voltar ao Video Universal</a>
    </main>
  </body>
</html>`);
}

async function getVideoInfo(url: string): Promise<VideoInfo> {
  try {
    return await getVideoInfoWithYtDlp(url);
  } catch (error) {
    const fallback = await getYoutubeOEmbedInfo(url);

    if (fallback) {
      return fallback;
    }

    throw error;
  }
}

async function getVideoInfoWithYtDlp(url: string): Promise<VideoInfo> {
  const { stdout } = await runYtDlpAttempts(buildInfoAttempts(url), 25 * 1000);

  let rawInfo: YtDlpOutput;

  try {
    rawInfo = JSON.parse(stdout) as YtDlpOutput;
  } catch {
    throw new HttpError(502, "Nao foi possivel interpretar as informacoes retornadas pelo yt-dlp.");
  }

  return {
    title: asString(rawInfo.title),
    duration: asNumber(rawInfo.duration),
    thumbnail: asString(rawInfo.thumbnail),
    uploader: asString(rawInfo.uploader) ?? asString(rawInfo.channel),
    webpage_url: asString(rawInfo.webpage_url) ?? url,
    extractor: asString(rawInfo.extractor)
  };
}

function buildInfoAttempts(url: string): YtDlpAttempt[] {
  return getYtDlpExtractorVariants(url).map((variant) => ({
    label: `${variant.label} info`,
    args: buildYtDlpArgs(url, ["--dump-single-json", "--skip-download"], variant.options)
  }));
}

async function runYtDlpAttempts(attempts: YtDlpAttempt[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  let lastError: unknown = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]!;

    try {
      console.log(`yt-dlp tentativa ${index + 1}/${attempts.length}: ${attempt.label}`);
      return await runYtDlp(attempt.args, timeoutMs);
    } catch (error) {
      lastError = error;
      console.warn(`yt-dlp falhou na tentativa ${index + 1}/${attempts.length}: ${attempt.label}`, {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  throw lastError instanceof Error ? lastError : new HttpError(502, "Nao foi possivel concluir a operacao com yt-dlp.");
}

async function getYoutubeOEmbedInfo(url: string): Promise<VideoInfo | null> {
  const videoId = getYoutubeVideoId(url);

  if (!videoId) {
    return null;
  }

  const webpageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = new URL("https://www.youtube.com/oembed");
  oembedUrl.searchParams.set("format", "json");
  oembedUrl.searchParams.set("url", webpageUrl);

  try {
    const response = await fetch(oembedUrl);

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as OEmbedOutput | null;
    const title = asString(payload?.title);

    if (!title) {
      return null;
    }

    return {
      title,
      duration: null,
      thumbnail: asString(payload?.thumbnail_url) ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      uploader: asString(payload?.author_name),
      webpage_url: webpageUrl,
      extractor: "youtube"
    };
  } catch {
    return null;
  }
}

function buildFileDownloadAttempts(
  url: string,
  type: "video" | "audio",
  quality: string,
  tempDir: string
): FileDownloadAttempt[] {
  const variants = getYtDlpExtractorVariants(url);

  return variants.flatMap((variant, variantIndex) => {
    const attemptDir = path.join(tempDir, `attempt-${variantIndex + 1}`);
    const outputTemplate = path.join(attemptDir, "download.%(ext)s");

    if (type === "audio") {
      return [
        {
          label: `${variant.label} audio mp3`,
          directory: attemptDir,
          preferredExtension: ".mp3" as const,
          args: buildYtDlpArgs(
            url,
            ["--extract-audio", "--audio-format", "mp3", "--audio-quality", "0", "--output", outputTemplate],
            variant.options
          )
        }
      ];
    }

    const attempts: FileDownloadAttempt[] = [
      {
        label: `${variant.label} video mp4 merged`,
        directory: attemptDir,
        preferredExtension: ".mp4",
        args: buildYtDlpArgs(
          url,
          [
            "--format",
            getVideoFormat(quality),
            "--merge-output-format",
            "mp4",
            "--remux-video",
            "mp4",
            "--output",
            outputTemplate
          ],
          variant.options
        )
      },
      {
        label: `${variant.label} video mp4 progressive`,
        directory: attemptDir,
        preferredExtension: ".mp4",
        args: buildYtDlpArgs(
          url,
          ["--format", getProgressiveVideoFormat(quality), "--remux-video", "mp4", "--output", outputTemplate],
          variant.options
        )
      }
    ];

    return attempts;
  });
}

async function runFileDownloadAttempts(attempts: FileDownloadAttempt[], timeoutMs: number): Promise<FileDownloadAttempt> {
  let lastError: unknown = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]!;
    await fs.mkdir(attempt.directory, { recursive: true });

    try {
      console.log(`yt-dlp tentativa ${index + 1}/${attempts.length}: ${attempt.label}`);
      await runYtDlp(attempt.args, timeoutMs);
      return attempt;
    } catch (error) {
      lastError = error;
      console.warn(`yt-dlp falhou na tentativa ${index + 1}/${attempts.length}: ${attempt.label}`, {
        message: error instanceof Error ? error.message : String(error)
      });
      await cleanupTempDir(attempt.directory);
    }
  }

  throw lastError instanceof Error ? lastError : new HttpError(502, "Nao foi possivel concluir o download com yt-dlp.");
}

function getYtDlpExtractorVariants(url: string): Array<{ label: string; options: YtDlpArgOptions }> {
  if (!getYoutubeVideoId(url)) {
    return [{ label: "padrao", options: {} }];
  }

  const variants: Array<{ label: string; options: YtDlpArgOptions }> = [];

  if (hasConfiguredCookies) {
    variants.push({ label: "youtube cookies", options: { extractorArgs: null } });
  }

  variants.push({ label: "youtube padrao", options: {} });

  for (const client of youtubeFallbackClients) {
    variants.push({
      label: `youtube ${client}`,
      options: {
        extractorArgs: `youtube:player_client=${client}`
      }
    });
  }

  return dedupeExtractorVariants(variants);
}

function dedupeExtractorVariants(
  variants: Array<{ label: string; options: YtDlpArgOptions }>
): Array<{ label: string; options: YtDlpArgOptions }> {
  const seen = new Set<string>();
  const output: Array<{ label: string; options: YtDlpArgOptions }> = [];

  for (const variant of variants) {
    const key = `${variant.options.extractorArgs ?? ytdlpExtractorArgs}|${variant.options.extraExtractorArgs?.join("|") ?? ""}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(variant);
  }

  return output;
}

function buildYtDlpArgs(url: string, operationArgs: string[], options: YtDlpArgOptions = {}): string[] {
  const args = [
    "--no-warnings",
    "--no-playlist",
    "--socket-timeout",
    "30",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--extractor-retries",
    "3",
    "--retry-sleep",
    "linear=1:5:2",
    "--force-ipv4",
    "--user-agent",
    browserUserAgent,
    "--add-header",
    "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "--referer",
    getReferer(url)
  ];

  if (ytdlpCookiesPath) {
    args.push("--cookies", ytdlpCookiesPath);
  }

  if (ytdlpProxy) {
    args.push("--proxy", ytdlpProxy);
  }

  if (ytdlpRemoteComponents) {
    args.push("--remote-components", ytdlpRemoteComponents);
  }

  const extractorArgs = Object.hasOwn(options, "extractorArgs") ? options.extractorArgs : ytdlpExtractorArgs;

  if (extractorArgs) {
    args.push("--extractor-args", extractorArgs);
  }

  for (const extraExtractorArgs of options.extraExtractorArgs ?? []) {
    if (extraExtractorArgs) {
      args.push("--extractor-args", extraExtractorArgs);
    }
  }

  return [...args, ...operationArgs, url];
}

async function prepareYtDlpCookiesFile(): Promise<void> {
  const cookiesContent = getConfiguredCookiesContent();

  if (!cookiesContent) {
    if (ytdlpCookiesPath) {
      await warnIfCookiesFileIsMissing(ytdlpCookiesPath);
    }

    return;
  }

  const cookiesPath = ytdlpCookiesPath || path.join(os.tmpdir(), "yt-dlp-cookies.txt");
  await fs.mkdir(path.dirname(cookiesPath), { recursive: true });
  await fs.writeFile(cookiesPath, cookiesContent, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(cookiesPath, 0o600).catch(() => undefined);
  ytdlpCookiesPath = cookiesPath;
  console.log(`Cookies do yt-dlp carregados em ${cookiesPath}.`);
}

function hasYtDlpCookiesConfig(): boolean {
  return Boolean(
    ytdlpCookiesPath ||
      process.env.YTDLP_COOKIES_BASE64?.trim() ||
      process.env.YTDLP_COOKIES_B64?.trim() ||
      process.env.YTDLP_COOKIES_CONTENT?.trim() ||
      process.env.YTDLP_COOKIES?.trim()
  );
}

function getConfiguredCookiesContent(): string | null {
  const encodedCookies = (process.env.YTDLP_COOKIES_BASE64?.trim() || process.env.YTDLP_COOKIES_B64?.trim() || "").replace(
    /\s+/g,
    ""
  );

  if (encodedCookies) {
    return normalizeCookieFileContent(Buffer.from(encodedCookies, "base64").toString("utf8"));
  }

  const rawCookies = process.env.YTDLP_COOKIES_CONTENT ?? process.env.YTDLP_COOKIES;

  if (!rawCookies?.trim()) {
    return null;
  }

  return normalizeCookieFileContent(rawCookies);
}

function normalizeCookieFileContent(value: string): string {
  const normalizedEscapedNewlines =
    value.includes("\\n") && !value.includes("\n") ? value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n") : value;
  const normalizedNewlines = normalizedEscapedNewlines.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  return `${normalizedNewlines}\n`;
}

async function warnIfCookiesFileIsMissing(cookiesPath: string): Promise<void> {
  try {
    await fs.access(cookiesPath);
  } catch {
    console.warn(`YTDLP_COOKIES_PATH aponta para "${cookiesPath}", mas o arquivo nao foi encontrado.`);
  }
}

function getReferer(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return "https://www.google.com/";
  }
}

function runYtDlp(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpBin, args, {
      shell: false,
      windowsHide: true
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new HttpError(504, "O yt-dlp demorou demais para responder."));
    }, timeoutMs);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (error) => {
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new HttpError(500, `Nao encontrei o binario "${ytdlpBin}". Instale o yt-dlp ou ajuste YTDLP_BIN.`));
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new HttpError(502, normalizeYtDlpError(stderr || `yt-dlp finalizou com codigo ${code}.`)));
    });
  });
}

async function streamDownload(url: string, type: "video" | "audio", quality: string, res: Response): Promise<void> {
  const info = await getVideoInfo(url).catch(() => null);
  const fileName = buildDownloadFileName(info?.title ?? null, type);

  if (type === "video") {
    await streamVideoDownload(url, quality, res, fileName);
    return;
  }

  const ytdlp = spawn(ytdlpBin, getStreamingAudioArgs(url), {
    shell: false,
    windowsHide: true
  });
  const ffmpeg = spawn(
    ffmpegBin,
    ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-codec:a", "libmp3lame", "-q:a", "0", "-f", "mp3", "pipe:1"],
    {
      shell: false,
      windowsHide: true
    }
  );

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ytdlp.stdout.on("error", () => undefined);
  ffmpeg.stdin.on("error", () => undefined);
  ytdlp.stderr.on("data", (chunk: Buffer) => {
    ffmpeg.stderr.emit("data", Buffer.from(`[yt-dlp] ${chunk.toString("utf8")}`));
  });
  ytdlp.on("error", () => ffmpeg.kill("SIGTERM"));
  ytdlp.on("close", (code) => {
    if (code !== 0) {
      ffmpeg.kill("SIGTERM");
    }
  });

  await streamChildStdout(ffmpeg, res, {
    contentType: getDownloadContentType(type),
    fileName,
    firstByteTimeoutMs: 120 * 1000,
    stderrLabel: "ffmpeg"
  });
}

async function streamVideoDownload(url: string, quality: string, res: Response, fileName: string): Promise<void> {
  const attempts = buildStreamingVideoAttempts(url, quality);
  let lastError: unknown = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]!;
    const child = spawn(ytdlpBin, attempt.args, {
      shell: false,
      windowsHide: true
    });

    try {
      console.log(`yt-dlp stream tentativa ${index + 1}/${attempts.length}: ${attempt.label}`);
      await streamChildStdout(child, res, {
        contentType: getDownloadContentType("video"),
        fileName,
        firstByteTimeoutMs: 35 * 1000,
        stderrLabel: "yt-dlp"
      });
      return;
    } catch (error) {
      lastError = error;

      if (res.headersSent) {
        throw error;
      }

      console.warn(`yt-dlp stream falhou na tentativa ${index + 1}/${attempts.length}: ${attempt.label}`, {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  throw lastError instanceof Error ? lastError : new HttpError(502, "Nao foi possivel iniciar o download com yt-dlp.");
}

function buildStreamingVideoAttempts(url: string, quality: string): YtDlpAttempt[] {
  return getYtDlpExtractorVariants(url).map((variant) => ({
    label: `${variant.label} video stream mp4 progressive`,
    args: getStreamingVideoArgs(url, quality, variant.options)
  }));
}

function getStreamingVideoArgs(url: string, quality: string, options: YtDlpArgOptions = {}): string[] {
  return buildYtDlpArgs(url, [
    "--format",
    getStreamingVideoFormat(quality),
    "--output",
    "-"
  ], options);
}

function getStreamingAudioArgs(url: string): string[] {
  return buildYtDlpArgs(url, [
    "--format",
    "bestaudio/best",
    "--output",
    "-"
  ]);
}

function streamChildStdout(
  child: ChildProcessWithoutNullStreams,
  res: Response,
  options: { contentType: string; fileName: string; firstByteTimeoutMs: number; stderrLabel: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    let started = false;
    let finished = false;
    let stderr = "";

    const firstByteTimer = setTimeout(() => {
      if (!started) {
        child.kill("SIGTERM");
        reject(new HttpError(504, `${options.stderrLabel} demorou demais para iniciar o download.`));
      }
    }, options.firstByteTimeoutMs);

    const fail = (error: Error) => {
      clearTimeout(firstByteTimer);

      if (finished) {
        return;
      }

      finished = true;

      if (res.headersSent) {
        res.destroy(error);
        resolve();
        return;
      }

      reject(error);
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"), 8000);
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        fail(new HttpError(500, `Nao encontrei o binario necessario para o download. Verifique yt-dlp/FFmpeg no servidor.`));
        return;
      }

      fail(error);
    });

    child.stdout.once("data", (chunk: Buffer) => {
      if (finished) {
        return;
      }

      started = true;
      clearTimeout(firstByteTimer);
      if (!res.headersSent) {
        prepareDownloadResponse(res, {
          contentType: options.contentType,
          fileName: options.fileName
        });
      }
      res.write(chunk);
      child.stdout.pipe(res, { end: false });
    });

    child.on("close", (code) => {
      clearTimeout(firstByteTimer);

      if (finished) {
        return;
      }

      finished = true;

      if (code === 0) {
        if (!res.headersSent) {
          reject(new HttpError(502, "O download terminou sem enviar dados."));
          return;
        }

        res.end();
        resolve();
        return;
      }

      const message = normalizeYtDlpError(stderr || `${options.stderrLabel} finalizou com codigo ${code}.`);

      if (res.headersSent) {
        res.destroy(new Error(message));
        resolve();
        return;
      }

      reject(new HttpError(502, message));
    });

    res.on("close", () => {
      if (!finished) {
        child.kill("SIGTERM");
      }
    });
  });
}

function prepareDownloadResponse(res: Response, options: { contentType: string; fileName: string }): void {
  if (res.headersSent) {
    return;
  }

  res.setHeader("Content-Type", options.contentType);
  res.setHeader("Content-Disposition", getAttachmentContentDisposition(options.fileName));
  res.setHeader("Cache-Control", "no-store");
  res.flushHeaders();
}

function buildDownloadFileName(title: string | null, type: "video" | "audio"): string {
  const safeBaseName = sanitizeFileName(title ?? "download", "download");
  return `${safeBaseName}.${getDownloadExtension(type)}`;
}

function getDownloadExtension(type: "video" | "audio"): "mp4" | "mp3" {
  return type === "video" ? "mp4" : "mp3";
}

function getDownloadContentType(type: "video" | "audio"): "video/mp4" | "audio/mpeg" {
  return type === "video" ? "video/mp4" : "audio/mpeg";
}

function getAttachmentContentDisposition(fileName: string): string {
  const fallbackFileName = sanitizeAsciiFileName(fileName, "download");
  return `attachment; filename="${escapeHeaderQuotedString(fallbackFileName)}"; filename*=UTF-8''${encodeRfc5987Value(fileName)}`;
}

function sanitizeAsciiFileName(value: string, fallback: string): string {
  const extension = path.parse(value).ext;
  const fallbackFileName = extension ? `${fallback}${extension}` : fallback;
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 140);

  if (!cleaned || cleaned.startsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned)) {
    return fallbackFileName;
  }

  return cleaned;
}

function escapeHeaderQuotedString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function findDownloadedFile(tempDir: string, preferredExtension: string): Promise<string> {
  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(tempDir, entry.name))
    .filter((file) => !file.endsWith(".part") && !file.endsWith(".ytdl"));

  const preferred = files.find((file) => path.extname(file).toLowerCase() === preferredExtension);
  const selected = preferred ?? files[0];

  if (!selected) {
    throw new HttpError(502, "O download terminou, mas nenhum arquivo final foi encontrado.");
  }

  return selected;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
}

function sanitizeFileName(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120);

  if (!cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    return fallback;
  }

  return cleaned;
}

function getYoutubeFallbackClients(value: string | undefined): string[] {
  const rawClients = value?.trim() || "android_vr,android";
  const clients = rawClients
    .split(",")
    .map((client) => client.trim())
    .filter(Boolean);

  return Array.from(new Set(clients));
}

function getVideoFormat(quality: string): string {
  if (quality === "best") {
    return "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best";
  }

  const maxHeight = Number.parseInt(quality, 10);

  if (!Number.isFinite(maxHeight)) {
    return "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best";
  }

  return `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${maxHeight}][ext=mp4]/best[height<=${maxHeight}]/best`;
}

function getProgressiveVideoFormat(quality: string): string {
  if (quality === "best") {
    return "18/b[ext=mp4][protocol=https]/b[ext=mp4]/best[ext=mp4]";
  }

  const maxHeight = Number.parseInt(quality, 10);

  if (!Number.isFinite(maxHeight)) {
    return "18/b[ext=mp4][protocol=https]/b[ext=mp4]/best[ext=mp4]";
  }

  return `18/b[height<=${maxHeight}][ext=mp4][protocol=https]/b[height<=${maxHeight}][ext=mp4]/b[ext=mp4][protocol=https]/b[ext=mp4]/best[ext=mp4]`;
}

function getStreamingVideoFormat(quality: string): string {
  return getProgressiveVideoFormat(quality);
}

function getYoutubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (hostname === "youtu.be") {
      return normalizeYoutubeVideoId(url.pathname.split("/").filter(Boolean)[0]);
    }

    const isYoutubeHost = hostname === "youtube.com" || hostname.endsWith(".youtube.com");
    const isYoutubeNoCookieHost = hostname === "youtube-nocookie.com" || hostname.endsWith(".youtube-nocookie.com");

    if (!isYoutubeHost && !isYoutubeNoCookieHost) {
      return null;
    }

    if (url.pathname === "/watch") {
      return normalizeYoutubeVideoId(url.searchParams.get("v") ?? "");
    }

    const pathMatch = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/i);
    return normalizeYoutubeVideoId(pathMatch?.[1] ?? "");
  } catch {
    return null;
  }
}

function normalizeYoutubeVideoId(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{11}$/.test(trimmed) ? trimmed : null;
}

function parseRequestBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "JSON invalido.");
  }
}

function parseQueryObject(query: Request["query"]): Record<string, string> {
  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      output[key] = value;
    }
  }

  return output;
}

function appendLimited(current: string, next: string, limit: number): string {
  const joined = current + next;
  return joined.length > limit ? joined.slice(joined.length - limit) : joined;
}

function normalizeYtDlpError(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();

  if (!compact) {
    return "Nao foi possivel concluir a operacao com yt-dlp.";
  }

  if (/ffmpeg/i.test(compact)) {
    return "O yt-dlp precisa do FFmpeg para concluir esta operacao. Instale o FFmpeg e tente novamente.";
  }

  if (/unsupported url|no suitable extractor/i.test(compact)) {
    return "O yt-dlp nao reconheceu esta URL.";
  }

  if (/cookies file|could not open.*cookies|failed to read.*cookies|no such file.*cookies/i.test(compact)) {
    return "O servidor nao conseguiu ler os cookies do yt-dlp. No Render, configure YTDLP_COOKIES_BASE64 ou ajuste YTDLP_COOKIES_PATH para um arquivo existente.";
  }

  if (/instagram/i.test(compact) && /private|login|sign in|cookies|not available|checkpoint/i.test(compact)) {
    return "O Instagram bloqueou o acesso automatico a este conteudo. Tente uma URL publica; se o conteudo exige login, configure cookies autorizados no servidor.";
  }

  if (/youtube|youtu\.be/i.test(compact) && /bot|confirm.*not a bot|sign in|login|cookies/i.test(compact)) {
    return "O YouTube bloqueou o acesso automatico pelo servidor. Configure cookies autorizados no Render em YTDLP_COOKIES_BASE64 ou tente novamente em alguns minutos.";
  }

  if (/private|login|sign in|cookies/i.test(compact)) {
    return "Nao foi possivel acessar este conteudo. Use apenas URLs publicas ou conteudos para os quais voce tenha autorizacao.";
  }

  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

function isJsonParseError(error: unknown): boolean {
  const maybeError = error as { status?: unknown; type?: unknown };
  return error instanceof SyntaxError && maybeError.status === 400 && maybeError.type === "entity.parse.failed";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
