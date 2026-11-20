# Optional complete-observation transport

Use `scripts/work-cohort-transport.mjs` when the full fixed-cohort result is too large for the database connector's response transport. This is an optional local tool. It does not execute SQL, append an observation, contact providers or change the default observer, classification or application. It requires existing `pgcrypto` functions in the `extensions` schema for the authorized read, and local GnuPG for decoding. It installs nothing in the database.

The renderer copies the complete current observation SELECT without changing its evidence fields, membership, ordering predicates or source timestamps. It wraps that SELECT once in the original `BEGIN READ ONLY` transaction and unchanged 20-second statement timeout. PostgreSQL aggregates every result row, converts the JSON text to UTF-8 bytes, compresses and encrypts those bytes with PGP AES256/ZLIB, and returns one envelope with byte counts, SHA256, exact member counts and the original minimum/maximum observation time. It does not paginate, rerun accounts, shorten receipt arrays or replace missing evidence with a success.

## Private local workflow

Use absolute paths in an existing private directory (mode `0700`). Baseline, key, rendered SQL, manifest and envelope inputs must be regular files accessible only to their owner (`0600`); symlink paths are refused. Outputs are exclusive new files and are never overwritten. Keep customer baselines, rendered SQL, keys, envelopes and decoded rows out of the repository and public comments. Rendered SQL contains the ephemeral key and fixed cohort IDs, so handle it as private data through the authorized database connection.

```bash
node scripts/work-cohort-transport.mjs key /absolute/private/cohort/read-key
node scripts/work-cohort-transport.mjs sql /absolute/private/cohort/baseline.json /absolute/private/cohort/read-key /absolute/private/cohort/read.sql
```

The second command writes `read.sql` and `read.sql.manifest.json`. The manifest binds the original baseline file, key fingerprint, sorted membership, exact original query and wrapped SQL. It contains hashes and counts, not the key or account IDs. Generate a fresh key for each read. The CLI reports only metadata; it never prints keys, SQL or evidence.

Execute the rendered SQL once through the authorized read-only database connection. Save its complete envelope privately as either the result object or a one-element result array; do not save connector prose or a truncated response as the envelope. Then run:

```bash
node scripts/work-cohort-transport.mjs decode /absolute/private/cohort/baseline.json /absolute/private/cohort/read-key /absolute/private/cohort/read.sql /absolute/private/cohort/envelope.json /absolute/private/cohort/rows.json
```

Decoding checks the manifest against the unchanged baseline, key, observer source and rendered SQL, then validates the envelope before launching GPG. GPG uses an isolated temporary home, receives the key on stdin, cannot prompt or start an agent, and is bounded to 15 seconds and the advertised output length. The helper caps raw output at 32 MiB and encrypted/input sizes separately. It verifies exact plaintext bytes and SHA256 before parsing JSON, then requires exactly one row per original member, no duplicates or extras, the original row shape, one identical timestamp string across every row and matching envelope time to microsecond precision. Only after every check passes does it write the original bytes to a new private output file. Wrong keys, corruption, changed sources, oversized/truncated responses, incomplete cohorts and mixed times produce no decoded output.

Decoding proves transport integrity and a complete single-snapshot result. It does **not** establish that the observation is newer than the existing history or verify that history's hash chain. No observation is appended automatically. Use the unchanged `work-cohort.mjs append` command separately with the original baseline and history directory; it performs current chain, membership and forward-time checks. A newly recovered full observation never fills an earlier missing period, and its original observation time must never be replaced by decode time. Preserve prior gaps and unknown outcomes. A timeout or verification failure remains a failed observation; do not increase the SQL timeout or prune evidence to make it pass.

## Verification

The aggregate regression checks exact SQL preservation and one bounded read, source binding, byte/digest/size errors, complete membership, microsecond timestamps, private/exclusive paths and unchanged classification and gap semantics. It has no GPG requirement for deployed application builds. A separate canonical CI step decrypts a small captured PostgreSQL `pgcrypto` fixture with local GPG and tests wrong keys, ciphertext tampering, output limits and the actual CLI. The fixture contains only synthetic accounts/evidence and an explicitly public test key, with a parameterized reproduction query. These checks establish transport mechanics; they do not establish zero customer stalls, provider delivery or production performance.
