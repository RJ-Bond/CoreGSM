# CoreGSM

[Русский](README.md) · **English**

A self-hosted alternative to DiscordGSM. A web panel where you add game servers, and a Discord bot that posts a status card image in a channel and keeps it updated on a timer.

<p align="center"><img src="docs/banner.svg" alt="CoreGSM" width="720"></p>

![Card example](docs/card-preview.png)

- **Panel**: React and Tailwind. Servers, cards, channel bindings, roles, news, gallery, backups.
- **Backend**: Node.js 24, TypeScript, Express, [GameDig](https://github.com/gamedig/node-gamedig) (server queries), SQLite, PNG card rendering.
- **Bot**: discord.js 14. Sends one message with an image to a channel and edits it from then on.
- **Nginx**: HTTPS, HTTP redirect, Let's Encrypt with auto-renewal.
- **Proxy**: SOCKS5 and HTTP for the bot and the installer.

Everything installs with one command: the single `install.sh` script creates the project files, installs Docker and starts the containers.

> The full guide (Discord bot setup, roles, news, proxy, troubleshooting, internals) is in the Russian [README.md](README.md). This page covers the essentials.

## Requirements

- A Linux server (Debian or Ubuntu recommended) with root access, 1 GB RAM or more.
- For production: a domain pointing at the server, ports 80 and 443 open.
- A Discord application with a bot token (Discord Developer Portal → Applications → Bot).

## Install

On a LAN server (by IP, self-signed certificate) or on a server with a domain (Let's Encrypt), the steps are the same:

```bash
apt-get update && apt-get install -y curl
curl -fsSL --compressed https://raw.githubusercontent.com/RJ-Bond/CoreGSM/refs/heads/main/install.sh -o install.sh
sudo bash install.sh
```

The installer asks for the address (IP or domain) and prints a one-time setup code. Open the panel in a browser and use it to create the first administrator. Then add the bot token under Settings and invite the bot to your Discord server.

## Managing the install

After installation the `coregsm` command is available (run without arguments for a menu):

| Task | Command |
| --- | --- |
| Menu | `sudo coregsm` |
| Update | `sudo coregsm update` (`--check`, `--force`, `--yes`) |
| Roll back the last update (with the database) | `sudo coregsm rollback` |
| Service status | `coregsm status` |
| Diagnostics report (no secrets inside) | `sudo coregsm doctor` |
| Logs | `coregsm logs`, `coregsm logs bot`, `coregsm logs backend` |
| Restart, stop, start | `sudo coregsm restart`, `stop`, `start` |
| Backup / restore | `sudo coregsm backup`, `sudo coregsm restore` |
| Change domain or IP | `sudo coregsm domain` |
| Reset the admin password | `sudo coregsm reset-password` |
| Uninstall | `sudo coregsm uninstall` |

## Backups

`coregsm backup` writes `/opt/coregsm/backups/coregsm-DATE.tgz` (mode 600): a consistent database copy, news images, the logo, `.env` and certificates. Ten copies of each kind are kept. On restore, only the secrets that must match the database are taken from `.env` (`JWT_SECRET`, `INTERNAL_TOKEN`, `SECRETS_KEY`); the domain, version and certificates of the current server are kept.

**Metrics for Prometheus / Grafana.** `/api/metrics` is off until `METRICS_TOKEN` (at least 16 characters, e.g. `openssl rand -hex 24`) is set in `/opt/coregsm/.env`; after `coregsm restart` it serves the Prometheus text format with `Authorization: Bearer <METRICS_TOKEN>`: online, players and ping of every server, poll duration, bot state, database size, memory and free disk. For `prometheus.yml`: `metrics_path: /api/metrics`, `scheme: https`, `authorization: { credentials: <METRICS_TOKEN> }`.

## Secrets and security

The Discord token, SMTP password and RCON passwords are stored encrypted (AES-256-GCM) with a key derived from `SECRETS_KEY` in `.env`. Keep it in your backups. Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Updates

Updates come from signed GitHub Releases (`install.sh`, `version.txt`, Sigstore signature); if no release exists the installer falls back to the `main` branch. Set `COREGSM_CHANNEL=main` to force the branch.

## Development

`install.sh` and `version.txt` are generated from `src/` and `tools/`:

```bash
bash tools/build-installer.sh
```

Commit them together with your changes; the `check-installer` workflow fails if they are stale. Run the parts locally without Docker:

```bash
# backend (Node.js 24+ and a compiler for better-sqlite3)
cd src/core-backend && npm ci && npm run build
DB_PATH=./data/dev.db JWT_SECRET=dev-secret-dev-secret INTERNAL_TOKEN=dev-token-dev-token SETUP_TOKEN=dev-code npm start

# frontend (another terminal; /api is proxied to localhost:3000)
cd src/core-frontend && npm ci && npm run dev
```

## License

MIT
