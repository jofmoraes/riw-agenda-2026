# RIW Agenda 2026

PWA estática para a agenda personalizada do Rio Innovation Week 2026.

## Arquitetura

- Frontend: Cloudflare Workers Static Assets.
- Backend: Google Apps Script.
- Base: Google Sheets.
- Comunicação: JSONP.

O endereço do backend já está definido em `public/config.js`.

## Cloudflare Workers Builds

- Repositório: `jofmoraes/riw-agenda-2026`
- Branch de produção: `main`
- Diretório raiz: `/`
- Build command: deixe vazio
- Deploy command: `npx wrangler deploy`

O nome do Worker deve ser `riw-agenda-2026`, igual ao campo `name` de `wrangler.jsonc`.
