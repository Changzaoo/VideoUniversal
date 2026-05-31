import cors from "cors";
import type { CorsOptions } from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import morgan from "morgan";
import { nanoid } from "nanoid";
import { z } from "zod";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";
const ytdlpBin = process.env.YTDLP_BIN?.trim() || "yt-dlp";
const streamDownloads = process.env.STREAM_DOWNLOADS === "true";
const corsOrigins = (process.env.FRONTEND_ORIGIN ?? "http://localhost:5173,https://videouniversal.vercel.app")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new HttpError(403, "Origem nao permitida pelo CORS."));
  },
  exposedHeaders: ["Content-Disposition"],
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
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "A URL precisa usar http ou https.");

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

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

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
  res.json({ status: "ok" });
});

app.post("/api/info", async (req, res, next) => {
  try {
    const { url } = infoSchema.parse(parseRequestBody(req.body));
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (error) {
    next(error);
  }
});

app.post("/api/download", async (req, res, next) => {
  const tempDir = path.join(downloadsDir, nanoid());

  try {
    const { url, type, quality = "best" } = downloadSchema.parse(parseRequestBody(req.body));

    if (streamDownloads) {
      await streamDownload(url, type, quality, res);
      return;
    }

    await fs.mkdir(tempDir, { recursive: true });

    const info = await getVideoInfo(url);
    const outputTemplate = path.join(tempDir, "download.%(ext)s");
    const args =
      type === "video"
        ? [
            "--no-playlist",
            "--format",
            getVideoFormat(quality),
            "--merge-output-format",
            "mp4",
            "--output",
            outputTemplate,
            url
          ]
        : [
            "--no-playlist",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--output",
            outputTemplate,
            url
          ];

    await runYtDlp(args, 10 * 60 * 1000);

    const downloadedFile = await findDownloadedFile(tempDir, type === "video" ? ".mp4" : ".mp3");
    const safeBaseName = sanitizeFileName(info.title ?? "download", "download");
    const downloadName = `${safeBaseName}${type === "video" ? ".mp4" : ".mp3"}`;

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
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (isJsonParseError(error)) {
    res.status(400).json({ error: "JSON invalido." });
    return;
  }

  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Dados invalidos." });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : "Erro inesperado.";
  res.status(500).json({ error: normalizeYtDlpError(message) });
});

await fs.mkdir(downloadsDir, { recursive: true });

app.listen(port, host, () => {
  console.log(`API online em http://${host}:${port}`);
});

async function getVideoInfo(url: string): Promise<VideoInfo> {
  const { stdout } = await runYtDlp(
    ["--dump-single-json", "--skip-download", "--no-warnings", "--no-playlist", url],
    90 * 1000
  );

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
  const extension = type === "video" ? "mp4" : "mp3";
  const fileName = `videouniversal-download.${extension}`;

  if (type === "video") {
    const urls = await getVideoDirectUrls(url, quality);
    const child = spawn("ffmpeg", getStreamingVideoFfmpegArgs(urls), {
      shell: false,
      windowsHide: true
    });

    await streamChildStdout(child, res, {
      contentType: "video/mp4",
      fileName,
      firstByteTimeoutMs: 90 * 1000,
      stderrLabel: "yt-dlp"
    });
    return;
  }

  const ytdlp = spawn(ytdlpBin, getStreamingAudioArgs(url), {
    shell: false,
    windowsHide: true
  });
  const ffmpeg = spawn(
    "ffmpeg",
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
    contentType: "audio/mpeg",
    fileName,
    firstByteTimeoutMs: 120 * 1000,
    stderrLabel: "ffmpeg"
  });
}

function getStreamingVideoArgs(url: string, quality: string): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "20",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--format",
    getStreamingVideoFormat(quality),
    "--output",
    "-",
    url
  ];
}

async function getVideoDirectUrls(url: string, quality: string): Promise<string[]> {
  const { stdout } = await runYtDlp(
    [
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout",
      "20",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--get-url",
      "--format",
      getMuxedVideoFormat(quality),
      url
    ],
    90 * 1000
  );

  const urls = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));

  if (!urls.length) {
    throw new HttpError(502, "Nao foi possivel obter o stream direto do video.");
  }

  return urls.slice(0, 2);
}

function getStreamingVideoFfmpegArgs(urls: string[]): string[] {
  const reconnectArgs = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"];
  const inputArgs = urls.flatMap((streamUrl) => [...reconnectArgs, "-i", streamUrl]);
  const mapArgs = urls.length > 1 ? ["-map", "0:v:0", "-map", "1:a:0"] : ["-map", "0:v:0", "-map", "0:a:0?"];

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputArgs,
    ...mapArgs,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1"
  ];
}

function getStreamingAudioArgs(url: string): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "20",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--format",
    "bestaudio/best",
    "--output",
    "-",
    url
  ];
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
      res.setHeader("Content-Type", options.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${options.fileName}"`);
      res.setHeader("Cache-Control", "no-store");
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
    .normalize("NFKD")
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

function getStreamingVideoFormat(quality: string): string {
  if (quality === "best") {
    return "b[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]";
  }

  const maxHeight = Number.parseInt(quality, 10);

  if (!Number.isFinite(maxHeight)) {
    return "b[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]";
  }

  return `b[height<=${maxHeight}][ext=mp4][vcodec!=none][acodec!=none]/best[height<=${maxHeight}][ext=mp4][vcodec!=none][acodec!=none]`;
}

function getMuxedVideoFormat(quality: string): string {
  if (quality === "best") {
    return "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/bv*+ba/best";
  }

  const maxHeight = Number.parseInt(quality, 10);

  if (!Number.isFinite(maxHeight)) {
    return "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/bv*+ba/best";
  }

  return `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${maxHeight}][ext=mp4]/best[height<=${maxHeight}][ext=mp4]/bv*[height<=${maxHeight}]+ba/best[height<=${maxHeight}]`;
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
