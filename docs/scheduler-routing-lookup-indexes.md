# Scheduler routing lookup recovery — November 10

Production general-lane polls repeatedly timed out with PostgreSQL 57014. A rolled-back scheduler profile identified 463 sender selections taking 5.205 seconds and 410 original export manifest checks taking 1.360 seconds. Sender continuity checked all historical conversations, while the existing sender/recipient index covered only active threads. A representative absent-pair read scanned 23,513 threads and 929 buffers.

The migration adds three nonunique lookup indexes: all historical text number pairs, authorized customer-update SMS pairs, and the exact text representation of completed export IDs. It changes no functions, policies, grants, rows, sending identities, receipts, holds or customer controls. Retired other-account conversations remain binding; malformed batch IDs remain nonmatches. No paid development actions were issued.

The synthetic PostgreSQL fixture verifies unchanged results, retired-account conflicts, malformed identity handling, and indexed generic plans. The existing balanced-business-number routing suite passes continuity, unknown outcomes, disabled senders, account/role conflicts, opt-outs, Pause and final AI/manual admission.

Production applied migration 20261110145510. A subsequent rolled-back general poll took 3.189 seconds; 462 sender selections took 0.335 seconds, 409 manifest checks 0.144 seconds, and SMS projection 1.571 seconds versus 8.127 seconds before. These are diagnostic samples, not a claim of universal account recovery. Live completions and timeout recurrence are checked separately.

Rollback drops only the three added indexes. Existing indexes and all historical records remain intact. There is no application runtime change or new activation flag.
