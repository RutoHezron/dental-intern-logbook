# Security and privacy

This is a healthcare-adjacent system: clinical training records that reference real patients by hospital number. Health data is **sensitive personal data** under Kenya's Data Protection Act 2019 (s. 2). The legal points below summarise the blueprint (§16). They are design inputs, **not legal advice**.

## Data minimisation (built in)

| Collected | Not collected |
|---|---|
| Hospital / outpatient number (as the paper logbook already requires) | Patient names, phone numbers, addresses, ID numbers, photos |
| Birth year, sex (for the under-17 rule and safety) | Free-text medical history in personal mode |
| A systemic-condition flag and structured alerts | Family member names (community genograms record only that a step was done) |
| Teeth, procedures, levels, diagnoses chosen by the intern | Intern health, mental-health or fitness-to-practise information |
| | Location, contacts or device data beyond what security needs |

How this is enforced:

- The `patient` table has **no** identity columns (a test asserts its exact columns).
- Community case follow-ups are never linked to a patient.
- Free text (complaint, notes, referral, findings, diary) is checked for phone numbers, ID-like numbers, emails and name patterns, and the intern is warned before saving.
- Demo and test data are fictional. The synthetic data generator is tested to contain no identifier-like text.

## Controls

| Area | MVP control | Planned |
|---|---|---|
| Authentication | Email one-time code (no passwords); sessions refresh automatically | Passkeys for supervisors; MFA for coordinators and admins; device PIN/biometric lock (V2) |
| Authorisation | Postgres RLS, forced, on every table; ownership pinned server-side; no anonymous access. A linked supervisor can **read** only entries and case reports submitted to them, with that visit's procedures and diagnoses, the intern's name and rotations — not patients' birth year or sex, other entries, the diary, reports or other supervisors' items — and cannot write any intern row | Coordinator policies |
| Integrity | Server guard: devices cannot mark entries verified; verified entries cannot change; append-only, hash-chained verifications (one chain on the phone, one per supervisor account, so they cannot fork each other); account sign-offs only through `supervisor_sign`, which checks the target, the signer and the chain head; finalised reports sealed with SHA-256 | Server-side re-computation of account hashes |
| Audit | `audit_log` records actor, action, table and row ID — never content; append-only | Exports and prints logged (V1) |
| Transport | HTTPS only | |
| Storage at rest | Server: provider disk encryption plus encrypted backups. Device: browser storage protected by the device's own encryption | Encrypted SQLite with a keystore-held key in the native app (V2) |
| URLs | Opaque UUIDs only; patient numbers never appear in URLs | |
| Logging | No clinical content in logs; sync payloads must not be logged (see deployment) | |
| Export and deletion | Full JSON backup; CSV exports (formula-injection safe); "Delete all data on this device" | Server-side account deletion with export (V1) |
| Phone storage | Data in app-private storage (native) or persistent browser storage. Android cloud backup and device-to-device transfer are **disabled** (`allowBackup=false`, data-extraction rules), so records never leave the phone without the intern choosing to. Intern-controlled backups go to `Documents/DentalLogbook`. | Optional passphrase-encrypted backups (V2) |
| Coordinator sharing | Opt-in by the intern with a one-time code; revocable at any time; the intern sees each coordinator's email. Coordinators have **no** row-level access to any intern table: one security-definer function returns aggregates only (counts per code, rotation dates, form held/grade/outcome, case-report statuses) | Institution-managed cohorts (V4) |
| Supervisor accounts | Invite codes are 60-bit, single use and expire in 7 days; only their SHA-256 is stored; the link can be set only by accepting a code and removed by the intern at any time. Supervisor sign-in is blocked on a device that holds an intern's logbook, so a logbook cannot start syncing into a supervisor's account | Passkeys for supervisors |
| Supervisor sign-off on the phone | Supervisor PIN stored only as a salted PBKDF2-SHA-256 hash (210k iterations) on the device, never synced; guessable PINs refused; each decision is an append-only, hash-chained verification; the server accepts PIN sign-offs only for the intern's own entries. **Limitation:** a PIN on the intern's own phone is weaker than a supervisor's own account, so this mirrors the paper book's trust model. | Supervisor accounts with passkeys and the chairside QR flow |
| Device loss | No identifiers stored; sign out from Settings | Remote session revocation and auto-lock (V2) |

## Clinical-safety and integrity rules

- Diagnoses are **never inferred** from procedures.
- Teeth are chosen on a chart, not typed, and invalid FDI numbers are blocked.
- Logbook codes come from transparent rules, are shown before saving, and are verified by a supervisor. Nothing counts as verified without one.
- Targets and gaps appear only in logbook and report views, never as treatment suggestions. Insight text avoids recommending procedures for patients.
- The app never claims competence. Portfolio and reports state that counts show exposure.

## Legal context (Kenya) — to confirm before any pilot

| Source | Consequence |
|---|---|
| DPA 2019 s. 25 (minimisation), s. 31 (DPIA), s. 43 (72-hour breach notice), s. 46 (health data via a health-care provider or a duty of confidentiality) | Minimised personal mode; a DPIA before the pilot; incident runbook; confirm the intern-as-processor basis with counsel |
| ODPC registration | The operator, and the facility in institutional mode, must register |
| Digital Health Act 2023, s. 47 (sharing outside Kenya), s. 25 (retention) | Prefer Kenyan hosting or a Kenyan copy; design for long retention; re-check the Act's court status |
| KMPDC acceptance of digital sign-off | Unknown. Until confirmed, printed pages keep wet signatures (V1 print pages) |

### Open items requiring decisions

1. A legal opinion on personal mode (the intern's records on a hosted service), and training-centre permission (blueprint Q18).
2. Hosting location (Kenyan data centre vs. Supabase Cloud region) and the operator's ODPC registration.
3. A retention period for training evidence after the completion certificate (Q17).
4. Whether KMPDC will accept digitally verified entries (Q1).

## Reporting a vulnerability

Report security issues privately to the project maintainer, not in public issues. Include steps to reproduce and do not use real patient data.
