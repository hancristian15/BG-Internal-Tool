# BuyGoods Funnel Builder

Static funnel builder hosted on Vercel, with serverless API routes for Supabase click counts and saved documents. Generated document text is stored in a private Cloudflare R2 bucket; Supabase stores searchable metadata, product variants, and the builder state needed to reopen a document for editing.

## Document storage setup

### 1. Create the Supabase table

Run `supabase/migrations/20261006010000_funnel_documents.sql` once in the Supabase SQL Editor. The document API uses the existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` Vercel environment variables. The secret key must be server-side only.

### 2. Create a private R2 bucket and key

Create a bucket for generated documents in Cloudflare R2. Create an S3 API token scoped to that bucket with object read/write permissions. Keep the bucket private; shared previews are fetched by the Vercel API using an unguessable share token.

Add these Vercel environment variables to Production, Preview, and Development as needed:

| Variable | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 S3 access key ID |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret access key |
| `R2_BUCKET` | Name of the private R2 bucket |

The app also needs the existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` variables. Do not add secret values to Git or the browser code.

## Tool login and shared previews

Run `supabase/migrations/20261029000000_tool_access_password.sql` once in the Supabase SQL Editor, then initialize the password record with `insert into public.tool_access_settings (singleton, password_hash) values (true, extensions.crypt('YOUR_TEAM_PASSWORD', extensions.gen_salt('bf', 12))) on conflict (singleton) do update set password_hash = excluded.password_hash, updated_at = now();`. Replace `YOUR_TEAM_PASSWORD` with your chosen value in the SQL Editor; do not commit the actual password. The database stores only a bcrypt hash. The login API verifies it through Supabase using the existing server-side `SUPABASE_URL` and `SUPABASE_SECRET_KEY` variables. No additional Vercel environment variable or proxy configuration is needed.

Without a `share` query parameter, the page checks for a signed, HTTP-only login session before showing the tool. The session lasts 7 days and is signed using the existing `SUPABASE_SECRET_KEY`. Private document operations, click totals, and tracking verification APIs also require that session. A URL with `?share=...` opens only the read-only preview and remains public, including its creation date.

## How saved documents work

- Generate checks for documents with the same account ID and product name. If a match exists, choose to open the existing document for editing or save this generation as a second document.
- A new document is written to R2 and indexed in Supabase. Product variants include step, product name, bottle count, codename, and SKU.
- Search accepts an account ID or product name. Edit restores the stored builder settings and resolved flow.
- The share URL opens a read-only preview and shows the original creation date. Logged-in users can search and edit; anyone with a share URL can view that document.
- Display names use `Product - Account ID - DD/MM/YYYY`. Downloaded filenames use `DD-MM-YYYY` because slashes are path separators on common operating systems.

## Affiliate Manager

The Affiliate Manager view is available from the right side of the in-page tool navigation. It opens a public HTTP or HTTPS offer page in a clean headless Chromium session, waits for page scripts to run, then checks the rendered BuyGoods tracking code and checkout links for `sessid2` and `aff_id`. The hosted verifier is implemented in `api/verify-tracking.js`; its front-end is in `affiliate-manager.js`.

The verifier rejects non-public hosts, private or loopback IP addresses, and non-standard ports. It uses `@sparticuz/chromium` with `puppeteer-core`, so the Vercel project runs on Node.js 24.x.

If the destination returns HTTP 403, use **Verify without leaving this page**. This option uses the local Chrome/Edge extension in `browser-extension/` to open the offer in an inactive background tab, inspect its rendered source after scripts run, and return only the tracking results. The tool tab remains active. The personal extension requests access to all sites once when it is loaded; it does not read cookie values or send page HTML to the tool server.

To install it, open `chrome://extensions` (Chrome) or `edge://extensions` (Edge), enable **Developer mode**, choose **Load unpacked**, and select the repository's `browser-extension/` folder. Accept the browser's initial full-site access prompt. It will not ask separately for each site. The content bridge currently matches the dev and production Vercel aliases declared in `browser-extension/manifest.json`.

The Affiliate Manager also includes utilities to clean BuyGoods checkout links down to the integration fields (`account_id`, `product_codename`, `lang`, and `redirect`) and to add or replace an `aff_id` query parameter on a URL.

The postback checker requires an exact BuyGoods `{SUBID}` or `{SUBID2}`–`{SUBID5}` macro, replaces it with a unique test click ID, and sends a local browser request with `amount=0`. It displays the HTTP status and response text; a successful HTTP response confirms the endpoint answered, not that a synthetic click was attributed. The InitiateCheckout pixel generator creates a hidden 1×1 `<img>` tag and can add `type=InitiateCheckout` for RedTrack URLs.

If the local browser also receives HTTP 403, the result includes a Cloudflare Ray ID when the response has one. In Cloudflare, open the zone's **Analytics → Events**, filter around the request time by host/path and Block or Challenge, then inspect the matching event's service and rule. If no event matches, the block may be at the origin or another CDN. Cloudflare recommends using a narrowly scoped custom-rule Skip exception when a specific false positive is confirmed; do not disable all firewall protections for this check.
