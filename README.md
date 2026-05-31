# Video URL Downloader

Aplicacao local com frontend em React + TypeScript + Vite e backend em Node.js + Express + TypeScript para buscar informacoes de uma URL de video e baixar o conteudo em MP4 ou extrair audio em MP3 usando `yt-dlp`.

> Use apenas com conteudos proprios, dominio publico, Creative Commons ou quando voce tiver autorizacao. Este app nao deve ser usado para burlar paywall, DRM, login privado, restricoes de acesso ou direitos autorais.

## Requisitos

- Node.js 20+
- Python 3.10+
- `yt-dlp`
- FFmpeg recomendado para mesclagem/conversao de audio e video

## Instalar yt-dlp

```bash
python -m pip install -U "yt-dlp[default]"
```

## Instalar FFmpeg no Windows

```bash
winget install Gyan.FFmpeg
```

Depois da instalacao, abra um novo terminal e confira:

```bash
yt-dlp --version
ffmpeg -version
```

## Rodar o backend

```bash
cd backend
npm install
npm run dev
```

O backend roda por padrao em:

```text
http://localhost:3333
```

Voce pode copiar `.env.example` para `.env` se quiser ajustar variaveis:

```env
PORT=3333
HOST=0.0.0.0
YTDLP_BIN=yt-dlp
FRONTEND_ORIGIN=http://localhost:5173,https://video-url-downloader.vercel.app
```

## Rodar o frontend

Em outro terminal:

```bash
cd frontend
npm install
npm run dev
```

Abra:

```text
http://localhost:5173
```

Se a porta `3333` ja estiver ocupada por outro projeto local, rode o backend em outra porta e ajuste o frontend.

No PowerShell:

```bash
# backend
$env:PORT="3334"; npm run dev

# frontend
$env:VITE_API_BASE_URL="http://localhost:3334/api"; npm run dev
```

## Endpoints

- `GET /api/health`: verifica se a API esta online.
- `POST /api/info`: recebe `{ "url": "https://..." }` e retorna metadados do video.
- `POST /api/download`: recebe `{ "url": "https://...", "type": "video", "quality": "1080p" }` ou `{ "url": "https://...", "type": "audio" }` e inicia o download.

Para video, `quality` e opcional. Valores aceitos: `best`, `2160p`, `1440p`, `1080p`, `720p`, `480p` e `360p`.

O backend aceita apenas URLs `http` e `https`, usa `--no-playlist` por padrao e chama `yt-dlp` com `spawn`, sem `exec` com strings.

## Deploy do backend no Render

O repositorio inclui:

- `render.yaml` na raiz, com um Web Service Docker chamado `videouniversal-backend`.
- `backend/Dockerfile`, que instala Node.js, Python, `yt-dlp` e FFmpeg.
- Health check em `/api/health`.

No Render:

1. Abra o Dashboard do Render.
2. Clique em **New +**.
3. Escolha **Blueprint**.
4. Conecte o repositorio `Changzaoo/VideoUniversal`.
5. Confirme o `render.yaml`.
6. Depois do deploy, a API deve ficar em algo como:

```text
https://videouniversal-backend.onrender.com/api/health
```

Quando a URL final do Render estiver pronta, configure o frontend na Vercel com:

```env
VITE_API_BASE_URL=https://SUA-URL-DO-RENDER/api
```

Depois faca redeploy do frontend na Vercel.

## Aviso de uso

Este projeto foi criado para uso local e educacional. Baixe somente conteudo que voce possui, que esteja em dominio publico, sob uma licenca que permita download, ou para o qual voce tenha autorizacao explicita.
