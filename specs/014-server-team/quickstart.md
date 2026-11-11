# Quickstart: checking spec 014 by hand

Automated: `bun test apps/server/src/server-mode.e2e.test.ts` (setup, sign-in, team, privacy, chat socket,
devices, OAuth return) and `bun test apps/server/src/browser.test.ts` (control lease, masked frames; needs Chrome).
What follows needs a person: passkeys, the phone, the engines' sign-in pages.

## 1. Start a server locally

```sh
bun run build
ZOREL_SERVER=1 ZOREL_PUBLIC_URL=http://localhost:4317 ZOREL_HOME=$(mktemp -d) bun apps/server/src/main.ts
```

Expected: "Zorel needs its first owner. Open (valid 1 hour): http://localhost:4317/setup?t=…".

## 2. Owner, passkey, step-up

1. Open the link: name, e-mail, password. You're signed in; add a passkey when asked.
2. Sign out, sign in with the passkey. Expected: in.
3. Wait 5 minutes, invite someone (Settings › Team). Expected: "Confirm it's you"; after the passkey the invite is made.

## 3. A member

1. Open the invite link in a private window, join. Expected: an empty chat list, no Team admin actions.
2. As the owner, create a project and a chat in it. Expected: the member doesn't see them.
3. Tick the member in the project's people. Expected: the project and its chat appear for them.
4. Remove the member. Expected: their window is signed out at the next request.

## 4. The agents' browser

1. As the owner, have an agent open a page with a password field in a project chat; the member watches.
2. The member clicks the page. Expected: "You can watch this browser…" (members only watch others' chats).
3. The owner clicks the password field and types. Expected: the member's view blurs with "Hidden while a password or
   card is typed"; the agent's next browser step says "A person has control".
4. Wait 2 minutes without input. Expected: control returns to the agents; the activity log has both events.

## 5. Phones

Settings › Team › Pair a phone shows a QR. With a test client (see the e2e test's fake device), claim the code,
confirm by name, ask for a session. Expected: the device lists as active; removing it ends its session at once.

## 6. Engines on a server

Settings › Providers › Claude › Sign in. Expected: the CLI's text with a link; after the page, paste the code and
send. The account shows as signed in.

## 7. Docker

```sh
docker build -t zorel . && docker run --rm -p 127.0.0.1:4317:4317 -e ZOREL_PUBLIC_URL=http://localhost:4317 zorel
```

Expected: the setup link in the output; the agents' browser works (headless Chromium in the image).
