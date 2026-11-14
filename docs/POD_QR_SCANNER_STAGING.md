# Pod invite QR scanner — limited public release

Open **My Pods → Use an invite → Scan Pod QR**. Camera access starts
only after that button is pressed. **Choose QR photo** offers a photo fallback.
The original paste-link/code form stays visible and keeps its current value.

A valid scan uses the existing invite preview. Joining still requires explicit
sign-in, a display name and **Join Pod** confirmation. Scanning does not create
membership or change a game Table. Expired/revoked invites use the existing errors.

Scans accept bounded Pod invite tokens or this site's HTTP(S) root/index invite
URLs. Table codes, tournament/guest links, foreign origins, userinfo, non-app paths,
query-bearing links, duplicate/mixed parameters and malformed tokens are rejected.
The scanned URL is never followed. Only the extracted invite token is sent to this
server's existing preview endpoint; camera frames/photos are decoded on-device.

Close, Back, Escape, another view, account changes, page departure and backgrounding
stop live camera tracks. Late permission/playback/photo results cannot reopen a
closed view. The native photo picker remains usable after temporarily hiding the
page. No camera image or invite capability is added to logs or new storage.

`podInviteScannerEnabled` is advertised when competitions are enabled in the
supported production or staging environment. The existing Table QR scanner retains its
default parser and messages; the shared scanner additionally protects pending
camera startup and overlapping sessions. Existing ownership/authentication rules,
life updates, native storage and deferred Interface style work are unchanged.

Automated and phone-sized browser checks do not prove a physical phone camera.
Verify rear-camera capture and photo selection on iPhone Safari and Android Chrome
before claiming physical-device support. Retain paste-link entry if camera access
is unavailable or blocked. Staging invites and Pod data stay on staging; a public
Pod invite is created on the public site and is not a staging-data migration.
