# Server with a team, native mobile app and the browser on the phone

Research and decisions, 2026-11-10. Inputs for specs 014 (server with a team) and 016 (Expo app). Common approaches
in comparable products were studied, then each choice was weighed on security first, then performance and UX,
against primary sources. Where Zorel differs from the common approach, the reason is given. "?" marks a number still
to be measured on a real device.

## Decided by the user

- Native Expo app first (not a PWA); a team (invites, roles) in the first server version.
- Connection: direct first (Tailscale, or a reverse proxy with HTTPS); a WebRTC relay later, so the app's transport
  stays swappable.
- Push through a thin relay of ours that carries no content.
- Passkeys first, password + TOTP as fallback, recovery codes.
- Site logins in an agent's browser are per agent **and** per person (a project agent may use a project profile).

## Access and the team

| Decision | Common approach | Zorel | Why |
|---|---|---|---|
| First access | permanent owner token link | One-time setup token printed on the console | A permanent token that leaks is access forever |
| Team login | bearer key in a 1-year cookie; or a cloud account | Passkey; password + TOTP for IP-only installs; recovery codes | Phishing-resistant, needs no e-mail service (NIST 800-63B, OWASP MFA cheat sheet) |
| Sessions | long cookie | Server-side table, hashed token, `__Host-` Secure HttpOnly cookie, idle + absolute timeout, a fresh passkey for admin actions | Revoking = deleting the row (OWASP Session Management) |
| Passkey RP ID | — | From the configured public URL, never from Host; warn when the domain changes | A forged Host can't steer the ceremony; a domain change orphans passkeys (WebAuthn L3 §RP ID). Bare IPs are not valid RP IDs |
| CSRF | same-origin check | `Origin` equal to the configured URL plus `Sec-Fetch-Site`, WebSocket included; bearer clients exempt | Defense in depth (OWASP CSRF) |
| Brute force | per-IP lock | Per IP **and** per account/invite/pairing, growing backoff; client IP only from a trusted proxy header | Per-IP alone is bypassed by changing IP (OWASP credential stuffing) |
| Authorization | role per RPC method | Role **and** resource (the person's projects) on every route; personal memory reaches only its owner | AGENTS.md non-negotiables |

## Mobile app

| Decision | Common approach | Zorel | Why |
|---|---|---|---|
| Pairing | QR pinning the host key, 2 min | QR {public URL, SPKI SHA-256, 128-bit one-time secret, ≤5 min}; an admin confirms the device by name | A photographed QR alone doesn't get in (Syncthing device ids; OWASP Mobile M5) |
| Device identity | bearer token | P-256 key in Secure Enclave / Keystore signs token refresh and approvals; reads use a 1 h bearer | A leaked token (logs, backups) can't approve. Secure Enclave does P-256, not Ed25519 (?) |
| Passkey in the app | — | Ceremony in the system browser (ASWebAuthenticationSession) against the server's origin, code exchanged with PKCE (RFC 8252) | Native passkeys need associated domains compiled into the store build: impossible for each user's domain |
| Push | a relay sees title and body, or forwards a host-encrypted payload | Our relay holds the Expo access token, servers register with their own key, the push carries only an event id; the app fetches details. End-to-end encryption later | Without "enhanced push security" anyone holding an Expo token can push; with it, the access token can't be handed to every server (docs.expo.dev push) |
| Approve from a notification | lock-screen Approve when the command fits | Opens the app, shows the whole action, biometric prompt, approval signed by the device key; the server checks pending, expiry, device not revoked | Local biometrics alone is a UI gate |

## The browser on the phone

| Decision | Common approach | Zorel | Why |
|---|---|---|---|
| Capture | CDP screencast JPEG q60, acked by the host | `Page.startScreencast` with `maxFramesInFlight: 1`, `sendLastFrame: true`; ack CDP only after the phone acks | Pacing follows the phone and the network end to end (Page.pdl) |
| Transport | binary, but base64 inside the phone's WebView | Binary WebSocket message: small header (id, width, height, time) + raw JPEG; JSON only for control. Also for the web panel | ~33% fewer bytes, no big strings to decode |
| First picture | — | One `captureScreenshot` when a viewer joins | A still page sends no screencast frames |
| Slow links | — | Measure RTT; step quality 60→40, size 1280→960→640, or frame rate | Fluid on cellular (thresholds ?) |
| Drawing | Skia fed through a WebView | react-native-skia from bytes (`Skia.Data.fromBytes` → `MakeImageFromEncoded`), dispose the previous image | No second JS engine, no data-URI cache flicker. Decode cost at 1280x800 ? |
| Gestures | trackpad by default | Direct tap by default (Windows App "Direct touch"); long press = right click; two-finger drag = wheel; pinch zooms the picture locally; trackpad mode with a cursor as an option | Tapping where you mean is natural on web pages |
| Text | — | Hidden native TextInput: committed text via `Input.insertText`, special keys via `dispatchKeyEvent` | Phone keyboard, accents and emoji work (Input.pdl) |
| Coordinates | fractions of a named frame | Fractions 0–1 plus the frame id, mapped to that frame's viewport | Survives letterboxing, local zoom and resizes |
| Viewport | fixed 1280x800 | 1280x800 while the agent works; a mobile viewport only during a human takeover, restored after | A mobile viewport reflows the page and breaks the agent's refs (Emulation.pdl) |
| Security | tabs holding secrets refuse view | Separate **watch** and **control** permissions checked per message on the server; a takeover lease (TTL + heartbeat) in the audit log; frames blurred while a password or card field has focus; only people with access to the project see it | In a team not everyone may watch every agent |
| Video | — | WebRTC only with the relay | ~4–8× less bandwidth (?) but needs an encoder and TURN |

## Sources

- OWASP cheat sheets: Session Management, Authentication, MFA, CSRF, Credential Stuffing — cheatsheetseries.owasp.org
- NIST SP 800-63B — pages.nist.gov/800-63-4/sp800-63b.html
- WebAuthn Level 3, RP ID — w3.org/TR/webauthn-3/#rp-id
- RFC 8252 (OAuth for native apps), RFC 9449 (DPoP, deferred)
- Expo: push sending, SecureStore, LocalAuthentication — docs.expo.dev
- react-native-passkeys — github.com/peterferguson/react-native-passkeys; Apple associated domains docs
- Syncthing device ids — docs.syncthing.net/dev/device-ids.html; ntfy iOS instant notifications — docs.ntfy.sh
- Chrome DevTools Protocol Page/Input/Emulation domains — github.com/ChromeDevTools/devtools-protocol
- react-native-skia images — github.com/wcandillon/react-native-skia
- Windows App touch input — learn.microsoft.com/en-us/windows-app/input-keyboard-mouse-touch-pen; RustDesk mobile docs
