import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Download,
  FileVideo2,
  Link2,
  Loader2,
  Music2,
  Smartphone,
} from "lucide-react";

const REMOTE_API_BASE_URL = "https://videouniversal-backend.onrender.com/api";
const NGROK_API_BASE_URL = "/pc-api";
const DIRECT_DOWNLOAD_MIN_DURATION_SECONDS = 5 * 60;
const LOCAL_HEALTH_TIMEOUT_MS = 3500;
const REMOTE_HEALTH_TIMEOUT_MS = 30000;
const VIDEO_INFO_TIMEOUT_MS = 45000;
const LOCAL_API_BASE_URLS = [
  "http://localhost:3333/api",
  "http://localhost:3334/api",
  "http://127.0.0.1:3333/api",
  "http://127.0.0.1:3334/api"
];
const CONFIGURED_API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

type DownloadType = "video" | "audio";
type VideoQuality = "best" | "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p";
type DownloadResult = "direct" | "blob";
type VideoInfo = {
  duration: number | null;
};
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const qualityOptions: Array<{ value: VideoQuality; label: string }> = [
  { value: "best", label: "Auto" },
  { value: "2160p", label: "4K" },
  { value: "1440p", label: "1440p" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" }
];

function App() {
  const [url, setUrl] = useState("");
  const [type, setType] = useState<DownloadType>("video");
  const [quality, setQuality] = useState<VideoQuality>("720p");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(() => getApiBaseUrlCandidates()[0]);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandaloneApp());

  const canDownload = useMemo(() => url.trim().length > 0 && !downloading, [url, downloading]);
  const canInstall = Boolean(installPrompt && !installed);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timer = window.setTimeout(() => setSuccess(""), 1800);
    return () => window.clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayModeChange = () => setInstalled(isStandaloneApp());
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setSuccess("App instalado.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    mediaQuery.addEventListener("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      mediaQuery.removeEventListener("change", handleDisplayModeChange);
    };
  }, []);

  async function handleInstall() {
    if (!installPrompt) {
      return;
    }

    const prompt = installPrompt;
    setInstallPrompt(null);
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);

    if (choice?.outcome === "accepted") {
      setInstalled(true);
      setSuccess("App instalado.");
    }
  }

  async function handlePaste() {
    setError("");
    setSuccess("");

    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError("A area de transferencia esta vazia.");
        return;
      }

      setUrl(text.trim());
    } catch {
      setError("Nao foi possivel ler a area de transferencia neste navegador.");
    }
  }

  async function handleDownload(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    setSuccess("");

    if (!isHttpUrl(url)) {
      setError("Cole uma URL valida comecando com http:// ou https://.");
      return;
    }

    setDownloading(true);

    try {
      const resolvedApiBaseUrl = await resolveApiBaseUrl(apiBaseUrl);
      setApiBaseUrl(resolvedApiBaseUrl);
      const result = await downloadFile(resolvedApiBaseUrl, url.trim(), type, quality);
      setSuccess(result === "direct" ? "Download iniciado no navegador." : "Arquivo pronto. O download foi iniciado.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <React.StrictMode>
      <main className="main-shell">
        <section className="stage" aria-labelledby="page-title">
          <div className="hero">
            <a className="hero-logo" href="/" aria-label="Video Universal">
              <img src="/assets/logo-full.png" alt="Video Universal" />
            </a>
            {canInstall ? (
              <button className="install-button" type="button" onClick={handleInstall}>
                <Smartphone size={16} />
                Instalar
              </button>
            ) : null}
            <h1 id="page-title">Baixe qualquer video da web</h1>
          </div>

          <form className={`input-card ${error ? "has-error" : ""}`} onSubmit={handleDownload}>
            <div className="input-row">
              <div className="inline-tools" aria-label="Formato e qualidade">
                <div className="mini-toggle" aria-label="Tipo de download">
                  <button
                    className={type === "video" ? "active" : ""}
                    type="button"
                    onClick={() => setType("video")}
                    title="Video MP4"
                  >
                    <FileVideo2 size={15} />
                    MP4
                  </button>
                  <button
                    className={type === "audio" ? "active" : ""}
                    type="button"
                    onClick={() => setType("audio")}
                    title="Audio MP3"
                  >
                    <Music2 size={15} />
                    MP3
                  </button>
                </div>

                <label className={`quality-select ${type === "audio" ? "disabled" : ""}`}>
                  <span>Qualidade</span>
                  <select
                    value={quality}
                    disabled={type === "audio"}
                    onChange={(event) => setQuality(event.target.value as VideoQuality)}
                    aria-label="Qualidade do video"
                  >
                    {qualityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="input-wrap">
                <Link2 size={20} aria-hidden="true" />
                <input
                  id="video-url"
                  type="url"
                  inputMode="url"
                  placeholder="Cole o link do video aqui..."
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  aria-label="URL do video"
                />
              </div>

              <button className="paste-button" type="button" onClick={handlePaste}>
                <Clipboard size={16} />
                Colar
              </button>

              <button className="primary-button download-inline" type="submit" disabled={!canDownload}>
                {downloading ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
                {downloading ? "Baixando" : "Baixar"}
              </button>
            </div>
          </form>

          <StatusMessages error={error} success={success} />
        </section>
      </main>
    </React.StrictMode>
  );
}

function StatusMessages({ error, success }: { error: string; success: string }) {
  if (!error && !success) {
    return null;
  }

  return (
    <div className="messages">
      {error ? (
        <div className="message error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div className="message success" role="status">
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      ) : null}
    </div>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function resolveApiBaseUrl(preferredApiBaseUrl: string): Promise<string> {
  let lastError: unknown = null;

  for (const apiBaseUrl of getApiBaseUrlCandidates(preferredApiBaseUrl)) {
    try {
      const response = await fetchWithTimeout(`${apiBaseUrl}/health`, getHealthTimeoutMs(apiBaseUrl), {
        headers: getApiRequestHeaders(apiBaseUrl)
      });

      if (response.ok) {
        return apiBaseUrl;
      }

      lastError = new Error("API indisponivel.");
    } catch (error) {
      lastError = error;
    }
  }

  throw normalizeRequestError(lastError, "Nao encontrei a API online. Tente novamente em alguns segundos.");
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(new DOMException("Tempo limite excedido.", "TimeoutError")),
    timeoutMs
  );

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function downloadFile(
  apiBaseUrl: string,
  url: string,
  type: DownloadType,
  quality: VideoQuality
): Promise<DownloadResult> {
  const canUseDirectDownload = !isNgrokApiBaseUrl(apiBaseUrl);

  if (type === "video" && canUseDirectDownload) {
    startDirectDownload(buildDownloadUrl(apiBaseUrl, url, type, quality));
    return "direct";
  }

  const info = canUseDirectDownload ? await getVideoInfo(apiBaseUrl, url).catch(() => null) : null;

  if (canUseDirectDownload && shouldUseDirectDownload(info, type)) {
    startDirectDownload(buildDownloadUrl(apiBaseUrl, url, type, quality));
    return "direct";
  }

  const response = await fetch(`${apiBaseUrl}/download`, {
    method: "POST",
    headers: getApiRequestHeaders(apiBaseUrl, {
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({ url, type, quality })
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const blob = await response.blob();

  if (!blob.size) {
    throw new Error("A API respondeu sem enviar arquivo.");
  }

  const fileName =
    getFileNameFromContentDisposition(response.headers.get("Content-Disposition")) ??
    `download.${type === "video" ? "mp4" : "mp3"}`;
  startBlobDownload(blob, fileName);
  return "blob";
}

async function getVideoInfo(apiBaseUrl: string, url: string): Promise<VideoInfo> {
  const response = await fetchWithTimeout(`${apiBaseUrl}/info`, VIDEO_INFO_TIMEOUT_MS, {
    method: "POST",
    headers: getApiRequestHeaders(apiBaseUrl, {
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as VideoInfo;
}

function shouldUseDirectDownload(info: VideoInfo | null, type: DownloadType): boolean {
  if (!info?.duration) {
    return false;
  }

  const threshold = type === "audio" ? DIRECT_DOWNLOAD_MIN_DURATION_SECONDS * 2 : DIRECT_DOWNLOAD_MIN_DURATION_SECONDS;
  return info.duration >= threshold;
}

function getHealthTimeoutMs(apiBaseUrl: string): number {
  return isLocalApiBaseUrl(apiBaseUrl) ? LOCAL_HEALTH_TIMEOUT_MS : REMOTE_HEALTH_TIMEOUT_MS;
}

function buildDownloadUrl(apiBaseUrl: string, url: string, type: DownloadType, quality: VideoQuality): string {
  const params = new URLSearchParams({
    url,
    type
  });

  if (type === "video") {
    params.set("quality", quality);
  }

  return `${apiBaseUrl}/download?${params.toString()}`;
}

async function readApiError(response: Response): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  }

  const text = await response.text().catch(() => "");
  return text.trim() || `Nao foi possivel baixar este conteudo. Codigo ${response.status}.`;
}

function getFileNameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const encodedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].trim());
    } catch {
      return encodedMatch[1].trim();
    }
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  const plainMatch = header.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || null;
}

function getApiBaseUrlCandidates(preferredApiBaseUrl?: string): string[] {
  const candidates: string[] = [];

  if (preferredApiBaseUrl) {
    candidates.push(preferredApiBaseUrl);
  }

  if (CONFIGURED_API_BASE_URL && isLocalApiBaseUrl(CONFIGURED_API_BASE_URL)) {
    candidates.push(CONFIGURED_API_BASE_URL);
  }

  if (NGROK_API_BASE_URL) {
    candidates.push(NGROK_API_BASE_URL);
  }

  candidates.push(...LOCAL_API_BASE_URLS);

  if (CONFIGURED_API_BASE_URL && !isLocalApiBaseUrl(CONFIGURED_API_BASE_URL)) {
    candidates.push(CONFIGURED_API_BASE_URL);
  }

  candidates.push(REMOTE_API_BASE_URL);

  return Array.from(new Set(candidates.map((candidate) => normalizeApiBaseUrl(candidate)).filter(Boolean)));
}

function normalizeApiBaseUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/g, "") ?? "";
}

function isLocalApiBaseUrl(apiBaseUrl: string): boolean {
  try {
    const hostname = new URL(apiBaseUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function startBlobDownload(blob: Blob, fileName: string): void {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

function isNgrokApiBaseUrl(apiBaseUrl: string): boolean {
  if (apiBaseUrl === "/pc-api" || apiBaseUrl.startsWith("/pc-api/")) {
    return true;
  }

  try {
    const hostname = new URL(apiBaseUrl).hostname.toLowerCase();
    return hostname.endsWith(".ngrok-free.dev") || hostname.endsWith(".ngrok.io") || hostname.endsWith(".ngrok.app");
  } catch {
    return false;
  }
}

function getApiRequestHeaders(apiBaseUrl: string, headers: HeadersInit = {}): HeadersInit {
  if (!isNgrokApiBaseUrl(apiBaseUrl)) {
    return headers;
  }

  return {
    ...headers,
    "ngrok-skip-browser-warning": "true"
  };
}

function isStandaloneApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function startDirectDownload(downloadUrl: string): void {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function getErrorMessage(error: unknown): string {
  return normalizeRequestError(error, "Algo deu errado. Tente novamente.").message;
}

function normalizeRequestError(error: unknown, fallbackMessage: string): Error {
  if (isAbortError(error)) {
    return new Error("A API demorou para responder. Aguarde alguns segundos e tente novamente.");
  }

  if (error instanceof Error && error.message.trim()) {
    return error;
  }

  return new Error(fallbackMessage);
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError";
  }

  if (error instanceof Error) {
    return /abort|aborted|signal|timeout|tempo limite/i.test(error.message);
  }

  return false;
}

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
