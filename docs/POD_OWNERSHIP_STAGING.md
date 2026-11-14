# Pod ownership — limited public release

The creator is the initial owner and admin. Only the owner can appoint or demote
admins, remove another admin, or permanently delete the Pod. Other admins retain
game/result management, renaming, invitations and removal of ordinary members.
They cannot remove the owner. Ownership is displayed separately from the admin role.

When the owner leaves, ownership passes to the eligible current admin appointed
earliest. Appointment order uses the group's monotonic version, so clock changes
and equal timestamps cannot reorder it. An unchanged reappointment does not restart
tenure; demotion followed by promotion does. Leaving clears that admin tenure.
The owner cannot demote themselves. Without another eligible admin, leaving is
blocked; the owner must appoint one or explicitly delete the Pod. A former owner
returning by invitation is an ordinary member.

Authorization, appointment and succession are checked inside the conditional Pod
update against its latest owner and roles. These checks do not make the separate
identity-directory and Pod documents a single transaction. Identity eligibility is
read from the directory; confirmed erasure removes eligibility on subsequent access.
An opaque erased-identity marker is written with legacy account erasure, without
retaining account identifiers or names. A surviving existing admin may then inherit;
ordinary members never self-promote through the old vacancy-takeover route.

New Pods persist owner and appointment-order metadata. Old Pods with exactly one
member record have a structurally identifiable creator; the first join records that
owner before adding members. An older multi-member Pod without an owner marker
needs an explicit ownership review. Join dates and incomplete historical inference
must not silently grant ownership or deletion rights. Missing/inconsistent owner
records or unproven missing identities also fail closed. Existing games remain
available while sensitive owner actions are blocked. No bulk migration or hosted
repair of existing Pod data is part of this change.

The constructor's `podOwnershipEnabled` defaults off. The enabled legacy server
selects this policy for `production` and `staging`; its separate privacy eraser
keeps the same policy when competition routes are disabled. Native/scoped storage
remains off for this policy. No existing Pod is bulk-migrated or assigned an owner
by inference. The reported email sign-in issue was resolved by the user's private
password reset without an authentication code change. The unrelated sign-in
Interface style control remains deferred at the user's request.
