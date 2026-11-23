---
status: proposed
date: 2026-11-23
decision-makers: Mark Rivera, Amndeep Singh Mann
---

# User-merge folds a source User into a non-Admin target, target-wins on conflicts

## Context and Problem Statement

Once a User can hold multiple Identities (ADR 0001), an Admin can merge two Users
that are the same person. Merging raises conflicts across global Role, Member
roles on shared nodes, preferences, tokens and sessions, and assignments. How
should those conflicts resolve?

Merge is distinct from link. A link attaches a new, empty Identity to one
existing User; it carries no memberships or data, only "this subject is also
this person", and ADR 0001 covers it. A merge collapses two already populated
Users, each with roles, memberships and preferences that can conflict, and
that is what this ADR decides. Metadata that differs between a person's
providers stays on the respective Identity rows and is not merged.

## Decision Drivers

- A merge must not silently strip access the person only reached through one of
  the accounts.
- The result must respect the "an Admin is never a Member" invariant.
- Conflict resolution should be predictable and not depend on an undefined role
  ordering.
- An Admin needs visibility and an override before committing.
- A merge must not hand an Admin's logins to someone else without that Admin's
  own consent.

## Considered Options

- Most-permissive role wins.
- Target's entire membership set wins, source memberships dropped.
- Explicit admin choice per conflict.
- Target-wins union.

## Decision Outcome

Chosen option: "Target-wins union", because it preserves every boundary the
person could reach while keeping a deterministic default, with an escape hatch
(per-role override in the preview) for the cases an Admin wants to change.

The target (surviving User) must be a non-Admin and must hold no Admin-mapped
Identity as ADR 0001 defines it, the same test ADR 0001 applies in the user
editor, so a merge never adds logins to an account that is already an Admin or
already holds an Admin-mapped Identity. The source may be any Role and its
global Role is discarded. When the source holds an Identity whose stored claims
map to Admin, that Identity moves with the rest, so the target is promoted at
its next login through it, unless the target also holds an Identity that grants
User, in which case ADR 0001 leaves the role unchanged until its open question
on disagreeing Identities is settled. A promoted target is the case the open
question under More Information covers.

When the source is an Admin, or holds an Admin-mapped Identity, the merge needs
that person's own proof. It stays pending and changes nothing until they sign
in with one of the source's credentials and confirm it, and the confirmation
shows the target and the Identities the target already holds. On confirmation
the target test runs again and the preview is recomputed. If the target no
longer passes, or the preview differs from the one the merging Admin approved,
nothing is committed and the merge goes back to that Admin. An Admin can cancel
a pending merge and the source can decline it. A pending merge lapses if it is
not confirmed within a period the feature issue sets, and a lapsed merge has to
be requested again. A User can be the source or the target of only one pending
merge at a time. Resetting a placeholder Identity of either User (ADR 0003)
also cancels it.

An Admin merging their own account gives the proof by being signed in to it.
This keeps the ADR 0001 rule that an Admin's identities never move without that
Admin proving ownership, and a sign-in is the only proof ADR 0001 accepts. The
Admin-mapped test covers a source demoted just before the merge, whose claims
would promote the target at its next login. The proof is as strong as a sign-in
and no stronger. ADR 0001 leaves an Admin able to set another Admin's local
password, so an Admin who does that to a source with a local Identity can sign
in as it and confirm.

The source's Identities move to the target, so every login that reached the
source now reaches the target. The one exception follows from ADR 0001 allowing
a User a single local Identity. When both hold one the target's is kept and the
source's is dropped, and the preview says so. When only the source holds one it
moves and takes the target's `primaryEmail` as its key, so the person signs in
with the target's address and the source's password, and the preview says that
too. An unbound placeholder that moves with them (ADR 0003) no longer binds on
an email match, since the merge has widened what that login would reach. A
login that would have bound it is asked to sign in with one of the target's
credentials, and that sign-in binds it. The same holds if such a placeholder is
reset later. For this the retired source's address counts as the target's, so
ADR 0001 does not treat the login as matching another User. Members are
unioned, with the target's role winning on shared-node conflicts. The merge
preview lists conflicts and allows per-role override. Eval and milestone
assignments and notifications are reassigned and de-duped; source tokens are
revoked and sessions invalidated; the target wins on preferences; the source is
soft-retired with a `mergedIntoId`; the merge is audit-logged at `notice`.

The retired source keeps its `primaryEmail`. A first login whose email matches
it is asked to sign in with one of the target's credentials, as ADR 0001 does
for a match on a live User. No other User may take that address. The target
may, and it then moves off the retired row, so `primaryEmail` stays unique as
ADR 0001 requires. So the person's old address keeps leading to their one
surviving account, by proof and never by the match alone, and does not start a
second account.

### Consequences

- Good, because no boundary access is silently lost; conflicts surface in the
  preview.
- Good, because the outcome is deterministic without needing a defined role
  ordering.
- Good, because moving an Admin's logins by merge takes a sign-in to the source
  and a confirmation that shows the target's Identities, so merge opens no way
  into an Admin account that signing in did not already give.
- Bad, because the proof inherits the local password exception in ADR 0001. An
  Admin who sets the password of a source with a local Identity can confirm the
  merge as that source.
- Bad, because an Admin source with only external logins who can no longer sign
  in cannot be merged, and ADR 0001 stops another Admin from clearing the way
  by removing its Admin-mapped Identities.
- Bad, because it depends on the Admin-is-not-a-Member invariant, which is
  enforced by separate work (API enforcement and SSO claim re-sync).
- Neutral, because per-role override adds preview UI complexity.

### Confirmation

- Merge rejects an Admin target, and a target holding an Admin-mapped
  Identity.
- Merging a source that is an Admin, or that holds an Admin-mapped Identity,
  changes nothing until that person signs in with one of the source's
  credentials and confirms.
- A pending merge does not commit on confirmation when the target no longer
  passes the target test or the preview has changed since the merging Admin
  approved it.
- Resetting a placeholder Identity of the source or the target (ADR 0003)
  cancels a pending merge between them.
- A pending merge past its period cannot be confirmed, and a merge naming a
  User who is already in a pending merge is rejected.
- After the merge every Identity the source held resolves to the target, and
  the source holds none. When both had a local Identity the source's is gone,
  its email and password no longer sign in, and the preview showed that.
- An unbound placeholder the merge moved to the target is not bound by a
  login on its email alone. That login binds it only after a sign-in with one
  of the target's credentials, also after a later reset.
- When only the source had a local Identity, the target signs in locally with
  its own `primaryEmail` and the source's password.
- The source is left soft-retired with `mergedIntoId` set and its tokens and
  sessions invalidated.
- An audit entry at `notice` records source, target, and any overrides.
- A first login whose email matches a retired source's `primaryEmail` creates
  no account and is asked to prove ownership of the target. No User other than
  the target can take that address, and when the target does the retired row
  no longer holds it.
- The unioned Members match the preview, including overrides.

## Pros and Cons of the Options

### Most-permissive role wins

- Bad, because there is no defined ordering once TIR has custom Member roles, so
  "most permissive" stops being meaningful.

### Target's entire membership set wins, source memberships dropped

- Good, because it is trivial to implement.
- Bad, because it silently strips boundaries the person only reached through the
  source, which defeats the purpose of merging.

### Explicit admin choice per conflict

- Good, because it is maximally precise.
- Bad, because it is impractical at scale; kept only as the per-role override in
  the preview.

### Target-wins union

- Good, because it is a deterministic default plus a per-role override.
- Bad, because it requires building the preview and override UI.

## More Information

Requires the multi-identity model (ADR 0001). Depends on the Admin-is-not-a-Member
invariant holding, enforced by separate work. Acceptance criteria for the
user-merge feature issue derive from this ADR. Discussed in mitre/tir discussion 197.

Still open from mitre/tir discussion 197 and relevant here: what a re-sync does with a member's
boundary memberships when it promotes them to Admin (strip the rows, or keep
them and block boundary data access). The answer decides whether a merge can
ever leave membership rows on an Admin.
