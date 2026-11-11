# Zorel on a server

Zorel can run on a machine you control (a VPS or a box at home) and be used by a team: each person signs in, has
private chats and memory, and sees the projects they were added to. Spec: `specs/014-server-team/spec.md`.

## What it needs

- Linux with Docker or Podman (or Bun 1.4.4 to run from source).
- An address people reach over HTTPS: a domain behind a reverse proxy (Caddy below), or a Tailscale name.
  Plain HTTP is accepted only for `localhost`.
- One folder for the data (the database, the vault, the agents' files).

## Settings (environment)

| Variable | Required | What it is |
|---|---|---|
| `ZOREL_SERVER` | yes | `1` turns server mode on (the image sets it) |
| `ZOREL_PUBLIC_URL` | yes | The address people open, e.g. `https://zorel.example.com`. Passkeys, origins and OAuth returns come from it |
| `ZOREL_LISTEN` | no | Where the server listens. Default `127.0.0.1:4317`; the image uses `0.0.0.0:4317` |
| `ZOREL_TRUSTED_PROXIES` | no | Comma-separated addresses of your reverse proxies; only their `X-Forwarded-For` is believed |
| `ZOREL_HOME` | no | The data folder (the image uses `/data`) |

A misconfigured server refuses to start and says why. It never starts open.

## Run it

```sh
docker build -t zorel .
docker run -d --name zorel -p 127.0.0.1:4317:4317 \
  -v zorel-data:/data \
  -e ZOREL_PUBLIC_URL=https://zorel.example.com \
  -e ZOREL_TRUSTED_PROXIES=172.17.0.1 \
  zorel
docker logs zorel   # the one-time setup link (valid 1 hour)
```

Open the setup link, create the first owner, then add a passkey (or an authenticator code). After that the link
stops working. If it expired, restart the container for a new one (only while there's no owner).

## Reaching it

Zorel listens only on the machine's loopback (`127.0.0.1:4317`); it never changes the machine's network, firewall or
DNS. How your devices reach it is yours to choose. Every way below carries the app's one WebSocket (`/rpc`) and HTTPS;
the address you pick is `ZOREL_PUBLIC_URL`, and it must be HTTPS (sign-in cookies are `Secure`; plain HTTP works only
on the machine itself).

| Way | What it exposes | Notes |
|---|---|---|
| Reverse proxy with HTTPS (Caddy, below) | The machine's IP, port 443 | Simplest with a domain; keep the machine patched |
| Tailscale (below) | No inbound port; a tailnet-only HTTPS name | Free plan: 6 users, non-commercial |
| WireGuard (your own) | One UDP port that answers no unauthenticated packet | Free and open; each device needs the WireGuard app. Point a domain name at the private address and get a certificate by DNS validation (Caddy with a DNS plugin), so it's still HTTPS |
| Headscale / NetBird | Like Tailscale, with coordination you host | The coordinator must be reachable from the internet |
| Cloudflare Tunnel | No inbound port, IP hidden, a public HTTPS name | Free with a domain on Cloudflare; TLS ends at Cloudflare, so it can read the traffic |

### HTTPS with Caddy

```caddyfile
zorel.example.com {
  reverse_proxy 127.0.0.1:4317
}
```

Caddy gets the certificate and passes WebSockets through. Set `ZOREL_TRUSTED_PROXIES` to the address Caddy connects
from (the Docker bridge, `172.17.0.1`, when Caddy runs on the host). With nginx, pass the WebSocket upgrade:

```nginx
location / {
  proxy_pass http://127.0.0.1:4317;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

### Tailscale (no public domain)

```sh
tailscale serve --bg 4317
```

Then `ZOREL_PUBLIC_URL=https://<machine>.<tailnet>.ts.net`. Only people in your tailnet reach it. Don't use
`tailscale funnel`: it makes the server public.

### Cloudflare Tunnel

```sh
cloudflared tunnel --url http://127.0.0.1:4317   # or a named tunnel with your hostname
```

Then `ZOREL_PUBLIC_URL=https://<your hostname>`. Consider a Cloudflare Access policy in front of it as a second gate.

## The team

- **Settings › Team**: invite by link or QR (valid 24 h, the role is fixed when made), change roles, remove people.
  Removing someone signs them out at once, revokes their phones and pauses their routines.
- Admin actions ask you to confirm it's you (a sign-in in the last 5 minutes).
- **Phones**: "Pair a phone" shows a QR for the Zorel app (5 minutes). Confirm the phone by its name afterwards.
- A project's people: in the project's settings, admins tick who belongs. Owners and admins see every project.

## From the desktop app

**Install it from the app**: **Settings › General › Servers › Install on another computer** opens a chat with Zorel's
Installer. Give it the computer's SSH address (`user@host`) and the HTTPS address you'll use; add the key it shows
to `~/.ssh/authorized_keys` there; compare the computer's key when asked. It then checks the machine, gets the code,
builds and runs the container on `127.0.0.1:4317` only, one command at a time, each shown for your OK, and ends with
the setup link. Linux with Docker and git; on a team server only admins can use it.

**Switch between them**: with a server added, the app's name at the top of the sidebar becomes where you are; press it
for this computer and every server (with whether each answers now) or use ⌘1…⌘9 (Ctrl+1…9 on Windows and Linux).

People can use the team server from a browser, or from the Zorel desktop app: **Settings › General › Servers**, paste
the server's address or an invite link, **Connect** (or copy the link and use **Servers › Connect with the copied
link** in the app menu; on Windows and Linux, in the tray icon's menu). Each server opens in a window of its own and
keeps its own sign-in. Agents, files and the agents' browser stay on the server: the app only shows it. When the last
thing open was a team server, the app doesn't start its own local server until you switch to **This computer**.

## Engines and connectors

- **Claude Code / Codex subscriptions**: Settings › Providers › Sign in. On a server the CLI can't open a browser:
  the screen shows its link (and a device code for Codex). Open it, then paste the code the page gives back.
- **API keys**: Settings › Providers, stored in the vault.
- **Connectors (OAuth)**: the service sends you back to `ZOREL_PUBLIC_URL/api/oauth/callback`; register that
  address where the service asks for a redirect URL.

## Backup and restore

Everything is in the data folder. Stop the server and copy it whole:

```sh
docker stop zorel
docker run --rm -v zorel-data:/data -v "$PWD":/backup alpine tar czf /backup/zorel-data.tgz -C /data .
docker start zorel
```

`vault.key` (in the data folder) unlocks `vault.json`, which holds the sign-in secret, the server's identity key,
API keys and connector tokens. Without it, people must sign in again, phones must pair again and keys must be set
again. Keep backups as private as the server itself.

To restore, put the folder back in place (same `vault.key`) and start the server.

## Updating

Build the new image and run it on the same volume. Database changes apply at start.
