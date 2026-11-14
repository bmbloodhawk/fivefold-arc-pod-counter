# Pods and Tournaments: limited single-server release

This release adds the tested My Pods and Tournaments flows to the public app.
Pod creators own their Pod, appoint admins and can delete a Pod after typing its
name. If an owner leaves, the eligible admin appointed first inherits ownership.
An owner without a successor must appoint one or explicitly delete the Pod.

Pod invitations support an in-app QR scanner, QR photos and pasted links. A scan
opens the invite preview; sign-in and explicit acceptance still control joining.
Ordinary Table codes and QR codes continue to join games. Playing at a Pod-linked
Table does not grant Pod membership or private group access.

## Runtime and data

Keep `APP_ENV=production` and explicitly set `COMPETITIONS_ENABLED=true` on the
existing public service. Public uses its existing database and authentication;
staging's database and test Pods remain separate. No credentials, database rules
or shared identity-provider settings need to change for this release. Preserve
the public service's existing stream limits (32/IP and 64 globally).

Use the legacy competition adapter. Do not activate the unfinished native/scoped
storage modules. Existing multi-member Pods with no trustworthy owner marker
retain gameplay access, but sensitive ownership actions require review. Never
guess a creator from a join timestamp or migrate staging Pods into public.

## Verification and limits

The public artifact combines the verified staging build with public's newer
Commander card index. Production activation has dedicated behavior tests for
ownership, administrator denial, succession, deletion, and privacy erasure with
competition routes disabled. Normal tests and independent review precede release;
actual served asset hashes, health, capability flags and browser UI follow it.

This is a limited pilot, not a claim of large-event capacity. Earlier hosted life
HTTP responses missed the 250 ms target. Physical phone camera capture, background
recovery and installed service-worker activation need device-specific evidence.
Keep pasted invitations available. Preserve prior failed-run evidence and the
unfinished scaling source; this release does not complete the broader scaling goal.

## Deployment and rollback

Deploy between games because server replacement can disconnect live streams.
Check the exact deployed revision and assets rather than treating a push or a
healthy old build as release proof. Existing installed apps may require closing
and reopening outside gameplay to activate their waiting update.

For a functional rollback, set `COMPETITIONS_ENABLED=false` and deploy the current
compatible recovery build. Competition routes and UI become unavailable while
the independent competition eraser remains configured. Preserve all competition
records. Do not downgrade recovery or erase data as a rollback. Permanent Pod
deletion is not reversed by reverting code.
