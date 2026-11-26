---
status: accepted
date: 2026-11-23
decision-makers: Mark Rivera, Amndeep Singh Mann
---

# Users authenticate through Identities, not a single email key

## Context and Problem Statement

This ADR takes as its starting point main after lmco/tir#14, which adds the
OAuth provider and the per-account sign-in method.

Every provider resolves the login to a User by email:
`User.findOne({ where: { email } })` in local, LDAP, OIDC, and OAuth. Email is
the implicit link between a person and their account. That has two
consequences. If two providers happen to carry the same email, they collapse
onto the same User by coincidence of the address, not by any deliberate link.
If they carry
different emails, each provider lands on (or creates) a separate User, and there
is no way to tell TIR those accounts are the same person. So a person cannot
deliberately link identities that do not share an email, and the separate
accounts that result cannot be merged. MITRE raised multi-identity logins and
account-merge as a nice-to-have (see mitre/tir#171, mitre/tir#170, and the mitre/tir#183 review), and
the design was worked through in mitre/tir discussion 197. How should a User relate to
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

- Keep email as the login key: no Identity table, one account per email.
- Multi-valued Identity model: move credentials and external keys onto a
  one-to-many Identity table.

## Decision Outcome

Chosen option: "Multi-valued Identity model", because the single-identity
assumption is a structural constraint that the user, auth, and member areas keep
paying for, and fixing the foundation once is cheaper than continuing to build
around it.

A User may hold several login Identities, of which at most one is a local
Identity, so there is one password per User as today. Credentials and external
keys move off the User row onto a one-to-many Identity table. The external key
is the email for the local credential, the subject for OIDC, the DN for LDAP,
and the provider's own account id for OAuth. The local key is always the User's
`primaryEmail` and follows it when it changes, as the login email does today.
Login resolves `provider + external key -> Identity -> User`, replacing today's
`User.findOne({ where: { email } })`.

Each provider has a unique identifier, assigned when it is created and never
reused or changed. An Identity records that identifier and not the provider's
address or its config id. Editing a provider keeps its identifier, so a change
of address, of TLS or of client registration leaves every Identity working.
Deleting a provider retires its identifier, and a provider added afterwards
starts with no Identities even when it reuses the old config id, which the
admin screen does after a delete. Two providers never share keys.

Because the identifier survives an edit, an Admin who repoints a provider at a
different identity provider keeps its Identities, those of Admins included.
Whoever configures a provider already decides whom it vouches for. The change
needs the provider's secret entered again, as lmco/tir#14 requires, and writes
an audit entry. A provider that is meant to be a different one is deleted and
added anew.

Deleting a provider ends the login of everyone who signs in through it, and
the delete warns of that. A User left without a working login, an Admin
included, is helped by an Admin attaching a new one. The delete is refused
only when it would leave TIR with no Admin who can sign in, which is the
lockout guard below. The Identities of a deleted provider stay on their
accounts and no longer resolve.

The User keeps a single `primaryEmail` for display and notifications, which is
today's `email` column under the name this ADR uses for it. It stays unique
across Users, as email is today. An address held by another User's placeholder
Identity (ADR 0003) is reserved in the same way for as long as that Identity
exists, bound or not, and cannot be taken as a `primaryEmail`.

Phase 1 lands as one change: a single migration introduces Identity and moves
the credentials onto it, and all four providers switch to it together, rather
than slicing provider by provider, so the schema changes once. The external
keys are not stored today, so the migration cannot fill them in. How existing
logins cross the cutover is ADR 0003.

Linking is explicit. Apart from the placeholder bind in ADR 0003, an identity
TIR does not recognise is never attached to a User because its email matches
one. A person attaches it by proving ownership of the User, which means signing
in with one of its existing credentials. A confirmation email to the User's
`primaryEmail` is not a proof. A user can set their `primaryEmail` to any
unused address without verifying it, so the owner of a mailbox who answered
such an email could be joining an account someone else opened under their
address. A person who cannot sign in asks an Admin to attach the Identity.

Each external provider has a "create accounts on first login" switch, on by
default for existing and new providers, which is today's behaviour.
"Self-registration" means only the local sign-up form (mitre/tir#170) and has
no bearing on external providers. A login that ADR 0003 binds to a placeholder
is not an unrecognised identity. Where the same email also matches another
User's `primaryEmail`, no placeholder binds and the first case below applies. A
retired merge source's address counts as its target's (ADR 0002), so a
placeholder the merge moved to that target is not such a collision. That login
is asked to sign in to the target, and the sign-in binds the placeholder. What
happens when an unrecognised identity signs in:

- Its email matches the `primaryEmail` of an existing User, whatever the switch
  is set to: the person is asked to connect the login by signing in with one of
  that User's existing credentials. If they cannot, the login is rejected. The
  match only triggers the question and never links.
- No match, switch on: the account is created without a prompt, as today. The
  provider's group mappings still decide who is admitted and which role they
  get, so an unmapped user on a mapped provider is rejected.
- No match, switch off: the login is rejected, and an Admin has to create the
  account. The switch wins over group mappings, so a user in a mapped group is
  rejected too.

On a provider with group mappings the mapping gate applies to every login,
before any Identity lookup. An identity in no mapped group cannot sign in,
connect, or prove ownership through that provider, and an Identity an Admin
attached is held to the same gate when it first signs in.

A signed-in user can connect a further login, including one with a different
email, from their profile page, and can remove one of their own Identities
there, except the last working one and one that began as a placeholder (ADR
0003).

An Admin can also attach an Identity to any User, or remove one, from the user
editor. This covers a person who cannot prove ownership themselves, such as a
forgotten local password or an account whose only credential lives at another
provider. The User may be an Admin. Admins are trusted with each other's
accounts, as they already are through password reset and provider
configuration. Every attach and removal writes an audit entry that names who
made it and on which account, and that entry is what makes a takeover visible.
A User's last working Identity cannot be removed. A working Identity is a
local one or one at a provider that still exists. Whether its owner can sign
in through it today is the provider's to decide, by its group mappings for
example, and is not part of this test. The one exception is a merge source,
which ADR 0002 retires with no Identities. Re-sync still applies to an
attached Identity, under the role rules below. If its provider claims map to
Admin, the User is promoted at the next login, exactly as that identity would
receive Admin on a new account, because the provider is the authority for
claim-mapped roles. The promotion waits when another of the User's Identities
grants a different role, as it does for any User whose Identities disagree.

An Admin attaches an external Identity by choosing a provider and entering the
person's email there, which creates a placeholder that binds at the person's
first login through that provider (ADR 0003). The attach is rejected when that
email is another User's `primaryEmail` or is held by another User's
placeholder Identity, bound or not. Where the provider's verified-email
setting is on, a placeholder binds only on an address the provider reports as
verified (ADR 0003). A local Identity is attached by setting a password. An
account an Admin creates is given at least one Identity in one of these two
ways.

One guard applies to every action taken inside TIR under this ADR, ADR 0002
and ADR 0003. An action is refused when it would leave TIR with no Admin who
can sign in, meaning no User with the Admin role who holds a working Identity.
Deleting the provider that holds every working Identity of the last such Admin
is refused, and so is a merge that would retire that Admin (ADR 0002).
Lowering that Admin's role and deleting that Admin's account are refused in
the same way. Removing that Admin's last working Identity is already refused
by the rule above. This is a lockout guard and not a trust rule. It does not
limit which Admin may change whose logins. The guard covers actions taken
inside TIR. It does not cover the role a provider's claims grant at login,
since the provider is the authority on that role. When a provider's group
mappings lower the last Admin at their next login, TIR has no Admin until
someone the provider maps to Admin signs in, and the fix is made at the
provider.

Provider claims are authoritative for the Identity they come from and are
re-synced on every login, not only when the account is created. Each login
stores on that Identity the name the provider reports and its group
memberships, so that claim-driven node membership can build on them later.
Stored claims are the ones an Identity's last login reported. The name stays
on the Identity and does not overwrite the User's own name fields.

The global role follows the claims within three limits. A provider with no
group mappings never changes it: a new account gets the User role and an
existing one keeps the role it has. A login that matches mapped groups for both
roles is granted User, the lower of the two, as the providers decide today, and
that single granted role is what "maps to Admin" means throughout this ADR.
When a User holds Identities whose stored claims grant different roles, a login
does not change the global role until the open question below is settled. An
Identity with no mapped claims, such as a local Identity or one from a provider
with no group mappings, grants no role and does not count in that comparison.
Otherwise the granted role is applied at each login. The comparison is made
after the current login's claims are stored, so a login that makes a User's
Identities disagree changes no role.

### Consequences

- Good, because account-merge (ADR 0002) becomes possible and one person can log
  in through any provider and land on the same User even when the emails differ.
- Good, because credential storage is consolidated onto Identity as a single
  PHC-style encoded field instead of separate `password` and `salt` columns.
- Good, because a provider can change its address or TLS without touching
  anyone's login, and a provider added after a delete cannot inherit the old
  one's logins.
- Bad, because an Admin who can edit providers can repoint one at a server they
  control and sign in as anyone who uses it, Admins included. That is true of
  provider configuration today, and the secret prompt and the audit entry are
  what make it visible.
- Bad, because a provider cannot be deleted while it holds every working
  Identity of the last Admin who can sign in, so retiring it waits until that
  Admin or another holds a working Identity elsewhere.
- Bad, because all four providers must be rewired to resolve via Identity; this
  is a prerequisite phase (Phase 1) before user-merge.
- Bad, because a role granted inside TIR to a user of a provider with group
  mappings is undone at their next login through it when the claims grant a
  different one; the provider is the place to change it.
- Bad, because `primaryEmail` is not verified, so a User can hold an address
  that belongs to someone else. That person's first login is then rejected
  until an Admin corrects the address. Nothing is linked, which is the point of
  refusing email as a proof.
- Bad, because an Admin who can attach an Identity can attach one of their own
  to any User, another Admin included, and sign in as that User. An Admin can
  already do that today by setting the account's local password, so this is
  not a new level of trust, and the audit entry is what makes it visible.
- Good, because an Admin who loses every credential is helped by another Admin
  attaching a new Identity, as any User is.
- Bad, because removing a person from a provider's mapped groups closes only
  that provider. A User who also holds another Identity, such as a local
  password, can still sign in through it, so offboarding has to cover every
  Identity or the User itself.
- Bad, because the same-email prompt tells whoever holds a matching identity at
  a configured provider that an account with that email exists.
- Bad, because with the switch off every new person needs an Admin to create
  their account before their first login.
- Neutral, because the password scheme is unchanged when the credential moves
  onto Identity: still PBKDF2-HMAC-SHA256 (600k iterations) with a per-user salt
  and a `SECRET_KEY` pepper; only its storage location and encoding change.
  PBKDF2 stays the default because TIR must remain FIPS-capable. The PHC field
  names its algorithm, so a scheme such as Argon2id can be offered later as a
  selectable option for deployments that do not require FIPS, hard-gated to
  PBKDF2 when a FIPS flag is set.

### Confirmation

- All four `server/auth/*AuthProvider.ts` resolve login through Identity with
  no remaining `User.findOne({ where: { email } })` login path. The local
  password verifies against the PHC field stored on the Identity.
- An account an Admin creates holds at least one Identity.
- Editing a provider's address keeps its identifier, logins through it resolve
  to the same Identities, and the edit writes an audit entry. A provider added
  after a delete has a new identifier and resolves to none of the old
  Identities, also when it reuses the config id.
- Deleting a provider warns that its Users lose that login. It is refused only
  when it would leave no User with the Admin role holding a working Identity.
  An Identity at a provider that was deleted earlier does not count as
  working.
- An unknown identity is attached to a User only after the person signs in
  with one of that User's existing credentials, or when an Admin attaches it,
  and never because the email addresses match, apart from the placeholder
  bind in ADR 0003. No confirmation email links a login.
- A first-time login by an unrecognised identity whose email matches an
  existing User creates no account and attaches nothing until that sign-in
  happens.
- Changing a User's `primaryEmail` changes the email their local Identity
  signs in with, and the old address no longer signs in.
- Changing a `primaryEmail` to an address held by another User's placeholder
  Identity, bound or not, is rejected, and so is attaching a placeholder whose
  email is another User's `primaryEmail` or is held by another User's
  placeholder Identity. Where a provider's verified-email setting is on, a
  placeholder binds only on an address that provider reports as verified.
- A login whose email matches both an unbound placeholder and another live
  User's `primaryEmail` binds nothing and is asked to sign in to that other
  User. A placeholder a merge moved is not that case: its login is asked to
  sign in to the target, which binds it.
- An Admin attaching an Identity to any User, or removing one, is accepted for
  an Admin's account as for any other and writes an audit entry naming who
  made the change and on which account.
- An action that would leave no User with the Admin role holding a working
  Identity is refused: deleting a provider, removing an Identity, a merge (ADR
  0002), lowering that Admin's role, or deleting that Admin's account.
- Removing a User's last working Identity is rejected, and an Identity at a
  deleted provider does not count as working. A signed-in user, Admin or not,
  can remove one of their own Identities from the profile page but not the
  last working one. Giving a User a second local Identity is rejected by
  every route.
- With a provider's create switch off, a first-time login with no matching
  User creates no account.
- On a provider with group mappings, a login in no mapped group is rejected
  before any Identity lookup, including one that would connect to an existing
  User or that already belongs to one.
- A login through a provider with no group mappings changes no role. A login
  matching mapped groups for both roles is granted User.
- A login whose claims grant a different global role changes the User's role
  only when every role-granting Identity of that User agrees once the login's
  claims are stored. Otherwise it changes none, pending the open question
  below.
- A login stores the reported name on its Identity and leaves the User's name
  fields as they were.

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
mitre/tir discussion 197. Related: mitre/tir#171 (multiple SSO methods at once), mitre/tir#170 (local
registration), mitre/tir#183. Until this lands, ADR 0004 holds an interim rule
of one sign-in method per account and ships with lmco/tir#14. ADR 0003 covers
how existing logins cross the Phase 1 cutover. It is proposed in lmco/tir#52,
and this ADR relies on it for the placeholder an Admin attach creates.

A possible later addition, behind its own option: with the create switch off,
hold an unknown person's account pending Admin approval instead of rejecting
the login.

Still open from mitre/tir discussion 197:

- When a User's identities map to different global roles, whether the least
  privileged of them applies.
- What happens to a member's boundary memberships when a re-sync promotes them
  to Admin: strip the membership rows, or keep them and block boundary data
  access while the account is an Admin.
