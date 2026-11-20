---
status: accepted
date: 2026-11-20
decision-makers: Mark Rivera, Amndeep Singh Mann
---

# Users authenticate through Identities, not a single email key

## Context and Problem Statement

This ADR takes as its starting point main after lmco/tir#14, which adds the
OAuth provider and the per-account sign-in method.

Every provider resolves the login to a User by email:
`User.findOne({ where: { email } })` in local, LDAP, OIDC, and OAuth. Email is
the implicit link between a person and their account. That has two
consequences. If
two providers happen to carry the same email, they collapse onto the same User
by coincidence of the address, not by any deliberate link. If they carry
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
and the provider's own account id for OAuth. The local key is always the
User's `primaryEmail` and follows it when it changes, as the login email does
today. Login resolves
`provider + external key -> Identity -> User`, replacing today's
`User.findOne({ where: { email } })`. The provider is identified by what it
points at, not by its config id, because the admin screen reuses an id after a
delete and an entry can be saved over with a different server. Its identity is
the issuer URL and client id for OIDC, the server URL and base DN for LDAP, and
the provider type and base URL for OAuth. Two providers never share keys, and a
config entry repointed at a different server is a different provider whose
logins do not resolve to the old Identities. The User keeps a single
`primaryEmail` for display and notifications, which is today's `email` column
under the name this ADR uses for it. It stays unique across Users, as email is
today.

Phase 1 lands as one change: a single migration introduces Identity and moves
the credentials onto it, and all four providers switch to it together, rather
than slicing provider by provider, so the schema changes once.

The external keys are not stored today. OIDC checks the subject and discards
it, LDAP binds with the DN, OAuth keeps no account id, and each then finds the
User by email. So the migration cannot fill the keys in, and without a bridge
every existing external user would arrive after the cutover as an unrecognised
identity. The migration therefore creates a local Identity for each User with a
stored password and, for each User whose sign-in method is an external one, a
placeholder Identity for that method holding the User's email at migration and
no key. The sign-in method is the account's single method under lmco/tir ADR
0003, which keeps it in the `creationMethod` column, changes it only through
the method switch, and refuses a login through any other method. Without that
rule the column would only say how the account was created. ADR 0003 also
keeps a stored password working as a local fallback after a switch away from
Local, until the first login through the new method clears it, so a local
Identity for every stored password carries over what works at the cutover.

Nothing records which provider an account uses, so a placeholder is pinned to
the providers of its method that are enabled when the migration runs, a single
one in most deployments. The pin is a snapshot of each such provider's identity
as defined above, stored on the placeholder row, so a provider that is added,
enabled or repointed later can never bind it. The first successful login
through a pinned provider whose email equals the placeholder's records the
presented key and that provider on it, and while a key is stored no other login
binds it. A placeholder is not affected by later changes to `primaryEmail` and
is never bound by a login whose email differs. This is the one place a login is
tied to a User by email. The bind fills in an Identity the User already holds,
so the rules below on changing an Admin's Identities do not apply to it. When
no provider of an account's method is enabled at migration, no placeholder is
created and the migration logs the account, so the operator can see who will
need help signing in.

Today's lookup checks the email again on every login. The bind keeps the first
key it sees, so a wrong first assertion does not correct itself. An Admin can
reset a bound placeholder from the user editor, with an audit entry. The reset
clears the key, the bound provider and the claims the binding login stored,
marks the Identity Admin-mapped if the migration had marked it or if the
claims being cleared mapped to Admin, ends the sessions opened through that
Identity, and cancels a pending merge the User is part of
(ADR 0002). The next matching login through a pinned provider then binds it
again. The reset does not restore a global role the wrong bind changed. On a
provider with group mappings the right login re-syncs it, and otherwise an
Admin sets it. Only an Identity that began as a placeholder can be reset. A
local Identity cannot, nor can an external one its owner connected while signed
in, and a reset leaves the User's local password as it is.
The reset is allowed on an Admin's Identity too, because it is the only
recovery for an Admin whose single external login was bound to the wrong key.
It hands the resetting Admin nothing, since the bind still goes to whoever a
pinned provider reports under that address.

Linking is explicit. Apart from that one-time bind, an identity TIR does not
recognise is never attached to a User because its email matches one. A person
attaches it by proving ownership of the User, which means signing in with one
of its existing credentials. A confirmation email to the User's `primaryEmail`
is not a proof. A user can set their `primaryEmail` to any unused address
without verifying it, so the owner of a mailbox who answered such an email
could be joining an account someone else opened under their address. A person
who cannot sign in asks an Admin to attach the Identity.

Each external provider has a "create accounts on first login" switch, on by
default for existing and new providers, which is today's behaviour.
"Self-registration" means only the local sign-up form (mitre/tir#170) and has
no bearing on external providers. What happens when an unrecognised identity
signs in:

- Its email matches the `primaryEmail` of an existing User, whatever the switch
  is set to: the person is asked to connect the login by signing in with one of
  that User's existing credentials. If they cannot, the login is rejected. The
  match only triggers the question and never links.
- No match, switch on: the account is created without a prompt, as today. The
  provider's group mappings still decide who is admitted and which role they
  get, so an unmapped user on a mapped provider is rejected.
- No match, switch off: the login is rejected with a message that an Admin must
  create the account. The switch wins over group mappings, so a user in a
  mapped group is rejected too.

On a provider with group mappings the mapping gate applies to every login,
before any Identity lookup. An identity in no mapped group cannot sign in,
connect, or prove ownership through that provider, and an Identity an Admin
attached is held to the same gate when it first signs in.

A signed-in user can connect a further login, including one with a different
email, from their profile page, and can remove one of their own Identities
there, except the last. Turning the switch off asks the Admin to confirm that
first-time users of that provider will be rejected.

An Admin can also attach an Identity to a User, or remove one, from the user
editor. This covers a person who cannot prove ownership themselves, such as a
forgotten local password or an account whose only credential lives at another
provider. The User must be a non-Admin, matching the merge rule in ADR 0002,
and must hold no Identity whose stored claims map to Admin. So an Admin
account, or one whose stored claims already map to Admin, is never taken over
through an identity an Admin attached, and the user editor cannot take an
Admin-mapped Identity off one User and attach it to another. Such an Identity
moves only by a merge its holder signs in to confirm (ADR 0002). A User's last
Identity cannot be removed, so no account is left that nobody can sign in to.
The one exception is a merge source, which ADR 0002 retires with no Identities.
Re-sync still applies to an attached Identity, under the role rules below. If
its provider claims map to Admin, the User is promoted at the next login,
exactly as that identity would receive Admin on a new account, because the
provider is the authority for claim-mapped roles. The promotion waits when
another of the User's Identities grants a different role, as it does for any
User whose Identities disagree. The action is audit-logged.

An Admin cannot know a person's subject or DN in advance, so attaching an
external Identity means choosing a provider and entering the person's email
there. That creates an unbound placeholder pinned to that one provider, which
binds at the first login through it whose email matches, under the same rules
as a migration placeholder, the reset included. A local Identity is attached by
setting a password. An account an Admin creates is given at least one Identity
in one of these two ways, so with the create switch off the person's first
login through their provider reaches the account the Admin made.

One narrow case lifts the restriction on Admins. A live Admin who holds no
Identity at all can have one attached by another Admin. Only the cutover
produces that state, for an account with no stored password whose sign-in
method had no enabled provider, because afterwards a User's last Identity
cannot be removed. Disabling a provider or resetting a placeholder later does
not produce it, since the placeholder stays on the account, and a retired merge
source is not a live account. That person has never been able to sign in since
the cutover, so the attach takes nothing from them that they could use. A
placeholder attached this way is marked Admin-mapped until it binds, as a
migration placeholder of an Admin is.

Stored claims begin with Phase 1, so an external Identity has none until it
first signs in after the migration. The migration therefore marks every
placeholder Identity of a User who is an Admin at that point as Admin-mapped,
and the login that binds it replaces the mark with the claims the provider
reports. Without the mark, demoting such an Admin before they next sign in
would lift every rule here.

The rule across linking, the user editor, and merge (ADR 0002) is that the
Identities of an Admin, or of a User holding an Admin-mapped Identity, change
only after that person signs in to the account. Three things are outside that
rule: resetting a bound placeholder, attaching to an Admin who holds no
Identity at all, both described above, and setting the password of an existing local
Identity. An Admin can set another Admin's
local password, as today, and so sign in as them. That stays because it is how
an Admin locked out of a local Identity recovers. Phase 1 does change one case.
Today an Admin can give a User who has only external logins a local password
and with it a local login, under ADR 0003 by switching the account to Local
first. Under this ADR that is attaching a local Identity and
follows the attach rules above, so it is rejected for an Admin or a User
holding an Admin-mapped Identity.

Provider claims are authoritative for the Identity they come from and are
re-synced on every login, not only when the account is created. Each login
stores on that Identity the name the provider reports and its group
memberships, so that claim-driven node membership can build on them later. The
name stays on the Identity and does not overwrite the User's own name fields.

The global role follows the claims within three limits. A provider with no
group mappings never changes it: a new account gets the User role and an
existing one keeps the role it has. A login that matches mapped groups for both
roles is granted User, the lower of the two, as the providers decide today, and
that single granted role is what "maps to Admin" means throughout this ADR.
When a User holds Identities whose stored claims grant different roles, a login
does not change the global role until the open question below is settled. An
Identity with no mapped claims, such as a local Identity or one from a provider
with no group mappings, grants no role and does not count in that comparison.
Otherwise the granted role is applied at each login.

### Consequences

- Good, because account-merge (ADR 0002) becomes possible and one person can log
  in through any provider and land on the same User even when the emails differ.
- Good, because credential storage is consolidated onto Identity as a single
  PHC-style encoded field (algorithm, iterations, salt, hash) instead of
  separate `password` and `salt` columns.
- Bad, because all four providers must be rewired to resolve via Identity; this
  is a prerequisite phase (Phase 1) before user-merge.
- Bad, because a role granted inside TIR to a user of a provider with group
  mappings is undone at their next login through it when the claims grant a
  different one; the provider is the place to change it.
- Bad, because `primaryEmail` is not verified, so a User can hold an address
  that belongs to someone else. That person's first login is then rejected
  until an Admin corrects the address. Nothing is linked, which is the point of
  refusing email as a proof.
- Bad, because the migration bind trusts a matching email from a pinned
  provider and keeps the key it sees. A wrong first bind locks the real person
  out until an Admin resets the Identity, and where several providers of a
  method are enabled at migration any of them can bind.
- Bad, because a wrong bind can demote an Admin or replace the Admin-mapped
  mark before anyone notices, and until the reset the wrongly bound person
  holds the account. The reset restores the mark and not the role.
- Bad, because an Admin who can attach an Identity can attach one of their own
  to any non-Admin User and sign in as that User. An Admin can already do that
  today by giving the account a local password, including for a User with only
  external logins, so this is not a new level of trust, and the audit entry is
  what makes it visible.
- Bad, because an Admin who loses every credential cannot be helped by
  attaching a new Identity. Another Admin resets their local password if they
  have a local Identity, and an Admin with only external logins recovers at the
  provider. The exception is an Admin the cutover left with no Identity at
  all. An Admin whose placeholder's providers are disabled later is not
  covered and waits for a pinned provider to be enabled again.
- Bad, because stored claims are those of an Identity's last login, so a User
  whose provider no longer maps them to Admin stays under the Admin rules until
  they sign in again. The same holds for the migration mark on a User who was
  an Admin at migration and whose external Identity has not signed in since.
  In the other direction, a User the provider has newly mapped to Admin is not
  covered until a login stores that claim.
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
- After the migration, the first login of an existing external user binds
  their placeholder Identity and later logins resolve by key. While a key is
  stored no login binds the placeholder again. An unbound placeholder is not
  bound by a login whose email differs from the one it holds, or through a
  provider outside its pin, including one that reuses a pinned provider's
  config id with a different issuer, server or client.
- No placeholder is created for an account whose method had no enabled
  provider at migration, and the migration logs that account.
- An Admin resetting a bound placeholder clears its key, bound provider and
  stored claims, marks it Admin-mapped if the migration had or if the cleared
  claims mapped to Admin,
  ends that Identity's sessions, cancels a pending merge the User is in, and
  writes an audit entry. It does not change the global role or any password.
  The next matching login through a pinned provider binds it. A local
  Identity, or an external one that did not begin as a placeholder, cannot be
  reset.
- An Admin attaching an external Identity enters a provider and an email,
  which creates an unbound placeholder pinned to that provider. It binds at
  the first login through that provider with that email and through no other.
  An account an Admin creates holds at least one Identity.
- A login through a config entry that was repointed at a different issuer or
  server does not resolve to Identities recorded under the old one.
- An unknown identity is attached to a User only after the person signs in
  with one of that User's existing credentials, or when an Admin attaches it,
  and never because the email addresses match. No confirmation email links a
  login.
- A first-time login whose email matches an existing User creates no account
  and attaches nothing until that sign-in happens.
- Changing a User's `primaryEmail` changes the email their local Identity
  signs in with, and the old address no longer signs in.
- An Admin attaching or removing an Identity writes an audit entry.
- From the user editor, attaching an Identity to or removing one from an Admin,
  or a User holding an Identity whose stored claims map to Admin, is rejected.
  So is an Admin setting a local password for such a User who has no local
  Identity. The one exception is an attach to a live Admin who holds no
  Identity at all. Disabling a provider or resetting a placeholder does not
  open that exception, because the placeholder remains.
- Removing a User's last Identity is rejected. A signed-in user, Admin or not,
  can remove one of their own Identities from the profile page but not the
  last. Giving a User a second local Identity is rejected by every route.
- A placeholder Identity of a User who was an Admin at the migration counts as
  Admin-mapped until the login that binds it, also when that User has been
  demoted in between.
- With a provider's create switch off, a first-time login with no matching
  User creates no account, and turning the switch off asks for confirmation.
- On a provider with group mappings, a login in no mapped group is rejected
  before any Identity lookup, including one that would connect to an existing
  User or that already belongs to one.
- A login through a provider with no group mappings changes no role. A login
  matching mapped groups for both roles is granted User.
- For a User whose Identities grant one role, a login whose claims grant a
  different global role changes the User's role. When a User's Identities
  grant different roles a login changes none, pending the open question below.
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
registration), mitre/tir#183. Until this lands, lmco/tir ADR 0003 holds an interim
rule of one sign-in method per account.

A possible later addition, behind its own option: with the create switch off,
hold an unknown person's account pending Admin approval instead of rejecting
the login.

Still open from mitre/tir discussion 197:

- When a User's identities map to different global roles, whether the least
  privileged of them applies.
- What happens to a member's boundary memberships when a re-sync promotes them
  to Admin: strip the membership rows, or keep them and block boundary data
  access while the account is an Admin.
