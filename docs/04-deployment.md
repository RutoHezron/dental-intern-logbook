# Deployment

There are two independent parts: the **web app** (static files) and, optionally, the **sync server** (Supabase / Postgres). Without a sync server the app is fully functional and keeps records on each device.

> Before any pilot with real interns: complete the legal and privacy steps in [06-security-privacy.md](06-security-privacy.md) (legal opinion, DPIA, ODPC registration, training-centre permission). Never load real patient data into development or demo environments.

## 1. Web app

```bash
npm ci
```

```bash
npm run build -w @logbook/web
```

The output in `apps/web/dist/` can be served by any static host that supports HTTPS and a single-page-app fallback (unknown paths → `index.html`), such as Netlify, Cloudflare Pages, Vercel, an S3/CloudFront bucket, or nginx on a Kenyan host.

Requirements:

| Requirement | Why |
|---|---|
| **HTTPS** | Service workers (offline use) and secure sign-in require it |
| SPA fallback to `/index.html` | Deep links such as `/logbook/code/OMF%202` |
| `Cache-Control: no-cache` on `/sw.js` and `/index.html` | So updates reach devices; hashed assets under `/assets/` can be cached for a long time |
| Security headers | `Content-Security-Policy` (self plus the Supabase URL), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` |

Example nginx block:

```nginx
location / { try_files $uri /index.html; }
location = /sw.js { add_header Cache-Control "no-cache"; }
location = /index.html { add_header Cache-Control "no-cache"; }
location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
```

### Build-time configuration

`apps/web/.env` (see `.env.example`). Values are compiled into the bundle and are public by design:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project API URL; leave empty for a local-only build |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (safe in the client; access is enforced by RLS) |

Never put the **service-role** key in the web app.

## 2. Sync server (Supabase)

You can use Supabase Cloud or self-host it. Self-hosting suits a Kenyan data centre if the hosting question in §6 requires one; Supabase is open source and the schema is plain Postgres.

1. Create a project in the chosen region, or start a self-hosted stack.
2. Link it and apply the migrations:

   ```bash
   npx supabase link --project-ref <ref>
   ```

   ```bash
   npx supabase db push
   ```

3. Configure **Auth**:
   - enable email sign-in with a one-time code (OTP length 6, short expiry such as 15 minutes);
   - set a production SMTP provider for code emails;
   - set the site URL to the web app's URL;
   - turn off anonymous sign-ins.
4. Copy the API URL and anon key into the web app's build configuration and rebuild.
5. Check that RLS is enabled on every public table (Dashboard → Advisors → Security). The migrations force RLS.

### Local development stack

With Docker running:

```bash
npx supabase start
```

| Service | Address |
|---|---|
| API | http://localhost:54321 |
| Studio | http://localhost:54323 |
| Email viewer (sign-in codes) | http://localhost:54324 |

## 3. Backups and recovery

| Layer | Practice |
|---|---|
| Server | Point-in-time recovery (Supabase Pro or above), plus an encrypted daily logical backup (`pg_dump`) to a separate location, ideally a Kenyan copy. Test a restore every quarter. |
| Device | **Settings → Export full backup** produces a JSON file of everything on the device; **Restore from backup** replaces the device's data. Interns using local-only builds should export regularly. |
| Breach response | The Data Protection Act requires notifying the Data Commissioner within 72 hours (processors notify controllers within 48 hours). Keep an incident runbook with contacts. |

## 4. Updating

- **App:** deploy a new build. Devices pick up the new service worker on their next visit (`registerType: 'prompt'`); an in-app "update available" prompt is planned for V1.
- **Database:** add a new migration file. Never edit an applied one. Run `npm test -w @logbook/db` before `db push`.

## 5. Monitoring

- Error reporting must not capture clinical content. Scrub request bodies, and never log `sync_push` payloads.
- Watch the Supabase logs for repeated `sync_push` rejections; they usually point to a client bug.
- `audit_log` records who wrote which row, without content. Retain it according to the policy agreed with the training centre.
