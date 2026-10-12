# Sync API

The device talks to the server through two Postgres functions, exposed by Supabase as RPC endpoints. Both run as the signed-in user (`security invoker`), so row-level security applies to every row they touch. Anonymous calls are refused.

```
POST /rest/v1/rpc/sync_push   { "changes": PushChange[] }   → PushResult
POST /rest/v1/rpc/sync_pull   { "since": number }           → PullResult
```

Headers: `apikey: <anon key>` and `Authorization: Bearer <user access token>`. The app uses `supabase-js`'s `rpc()`, which sets both.

## Wire format

Device records are camelCase; rows are snake_case. `toWire()` and `fromWire()` in `packages/core/src/sync/wire.ts` convert between them and are shared by the app and the database tests.

| Device table | Server table |
|---|---|
| facilities | facility |
| internships | internship |
| supervisors | supervisor |
| rotations | rotation |
| patients | patient |
| encounters | encounter (+ `procedures`, `findings`, `investigations` arrays) |
| activities | activity |
| entries | logbook_entry |
| verifications | verification (pull only) |
| reflections | reflection |
| snapshots | report_snapshot |

`fromWire()` removes server-only columns (`owner_id`, `server_seq`, `server_received_at`). It drops nulls from optional fields but keeps meaningful nulls (`rotationId`, `patientId`, `supervisorId`, `deletedAt`, `prevHash`). A report snapshot's `payload` is passed through unchanged.

## `sync_push(changes)`

```ts
interface PushChange { table: string; op: 'upsert' | 'delete'; record: object }   // record in snake_case
interface PushResult {
  accepted: { table: string; id: string }[];
  rejected: { table: string; id: string; reason: string }[];
}
```

- Up to **500** changes per call. The app sends 200 at a time, parents first: facility, internship, supervisor, rotation, patient, encounter, activity, logbook_entry, reflection, report_snapshot.
- Each change runs in its **own savepoint**. A rejected change (a constraint violation, an RLS refusal, an attempt to edit a verified entry) is reported and the rest of the batch still applies.
- `upsert` is `INSERT … ON CONFLICT (id) DO UPDATE` using only the columns present in the record. Unknown keys are ignored. `owner_id` and other server columns sent by a device are ignored; ownership is always the caller's.
- `delete` sets `deleted_at` (a soft delete), and pulls return the row as a tombstone.
- An encounter's `procedures`, `findings` and `investigations` replace the stored children.
- Tables a device must not write (`verification`, `audit_log`, `profile`) are rejected.

Typical rejection reasons:

| Reason | Cause |
|---|---|
| `Only a supervisor verification can mark a logbook entry as verified` | The device tried to set an entry `verified` |
| `Verified logbook entries cannot be changed; add a correction instead` | Edit of a verified entry |
| `new row violates row-level security policy …` | Another account's record |
| `… violates check constraint …` | Invalid value, e.g. an unknown visit type |

## `sync_pull(since)`

```ts
interface PullResult {
  cursor: number;                                    // store and send next time
  changes: Record<string, Record<string, unknown>[]>; // keyed by server table
}
```

- Returns every row **owned by the caller** with `server_seq > since`, including soft-deleted rows, in cursor order. The owner filter is explicit (not only row-level security), so a supervisor who also keeps a logbook never pulls their interns' rows into it.
- Encounters include their child arrays.
- `since = 0` returns everything; the app does this after sign-in to restore a logbook on a new device.

## Supervisor accounts

| Function | Caller | Does |
|---|---|---|
| `create_supervisor_invite(p_supervisor)` | Intern | Returns a one-time code `XXXX-XXXX-XXXX` (60 bits, single use, 7 days) for one of their supervisor records. A new invite cancels an unused one. |
| `accept_supervisor_invite(p_code)` | Supervisor | Links the supervisor record to the caller's account. Refuses expired, used and self-invites. Only this function (and `unlink_supervisor_account`) can set `supervisor.user_id`; a device push never changes it. |
| `unlink_supervisor_account(p_supervisor)` | Intern | Removes the supervisor's access. |
| `supervisor_queue()` | Supervisor | Links (intern, the name the supervisor is listed under, chain tip) and the entries and case reports awaiting them, with visit context. Read through row-level security policies that expose only items submitted to that supervisor. |
| `supervisor_sign(p_records)` | Supervisor | Appends `method = 'account'` verifications. Each must target an item submitted to that supervisor and still awaiting verification, and must extend the head of that supervisor's chain (checked under an advisory lock). A stale head fails with `chain_moved`; the client reloads and rebuilds once. All-or-nothing per call. |

## Coordinator shares

| Function | Caller | Does |
|---|---|---|
| `create_coordinator_invite()` | Intern | One-time code to share progress (needs the internship on the server). |
| `accept_coordinator_invite(p_code)` | Coordinator | Starts the share; records the coordinator's email for the intern to see. |
| `my_coordinator_shares()` / `revoke_coordinator_share(p_share)` | Intern | Who can see my progress; stop sharing. |
| `coordinator_cohort()` | Coordinator | For each intern sharing with the caller: name, licence, facility, period, rotation dates, counts per code (logged, verified, waiting, returned, last date), assessments (kind, held on, overall grade, outcome) and case-report statuses. No entry rows, patients, visits or free text. Progress is computed in the browser with `cohortMember()` from `@logbook/core`. |

The supervisor's device builds and hashes the records with the same code the intern's phone uses (`buildAccountSignatures` in `@logbook/core`); the intern's device checks every chain when it pulls them.

## Client engine

`apps/web/src/sync/engine.ts` exposes `syncOnce(transport)`. The transport interface (`push`, `pull`) lets the same engine run against Supabase in the app and against PGlite in tests. See [01-architecture.md § Offline and sync](01-architecture.md#offline-and-sync) for scheduling and conflict rules.
