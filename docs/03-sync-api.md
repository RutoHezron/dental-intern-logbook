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

- Returns every row of the caller's with `server_seq > since`, including soft-deleted rows, in cursor order.
- Encounters include their child arrays.
- `since = 0` returns everything; the app does this after sign-in to restore a logbook on a new device.

## Client engine

`apps/web/src/sync/engine.ts` exposes `syncOnce(transport)`. The transport interface (`push`, `pull`) lets the same engine run against Supabase in the app and against PGlite in tests. See [01-architecture.md § Offline and sync](01-architecture.md#offline-and-sync) for scheduling and conflict rules.
