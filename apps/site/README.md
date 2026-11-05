# zorel.dev

A single static page, no build step: `index.html` (CSS and JS inline; fonts from Google Fonts). Open it in a browser
to preview. The install command points at the latest GitHub release's `install.sh`, which the release job uploads
next to the builds (nothing to keep in sync here).

Publishing: Cloudflare serves the folder as static files on `zorel.dev` and `www.zorel.dev` (`wrangler.jsonc`;
`_headers` adds the security headers; `.assetsignore` keeps this README and the config off the site):

```bash
cd apps/site && bunx wrangler@4.151.3 login    # once, as the Cloudflare account owner
cd apps/site && bunx wrangler@4.151.3 deploy
```

The releases must be public (a public repository) for the install command to work for anyone else.
