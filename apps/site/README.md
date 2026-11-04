# zorel.dev

A single static page, no build step: `index.html` (CSS and JS inline; fonts from Google Fonts). Open it in a browser
to preview. The install command and the Windows link point at R2 (`zorel-releases`, `latest/`), where the release
job copies each release's files (`apps/desktop/scripts/r2-sync.sh`); nothing to keep in sync here.

Publishing: Cloudflare serves the folder as static files on `zorel.dev` and `www.zorel.dev` (`wrangler.jsonc`;
`_headers` adds the security headers; `.assetsignore` keeps this README and the config off the site):

```bash
cd apps/site && bunx wrangler@4.151.3 login    # once, as the Cloudflare account owner
cd apps/site && bunx wrangler@4.151.3 deploy
```

The downloads come from R2, so they work for anyone while the repository is private.
