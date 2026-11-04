# Security

Zorel runs AI agents that read and edit your projects, run commands, browse the web and call your tools, so its
permission model matters. If you find a way around it, please tell us privately.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/gustavowlima/zorel/security/advisories/new).
Please don't open a public issue. Include what an attacker could do, the steps to reproduce and the version you
tested. You'll get an answer within a few days.

Especially interesting:

- another process on the computer (an agent included) calling Zorel's local API without the session secret;
- an agent at "Workspace" or "Ask first" writing outside its folder, reaching the network from its shell, or raising
  its own access;
- a sensitive action running without its approval card, or an approval that runs something other than what it showed;
- content from a web page, a file or a tool result making an agent act on its own (prompt injection that crosses a
  permission boundary);
- secrets (API keys, connector tokens, the agents' saved logins) leaving the system keychain or reaching a model.

## How Zorel keeps agents in bounds

- The server listens on 127.0.0.1 only and every API call carries a per-launch session secret that no process it
  starts inherits.
- Below "Full access", an agent's shell runs in an OS sandbox (Seatbelt on macOS, bubblewrap on Linux): writes only
  in its folder, and for Claude Code no network from the shell. Where there is no sandbox, only read-only commands
  run without asking.
- An approval card shows the whole action it approves; an action too large to show is refused.
- Secrets live in the system keychain (Keychain, libsecret, Credential Manager), never in the database, and are
  masked in logs. Credentials are removed before a conversation reaches the memory model.
- The agents' browser is a separate Chromium driven over a pipe, one isolated context per agent, with its saved
  logins encrypted by a key in the keychain.
- Everything stays on your computer: conversations, memory, logins. There is no Zorel server.
