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
} from "lucide-react";

const REMOTE_API_BASE_URL = "https://videouniversal-backend.onrender.com/api";
const LOCAL_API_BASE_URLS = [
  "http://localhost:3333/api",
  "http://localhost:3334/api",
  "http://127.0.0.1:3333/api",
  "http://127.0.0.1:3334/api"
];
const CONFIGURED_API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

type DownloadType = "video" | "audio";
type VideoQuality = "best" | "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p";

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

  const canDownload = useMemo(() => url.trim().length > 0 && !downloading, [url, downloading]);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timer = window.setTimeout(() => setSuccess(""), 1800);
    return () => window.clearTimeout(timer);
  }, [success]);

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
      setError("Cole uma URL valida começando com http:// ou https://.");
      return;
    }

    setDownloading(true);

    let resolvedApiBaseUrl: string;

    try {
      resolvedApiBaseUrl = await resolveApiBaseUrl(apiBaseUrl);
      setApiBaseUrl(resolvedApiBaseUrl);
    } catch (requestError) {
      setDownloading(false);
      setError(getErrorMessage(requestError));
      return;
    }

    startBrowserDownload(buildDownloadUrl(resolvedApiBaseUrl, url.trim(), type, quality));
    setSuccess("Download enviado diretamente para o navegador.");
    window.setTimeout(() => setDownloading(false), 1200);
  }

  return (
    <React.StrictMode>
      <main className="main-shell">
        <section className="stage" aria-labelledby="page-title">
          <div className="hero">
            <a className="hero-logo" href="/" aria-label="Video Universal">
              <img src="/assets/logo-full.png" alt="Video Universal" />
            </a>
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
                {downloading ? "..." : "Baixar"}
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
      const response = await fetchWithTimeout(`${apiBaseUrl}/health`, 2500);

      if (response.ok) {
        return apiBaseUrl;
      }

      lastError = new Error("API indisponivel.");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Nao encontrei a API online.");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
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

function getApiBaseUrlCandidates(preferredApiBaseUrl?: string): string[] {
  const candidates: string[] = [];

  if (preferredApiBaseUrl) {
    candidates.push(preferredApiBaseUrl);
  }

  if (import.meta.env.DEV) {
    if (CONFIGURED_API_BASE_URL && isLocalApiBaseUrl(CONFIGURED_API_BASE_URL)) {
      candidates.push(CONFIGURED_API_BASE_URL);
    }

    candidates.push(...LOCAL_API_BASE_URLS);

    if (CONFIGURED_API_BASE_URL && !isLocalApiBaseUrl(CONFIGURED_API_BASE_URL)) {
      candidates.push(CONFIGURED_API_BASE_URL);
    }
  } else if (CONFIGURED_API_BASE_URL) {
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

function startBrowserDownload(downloadUrl: string): void {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Algo deu errado. Tente novamente.";
}

createRoot(document.getElementById("root")!).render(<App />);
