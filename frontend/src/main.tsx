import React, { FormEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Clock3,
  Download,
  ExternalLink,
  FileVideo2,
  Globe2,
  History,
  Link2,
  Loader2,
  LockKeyhole,
  Music2,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  User2
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3333/api";

type DownloadType = "video" | "audio";
type VideoQuality = "best" | "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p";

type VideoInfo = {
  title: string | null;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
  webpage_url: string | null;
  extractor: string | null;
};

type HistoryItem = {
  id: string;
  title: string;
  type: DownloadType;
  createdAt: string;
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
  const [quality, setQuality] = useState<VideoQuality>("best");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const canAnalyze = useMemo(() => url.trim().length > 0 && !loadingInfo && !downloading, [url, loadingInfo, downloading]);
  const canDownload = useMemo(() => url.trim().length > 0 && !loadingInfo && !downloading, [url, loadingInfo, downloading]);

  async function handleInfo(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    setSuccess("");
    setInfo(null);

    if (!isHttpUrl(url)) {
      setError("Cole uma URL valida começando com http:// ou https://.");
      return;
    }

    setLoadingInfo(true);

    try {
      const response = await fetch(`${API_BASE_URL}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() })
      });

      const payload = await readJsonResponse<VideoInfo>(response);
      setInfo(payload);
      setSuccess("Informacoes carregadas. Escolha o formato e baixe quando quiser.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoadingInfo(false);
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

  async function handleDownload() {
    setError("");
    setSuccess("");

    if (!isHttpUrl(url)) {
      setError("Cole uma URL valida começando com http:// ou https://.");
      return;
    }

    setDownloading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), type, quality: type === "video" ? quality : undefined })
      });

      if (!response.ok) {
        await readJsonResponse(response);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = getDownloadFileName(response, type, info?.title);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      const title = info?.title ?? getHostLabel(url) ?? "Download";
      setHistory((current) => [
        {
          id: crypto.randomUUID(),
          title,
          type,
          createdAt: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        },
        ...current.slice(0, 4)
      ]);
      setSuccess("Download iniciado pelo navegador.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <React.StrictMode>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Video Universal">
          <img src="/assets/logo-full.png" alt="Video Universal" />
        </a>

        <div className="topbar-actions" aria-label="Acoes do aplicativo">
          <span className="status-pill">
            <span className="status-dot" />
            Local
          </span>
          <button className="history-button" type="button">
            <History size={16} />
            Historico
            {history.length > 0 ? <span>{history.length}</span> : null}
          </button>
        </div>
      </header>

      <main className="main-shell">
        <section className="stage" aria-labelledby="page-title">
          <div className="hero">
            <h1 id="page-title">Baixe qualquer video da web</h1>
          </div>

          <form className={`input-card ${error ? "has-error" : ""}`} onSubmit={handleInfo}>
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

              <button className="primary-button" type="submit" disabled={!canAnalyze}>
                {loadingInfo ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                {loadingInfo ? "Analisando..." : "Analisar"}
              </button>

              <button className="primary-button download-inline" type="button" disabled={!canDownload} onClick={handleDownload}>
                {downloading ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
                {downloading ? "..." : "Baixar"}
              </button>
            </div>
          </form>

          <StatusMessages error={error} success={success} />

          <PreviewPanel info={info} loading={loadingInfo} />

          {history.length > 0 ? <HistoryList items={history} /> : null}
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

function PreviewPanel({ info, loading }: { info: VideoInfo | null; loading: boolean }) {
  if (loading) {
    return (
      <section className="preview-card loading-card" aria-label="Carregando preview">
        <div className="preview-thumb skeleton" />
        <div className="preview-meta">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      </section>
    );
  }

  if (!info) {
    return (
      <section className="preview-card empty-card" aria-label="Preview do video">
        <div className="preview-thumb placeholder-thumb">
          <Play size={30} fill="currentColor" />
        </div>
        <div className="preview-meta">
          <span className="source-badge">Preview</span>
          <h2>As informacoes do video aparecem aqui</h2>
          <p>Cole uma URL publica e clique em analisar para ver titulo, fonte, autor e duracao.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="preview-card" aria-label="Preview do video">
      <div className="preview-thumb">
        {info.thumbnail ? <img src={info.thumbnail} alt="" /> : <Play size={30} fill="currentColor" />}
        <span className="duration-pill">{formatDuration(info.duration)}</span>
      </div>

      <div className="preview-meta">
        <span className="source-badge">
          <span className="source-dot" />
          {info.extractor ?? getHostLabel(info.webpage_url ?? "") ?? "Fonte"}
        </span>

        <h2>{info.title ?? "Titulo nao informado"}</h2>

        <div className="meta-row">
          <span>
            <User2 size={16} />
            {info.uploader ?? "Autor nao informado"}
          </span>
          <span>
            <Clock3 size={16} />
            {formatDuration(info.duration)}
          </span>
        </div>

        {info.webpage_url ? (
          <a className="source-link" href={info.webpage_url} target="_blank" rel="noreferrer">
            Abrir fonte
            <ExternalLink size={16} />
          </a>
        ) : null}
      </div>
    </section>
  );
}

function HistoryList({ items }: { items: HistoryItem[] }) {
  return (
    <section className="history-list" aria-label="Downloads recentes">
      <div className="section-head compact">
        <div>
          <p>Historico</p>
          <h2>Downloads recentes</h2>
        </div>
      </div>

      <div className="history-items">
        {items.map((item) => (
          <div className="history-item" key={item.id}>
            <span className={item.type === "video" ? "history-icon" : "history-icon audio"}>
              {item.type === "video" ? <FileVideo2 size={18} /> : <Music2 size={18} />}
            </span>
            <strong>{item.title}</strong>
            <em>{item.type === "video" ? "MP4" : "MP3"}</em>
            <time>{item.createdAt}</time>
          </div>
        ))}
      </div>
    </section>
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

async function readJsonResponse<T = unknown>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Nao foi possivel concluir a requisicao.";
    throw new Error(message);
  }

  return payload as T;
}

function getDownloadFileName(response: Response, type: DownloadType, title?: string | null): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  const encodedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = header.match(/filename="?([^"]+)"?/i);

  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  const baseName = (title ?? "download")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return `${baseName || "download"}.${type === "video" ? "mp4" : "mp3"}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Algo deu errado. Tente novamente.";
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) {
    return "Duracao nao informada";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const parts = hours > 0 ? [hours, minutes, remainingSeconds] : [minutes, remainingSeconds];

  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

function getHostLabel(value: string): string | null {
  try {
    return new URL(value.trim()).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
