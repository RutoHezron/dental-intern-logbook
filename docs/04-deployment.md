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
| `VITE_VAPID_PUBLIC_KEY` | Optional: public key for daily push reminders (see below). Without it the reminder toggle is hidden |

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
6. Add the first administrator (SQL editor). They manage supervisors and further administrators at `/admin`:

   ```sql
   insert into public.app_admin (email) values ('coordinator@hospital.org');
   ```

### Administrator: supervisors and interns

At `/admin` an administrator registers supervisors by email and links each one to their interns, without invite codes. Interns appear once they have signed in and synced. Linking either attaches the registered supervisor to a supervisor already in the intern's logbook (suggested when the names match, so entries already submitted to it reach them) or adds a new supervisor to the intern's logbook, which arrives on their phone at the next sync. A supervisor who has not signed in yet is linked the first time they sign in with that email.

The administrator sees interns' names, emails, licence numbers and supervisor names, never entries, patients or visits. A linked supervisor sees, at `/supervise`, the requests waiting for their sign-off and an activity feed of what each intern submitted to them (statuses and decisions, never drafts or patient numbers in the feed). Interns see who is linked and can disconnect a supervisor.

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

### Daily push reminders (optional)

Reminders carry counts and an in-app link only, at most one per device per day.

1. Generate a key pair: `npx web-push generate-vapid-keys`. Put the public key in `VITE_VAPID_PUBLIC_KEY` and rebuild the web app.
2. Deploy the sender and set its secrets:

   ```bash
   npx supabase functions deploy send-reminders
   ```

   ```bash
   npx supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.org CRON_SECRET=…
   ```

3. Schedule it once a day, for example 12:00 UTC (15:00 in Kenya), with Supabase Cron (Integrations → Cron) or SQL using `pg_cron` and `pg_net`:

   ```sql
   select cron.schedule('send-reminders', '0 12 * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
     )
   $$);
   ```

The function returns only counts (`due`, `sent`, `gone`, `failed`); it never logs endpoints or notification text. Subscriptions the browser has dropped are deleted, and so are those failing five days running.

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
