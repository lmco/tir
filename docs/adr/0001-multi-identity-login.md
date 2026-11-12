---
status: accepted
date: 2026-06-11
decision-makers: Mark Rivera, Amndeep Singh Mann
---

# Users authenticate through Identities, not a single email key

## Context and Problem Statement

Every provider resolves the login to a User by email:
`User.findOne({ where: { email } })` in local, LDAP, and OIDC. Email is the
implicit link between a person and their account. That has two consequences. If
two providers happen to carry the same email, they collapse onto the same User
by coincidence of the address, not by any deliberate link. If they carry
different emails, each provider lands on (or creates) a separate User, and there
is no way to tell TIR those accounts are the same person. So a person cannot
deliberately link identities that do not share an email, and the separate
accounts that result cannot be merged. MITRE raised multi-identity logins and
account-merge as a nice-to-have (see #171, #170, and the PR #183 review), and
the design was worked through in discussion #197. How should a User relate to
the credentials they log in with?

## Decision Drivers

- Linking a person's logins should be explicit, not an accident of matching
  email addresses.
- A person should be reachable by any of their credentials (local, LDAP, OIDC,
  OAuth) even when the emails differ.
- Account-merge is only coherent if a User can hold more than one Identity.
- The email-as-login-key assumption is baked into every provider; new user,
  auth, and member features pay to work around it.
- Credential storage should be consolidated, not spread across User columns.

## Considered Options

- Keep email as the login key: no Identity table, one account per
  email per provider.
- Multi-valued Identity model: move credentials and external keys onto a
  one-to-many Identity table.

## Decision Outcome

Chosen option: "Multi-valued Identity model", because the single-identity
assumption is a structural constraint that the user, auth, and member areas keep
paying for, and fixing the foundation once is cheaper than continuing to build
around it.

A User may hold several login Identities. Credentials and external keys (email /
OIDC subject / LDAP DN, and the local password credential) move off the User row
onto a one-to-many Identity table. Login resolves
`provider + external key -> Identity -> User`, replacing today's
`User.findOne({ where: { email } })`. The User keeps a single `primaryEmail` for
display and notifications.

Phase 1 lands as one change: a single migration introduces Identity and moves
the external keys and credentials onto it, and all four providers switch to it
together, rather than slicing provider by provider, so the schema changes once.

Linking is explicit and user-initiated. An SSO identity TIR does not recognise
is never attached to a User because its email matches one. The user is told the
login is not recognised and asked to sign in with an existing TIR credential;
once they do, the new Identity is attached to that User. With no existing
account and self-registration off, the login is rejected. Where a provider has
group mappings, the first login may instead offer the choice between creating
a new account and attaching an existing one. Proving ownership by a
confirmation email is an acceptable alternative proof.

Provider claims are authoritative and re-synced on every login, not only when
the account is created: the Identity's metadata (name) and the mapped global
role are re-applied each time, and the group memberships the provider reports
are stored on the Identity so that claim-driven node membership can build on
them later.

### Consequences

- Good, because account-merge (ADR 0002) becomes possible and one person can log
  in through any provider and land on the same User even when the emails differ.
- Good, because credential storage is consolidated onto Identity as a single
  PHC-style encoded field (algorithm, iterations, salt, hash) instead of
  separate `password` and `salt` columns.
- Bad, because all four providers must be rewired to resolve via Identity; this
  is a prerequisite phase (Phase 1) before user-merge.
- Bad, because a role granted inside TIR to an SSO user is undone at their next
  login if the provider's claims do not grant it; the provider is the place to
  change it.
- Neutral, because the password scheme is unchanged when the credential moves
  onto Identity: still PBKDF2-HMAC-SHA256 (600k iterations) with a per-user salt
  and a `SECRET_KEY` pepper; only its storage location and encoding change.
  PBKDF2 stays the default because TIR must remain FIPS-capable. The PHC field
  names its algorithm, so a scheme such as Argon2id can be offered later as a
  selectable option for deployments that do not require FIPS, hard-gated to
  PBKDF2 when a FIPS flag is set.

### Confirmation

All four `server/auth/*AuthProvider.ts` resolve login through Identity with no
remaining `User.findOne({ where: { email } })` login path; local password
verifies against the PHC field stored on the Identity. An unknown SSO identity
is attached to a User only after an existing credential of that User is
presented. A login whose claims map a different global role changes the User's
role.

## Pros and Cons of the Options

### Keep email as the login key

- Good, because no migration or auth rewrite is needed now.
- Bad, because it is a structural constraint the user, auth, and member areas
  keep paying for as they grow.
- Bad, because account-merge stays impossible.

### Multi-valued Identity model

- Good, because it establishes the foundation the rest of the auth, user, members and role enhancements will build on.
- Good, because login keys per provider stop colliding on email.
- Bad, because it is the bulk of the effort (rewiring all four providers plus a
  data migration).

## More Information

Phase 1 of a two-phase effort; Phase 2 is the merge (ADR 0002). Decided in
discussion #197. Related: #171 (multiple SSO methods at once), #170 (local
registration), PR #183. Until this lands, lmco/tir ADR 0003 holds an interim
rule of one sign-in method per account.

Still open from #197:

- When a User's identities map to different global roles, whether the least
  privileged of them applies.
- What happens to a member's boundary memberships when a re-sync promotes them
  to Admin: strip the membership rows, or keep them and block boundary data
  access while the account is an Admin.
