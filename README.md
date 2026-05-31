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
FFMPEG_BIN=ffmpeg
STREAM_DOWNLOADS=false
ALLOWED_ORIGINS=https://videouniversal.vercel.app
YTDLP_COOKIES_PATH=
YTDLP_COOKIES_BASE64=
YTDLP_COOKIES_CONTENT=
YTDLP_PROXY=
YTDLP_EXTRACTOR_ARGS=youtube:player_client=android_vr
YTDLP_REMOTE_COMPONENTS=ejs:github
YTDLP_YOUTUBE_FALLBACK_CLIENTS=android_vr,android
BGUTIL_POT_PROVIDER=true
BGUTIL_PORT=4416
ADMIN_TOKEN=
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

Sem `VITE_API_BASE_URL`, o frontend em modo dev tenta automaticamente as APIs locais `3333` e `3334` antes do backend publicado.

## Endpoints

- `GET /api/health`: verifica se a API esta online.
- `GET /api/info?url=https://...` ou `POST /api/info`: retorna metadados do video.
- `GET /api/download?url=https://...&type=video&quality=1080p` ou `POST /api/download`: inicia o download.

Para video, `quality` e opcional. Valores aceitos: `best`, `2160p`, `1440p`, `1080p`, `720p`, `480p` e `360p`.

O backend aceita apenas URLs `http` e `https`, usa `--no-playlist` por padrao e chama `yt-dlp` com `spawn`, sem `exec` com strings.

## Deploy do backend no Render

O repositorio inclui:

- `render.yaml` na raiz, com um Web Service Docker chamado `videouniversal-backend`.
- `backend/Dockerfile`, que instala Node.js, Python, `yt-dlp` e FFmpeg.
- Health check em `/api/health`, retornando apenas `{ "ok": true }`.
- `STREAM_DOWNLOADS=false` no Render, para baixar em arquivo temporario, mesclar com FFmpeg e so entao enviar o arquivo ao navegador.

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

O frontend publicado em Vercel deve usar:

```env
VITE_API_BASE_URL=https://videouniversal-backend.onrender.com/api
```

Depois faca redeploy do frontend na Vercel.

## Instagram e sites com login

O backend envia `User-Agent`, `Accept-Language`, referer, retries, clientes alternativos do YouTube e usa FFmpeg para aumentar a compatibilidade com Instagram e outros sites suportados pelo `yt-dlp`. Ainda assim, alguns links podem exigir login, cookies, nao estar publicos, estar bloqueados por regiao ou usar DRM. Nesses casos, configure cookies autorizados no servidor com:

```env
YTDLP_COOKIES_PATH=/caminho/para/cookies.txt
```

No Render, o caminho acima normalmente nao existe dentro do container. Para esse caso, gere um `cookies.txt` em formato Netscape, converta para base64 e salve como Secret Environment Variable:

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content .\cookies.txt -Raw))) | Set-Clipboard
```

Depois configure no Render:

```env
YTDLP_COOKIES_BASE64=valor_copiado_do_comando
```

Ao iniciar, o backend grava esses cookies em `/tmp/yt-dlp-cookies.txt` e passa o arquivo ao `yt-dlp`. Se o YouTube continuar bloqueando IPs de datacenter, configure tambem um proxy autorizado com `YTDLP_PROXY`.

Se quiser exportar cookies do navegador local sem imprimir o segredo no terminal, feche totalmente Brave/Edge e rode:

```powershell
.\scripts\export-youtube-cookies.ps1 -Browser brave -Profile Default
```

O script cria `youtube.cookies.txt`, cria `youtube.cookies.base64.txt` e copia o base64 para a area de transferencia. Esses arquivos ficam ignorados pelo Git.

O Dockerfile tambem instala o provider `bgutil-ytdlp-pot-provider` e inicia o servidor local de PO Token na porta `4416` por padrao. Isso ajuda o `yt-dlp` quando o YouTube exige Proof-of-Origin Token para alguns clientes/formatos. Se o Render continuar recebendo bloqueio de IP, use cookies reais exportados de uma sessao autorizada e/ou um proxy autorizado; cookies placeholder de consentimento normalmente nao bastam.

## Aviso de uso

Este projeto foi criado para uso local e educacional. Baixe somente conteudo que voce possui, que esteja em dominio publico, sob uma licenca que permita download, ou para o qual voce tenha autorizacao explicita.
