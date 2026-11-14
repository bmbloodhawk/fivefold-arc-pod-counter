# Counter diagnostic and recovery scheduling

This is local foundation work, not a deployed capacity claim. The staging baseline
is `d3f8442`; production and Firebase configuration are unchanged.

## Contract

`server/src/keyed-write-queue.js` runs at most eight independent queued operations
per ledger by default (constructor range 1–32). Each room keeps FIFO order across
events, recovery snapshots, checkpoints, notes, field-test records and completion
archives. Every queued Table record requires a nonempty room code before admission;
standalone source repair uses `retrySourceArchive`. Generic path writes such as
feedback review use their path, since they do not overwrite room/event state.
The adapter freezes JSON bytes when admitting a normal write. It does not discard
events, coalesce snapshots or add storage operations.

A completion waits for earlier writes for its own room and acknowledges its own
immutable archive. Independent rooms do not wait on that room. Failed normal writes
still make three attempts, log failure, and allow later work to proceed. A failed
completion rejects its caller and logs the archive error. `flush()` waits for the
jobs admitted at the time of the call, including rejected attempts; it does not
wait for future traffic. It is not itself proof that every write succeeded.

Direct `read`, `write`, `update` and archive-repair calls retain their existing
independent behavior; the queue is not a global limit on every database request.
Token refresh is shared by concurrent callers on the same ledger, clears its
in-flight promise after success/failure, and retains the existing expiry margin.

Unused response bodies are drained without retaining a second JSON copy, including
412 conflicts and errors. A truncated success body fails visibly; normal queued PUTs retry
the same bytes. A truncated error echo retains status-driven behavior: 412 still
retries the conditional update or verifies the existing immutable source. This can
leave a committed write whose success response failed, so source
archives retain their conditional-write/idempotent verification protocol. Node's
[Undici documentation](https://github.com/nodejs/undici/blob/main/README.md#garbage-collection)
requires consuming or cancelling unused bodies to release connection resources.
Firebase's [REST documentation](https://firebase.google.com/docs/database/rest/save-data#print)
also describes `print=silent`; that separate response-bandwidth optimization is not
part of this slice.

The queue bounds **in-flight concurrency, not backlog size**. Admitted pending work
can still grow when arrival rate exceeds storage throughput. Process loss can still
lose queued writes; this is not the later fenced, durable-before-ack Table command
protocol. Multiple application processes owning the same room are not made safe by
an in-process FIFO. The ownership slices and active-load/backlog gates remain open.

## Measured attempts

Same disposable loopback REST fixture, 200 unique life commands, four players per
Table, 5ms configured delay, actual event/recovery/checkpoint writes fully drained:

| Attempt | Tables | Writes | Drain time | Verdict |
| --- | --- | --- | --- | --- |
| Original shared FIFO | 8 | 408 | 12,536ms | Baseline |
| Release response bodies only | 8 | 408 | 12,290ms | No material speed gain; retain as resource-correctness fix |
| Release bodies plus per-Table queue | 8 | 408 | 857ms; repeat 867ms | Keep; independent Tables progress in parallel |
| Original single-Table burst | 1 | 408 | 12,534ms | Baseline |
| New single-Table burst | 1 | 408 | 12,215ms | No material speed gain; FIFO remains intentional |

The eight-Table workload writes about 1.26MB; the single-Table workload writes
1.52MB because its recovery snapshots retain a longer operation-ID window. Exact
payloads can differ slightly with elapsed times. Every run verifies all new event
sequences and each Table's final recovery version/life. The current probe also
rejects any logged write failure, including failed checkpoints. It distributes the
total command count across Tables rather than multiplying the requested count.

These are burst writer-drain measurements. They do not prove sustained throughput,
HTTP/SSE latency, phone responsiveness, hosted Firebase limits or global capacity.
The 1,000 active-client gate still requires sustained traffic and complete drain.
Large snapshots and total database write bandwidth remain separate constraints.

Evidence: `.local/evidence/counter-storage-{before,body-drain,parallel}-*.json`,
`playtest-write-scheduling-green.log`, `write-scheduling-server-tests.log`,
`write-scheduling-client-tests.log` and `write-scheduling-protected-source.log`.
The new tests first failed against the old behavior. They cover independent-room
progress, bounded concurrency, per-room order, failure/retry, frozen snapshots,
archive acknowledgement, flush boundaries and concurrent token refresh/retry.
The source guard compares all protected life/SSE methods and the batching module
with the original baseline; this slice changes none of those methods or any client.
All 340 server and 172 client tests pass. An order-breaking path-key mutation is
rejected by the wire tests and restored before the full suite. Local 8/128-client
HTTP/SSE smoke runs pass with no application busy retries, including unchanged
competition data during life-only traffic. The 128-client run is shorter than the
later sustained gate and kills its child during cleanup, so it does not prove
complete background drain or restart recovery.

Independent adversarial review found a lost-412-retry regression and an accepted
room-less record that bypassed its room lane. Both received failing regression
tests before fixes: preserve known error-status handling and reject incomplete
Table scheduling identity before any I/O. Cross-model
review is skipped in this unattended goal run; no paid/external review tool is used.
