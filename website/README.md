# Kiwimake website

A buildless HTML and CSS landing page. No client JavaScript, external fonts,
analytics, cookies or form submissions. Brand SVGs are copied from
`assets/brand/`. Light and dark themes follow the device preference.

## Deploy

Run from this folder with the existing Cloudflare login:

```powershell
npx --yes wrangler@4.161.0 deploy
```

Only `public/` is uploaded as static assets. `src/worker.mjs` redirects HTTP to
HTTPS and `www.kiwimake.ai` to `kiwimake.ai`, preserving the path and query.
Other requests go to the asset binding. Custom domains and managed certificates
are configured by `wrangler.jsonc`. The Worker uses the existing account and
does not require a paid plan, storage, database or add-on.

## URLs

- Preview and propagation fallback: https://kiwimake-website.xyzt70.workers.dev
- Primary: https://kiwimake.ai
- Redirect: https://www.kiwimake.ai

The GitHub repository and latest release assets were publicly accessible on
13 November 2026. Download URLs use `/releases/latest/download/` so later app
releases are picked up automatically, provided their asset names stay the same.

## Domain migration, 13 November 2026

Cloudflare zone: `kiwimake.ai`, **Free Website** plan.
Registrar remains Porkbun. Nameservers saved and read back from Porkbun:

- `javon.ns.cloudflare.com`
- `nola.ns.cloudflare.com`

Every record in Porkbun before the change:

| Type  | Name           | Content           | TTL         |
| ----- | -------------- | ----------------- | ----------- |
| ALIAS | kiwimake.ai    | pixie.porkbun.com | 600 seconds |
| CNAME | \*.kiwimake.ai | pixie.porkbun.com | 600 seconds |

Porkbun showed exactly two records. There were no MX, TXT, Resend, email
forwarding DNS or verification records to migrate. Its DNSSEC toggle was OFF
and registry DNSSEC showed zero records. DNSSEC was left off.

Both records were recreated in Cloudflare before the nameserver change. The
apex ALIAS was represented by Cloudflare's flattened CNAME. Both were DNS only
with 600-second TTLs. The scanner's two resolved apex A records were removed,
and its synthesized `www` CNAME was changed into the apex CNAME.

After the nameservers were saved, the copied apex parking CNAME was removed to
attach the website. Final Cloudflare DNS:

| Type   | Name            | Destination       | Proxy    | TTL         |
| ------ | --------------- | ----------------- | -------- | ----------- |
| CNAME  | \*.kiwimake.ai  | pixie.porkbun.com | DNS only | 600 seconds |
| Worker | kiwimake.ai     | kiwimake-website  | Proxied  | Auto        |
| Worker | www.kiwimake.ai | kiwimake-website  | Proxied  | Auto        |

Porkbun's previous nameservers were `curitiba.ns.porkbun.com`,
`fortaleza.ns.porkbun.com`, `maceio.ns.porkbun.com` and `salvador.ns.porkbun.com`.

At the final check, the zone was pending and public resolvers still returned
the previous nameservers. Allow up to 48 hours for nameserver caches to expire.
Cloudflare must activate the zone and finish managed certificate provisioning
before the custom-domain HTTPS endpoints can be verified publicly. Edge
Certificates showed managed certificates for both hostnames as Pending
Validation (TXT). Universal SSL is enabled, and Always Use HTTPS was enabled
and read back as on. No paid certificate options were activated.

## Verification

- Live workers.dev page returned HTTP 200, with the expected security headers.
- A nonexistent path returned the custom 404 with HTTP 404.
- Both public GitHub download URLs returned HTTP 200.
- Real Chromium checks at 1440 px and 390 px, in light and dark, confirmed
  all images loaded, FAQ expansion worked, no page errors and no horizontal
  overflow. Screenshots were inspected and mobile decoration overflow fixed.
- Worker redirect checks confirmed 301 to HTTPS on the bare domain, preserving
  path and query. Public custom-domain checks still depend on propagation.
- No app, companion, protocol or version files changed in this task.

Local evidence, excluded from Git, is in
`tmp/kiwimake-website-evidence/` at the repository root:
`desktop-light.png`, `desktop-dark.png`, `mobile-light.png`, `mobile-dark.png`,
`qa.json`, `porkbun-dns-before.png`, `cloudflare-dns-matched.png`,
`porkbun-nameservers-saved.png` and `cloudflare-final-dns.png`.

Provider references:
[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
and [Porkbun nameserver propagation](https://kb.porkbun.com/article/35-how-long-will-it-take-to-switch-nameservers).
