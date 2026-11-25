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

- A merge must not silently strip boundary access the person only reached
  through one of the accounts.
- The merge itself must respect the "an Admin is never a Member" invariant,
  which is why the target is a non-Admin when it commits.
- Conflict resolution should be predictable and not depend on an undefined role
  ordering.
- An Admin needs visibility and an override before committing.
- A merge moves one person's logins onto another account, so it must leave a
  record of who ran it.

## Considered Options

- Most-permissive role wins.
- Target's entire membership set wins, source memberships dropped.
- Explicit admin choice per conflict.
- Target-wins union.

## Decision Outcome

Chosen option: "Target-wins union", because it preserves every boundary the
person could reach while keeping a deterministic default, with an escape hatch
(per-role override in the preview) for the cases an Admin wants to change.

The target (surviving User) must be a non-Admin, because Members are unioned
onto it and an Admin is never a Member. The source may be any Role and its
global Role is discarded. When the source holds an Identity whose stored
claims map to Admin, that Identity moves with the rest, so the target is
promoted at its next login through it, unless the target also holds an
Identity that grants User, in which case ADR 0001 leaves the role unchanged
until its open question on disagreeing Identities is settled. A promoted
target is the case the open question under More Information covers.

An Admin can merge any source, another Admin's account included, and the
source does not have to sign in or confirm. Admins are trusted with each
other's accounts (ADR 0001), and the audit entry is what makes the move
visible. A merge is refused when retiring the source would leave TIR with no
Admin who can sign in, which is the lockout guard in ADR 0001.

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
soft-retired and points at its target; the merge is audit-logged.

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
- Bad, because an Admin can merge another Admin's account into a non-Admin one
  without that person taking part, which moves their logins and discards their
  Admin role. The audit entry is what makes it visible.
- Bad, because it depends on the Admin-is-not-a-Member invariant, which is
  enforced by separate work (API enforcement and SSO claim re-sync).
- Neutral, because per-role override adds preview UI complexity.

### Confirmation

- Merge rejects an Admin target.
- Merging a source that is an Admin commits without that person signing in.
- A merge that would leave no User with the Admin role holding a working
  Identity is rejected.
- After the merge every external Identity the source held resolves to the
  target, and the source holds none. When both had a local Identity the
  source's is gone, its email and password no longer sign in, and the preview
  showed that.
- An unbound placeholder the merge moved to the target is not bound by a
  login on its email alone. That login binds it only after a sign-in with one
  of the target's credentials, also after a later reset.
- When only the source had a local Identity, the target signs in locally with
  its own `primaryEmail` and the source's password.
- The source is left soft-retired and pointing at its target, with its tokens
  and sessions invalidated.
- An audit entry records source, target, and any overrides.
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
