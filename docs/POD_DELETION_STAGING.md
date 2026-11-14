# Delete Pod — limited public release

- Available when the server environment is `production` or `staging`, competitions
  are enabled, and the existing legacy competition store is active. Unfinished
  scoped/native storage does not expose or accept this operation.
- With the ownership policy active, only the active Pod owner can delete it.
  The owner types the current Pod name. The server checks that permission,
  name and absence of accepted/incomplete game captures inside one conditional Pod
  update. Running games must finish (or be explicitly reset) before deletion.
- Deletion removes the Pod's shared history, ratings, memberships and invitations for
  everyone. Separate personal game history, accounts, other Pods and tournaments stay.
  Already completed Tables remain usable; their Pod binding is removed.
- `DELETE /api/competitions/pod/:id` takes `{ "confirmationName": "Current Pod name" }`
  and returns `200 { "deleted": true }` after both deletion and directory cleanup.
  Existing auth/error conventions apply: 401 unsigned, 403 non-owner, 400 wrong name,
  409 incomplete game or unresolved legacy ownership, 404 unsupported environment or unknown resource.
- A minimal deleted-Pod marker prevents stale writes and invitations restoring it.
  It contains no name, membership, rating or game history. Directory retirement and
  alias/index/Table-binding cleanup are atomic together. Late alias/claim writes reject.
- A repeated authenticated DELETE of an existing marker finishes cleanup and returns
  the same generic result. No former member/admin identity is retained in the marker.
  A subsequent read/list completes interrupted cleanup before treating the Pod as gone.
  Transient cleanup failures remain errors, and recovery retries them; only confirmed
  deleted scopes leave the pending recovery set.
- Interrupted cleanup is completed on a relevant read/list, a recovery attempt for a
  linked Table, or DELETE retry. An unused Pod with no further visits has no continuous
  cleanup worker. Alias keys retain the existing fixed-length random Pod-ID namespace.
- There is no user restore action. Code rollback does not restore deleted shared data.
  Hosted verification uses newly created, clearly disposable staging Pods only.
- This trial does not change life adjustments, durable save receipts or stream limits,
  activate native storage, or clear the existing launch/performance gates.
