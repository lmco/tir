---
status: accepted
date: 2026-11-19
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
keys (email / OIDC subject / LDAP DN, and the local password credential) move
off the User row onto a one-to-many Identity table. Login resolves
`provider + external key -> Identity -> User`, replacing today's
`User.findOne({ where: { email } })`. The User keeps a single `primaryEmail` for
display and notifications. It stays unique across Users, as email is today.

Phase 1 lands as one change: a single migration introduces Identity and moves
the external keys and credentials onto it, and all four providers switch to it
together, rather than slicing provider by provider, so the schema changes once.

Linking is explicit. An identity TIR does not recognise is never attached to a
User because its email matches one. A person attaches it by proving ownership
of the User, either by signing in with one of its existing credentials or by
answering a confirmation email sent to the User's `primaryEmail`. The email
proof is a deliberate act by someone who controls that mailbox, the same trust
as an email password reset, which is different from two providers happening to
report the same address. It is available only where TIR is configured to send
mail. It is not accepted for an Admin, or for a User holding an Identity whose
stored provider claims (those from its last login) map to Admin, because an
Admin can change another User's `primaryEmail`. Linking to such a User needs a
sign-in with one of its existing credentials.

Each external provider has a "create accounts on first login" switch, on by
default for existing and new providers, which is today's behaviour.
"Self-registration" means only the local sign-up form (mitre/tir#170) and has
no bearing on external providers. What happens when an unrecognised identity
signs in:

- Its email matches the `primaryEmail` of an existing User, whatever the switch
  is set to: the person is asked to connect the login by proving ownership of
  that User. If they cannot, the login is rejected. The match only triggers the
  question and never links.
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
through an identity an Admin attached, and the user editor cannot take an Admin-mapped
Identity off one User and attach it to another. Such an Identity moves only by
a merge its holder signs in to confirm (ADR 0002). A User's last Identity
cannot be removed, so no account is left that nobody can sign in to. The one
exception is a merge source, which ADR 0002 retires with no Identities. Re-sync still applies to an
attached Identity. If its provider claims map to Admin, the User is promoted at
the next login, exactly as that identity would receive Admin on a new account,
because the provider is the authority for claim-mapped roles. The action is
audit-logged.

Stored claims begin with Phase 1, so an external Identity has none until it
first signs in after the migration. The migration therefore marks every
external Identity of a User who is an Admin at that point as Admin-mapped, and
the Identity's next login replaces the mark with the claims the provider
reports. Without the mark, demoting such an Admin before they next sign in
would lift every rule here.

The rule across linking, the user editor, and merge (ADR 0002) is that the
Identities of an Admin, or of a User holding an Admin-mapped Identity, change
only after that person signs in to the account. Setting the password of an
existing local Identity is outside that rule. An Admin can set another Admin's
local password, as today, and so sign in as them. That stays because it is how
an Admin locked out of a local Identity recovers. Phase 1 does change one case.
Today an Admin can give a User who has only external logins a local password
and with it a local login. Under this ADR that is attaching a local Identity and
follows the attach rules above, so it is rejected for an Admin or a User
holding an Admin-mapped Identity.

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
- Bad, because an Admin who can attach an Identity can attach one of their own
  to any non-Admin User and sign in as that User. An Admin can already do that
  today by giving the account a local password, including for a User with only
  external logins, so this is not a new level of trust, and the audit entry is
  what makes it visible.
- Bad, because an Admin who loses every credential cannot be helped by
  attaching a new Identity. Another Admin resets their local password if they
  have a local Identity, and an Admin with only external logins recovers at the
  provider.
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

All four `server/auth/*AuthProvider.ts` resolve login through Identity with no
remaining `User.findOne({ where: { email } })` login path; local password
verifies against the PHC field stored on the Identity. An unknown SSO identity
is attached to a User only after the person proves ownership of that User, by
presenting one of its existing credentials or by a confirmation email, or
when an Admin attaches it, and never because the email addresses match. An
Admin attaching or removing an Identity writes an audit entry. From the user
editor, attaching an Identity to or removing one from an Admin, or a User
holding an Identity whose stored claims map to Admin, is rejected, and so is
removing a User's last Identity. A confirmation email does not link a login to
such a User, and an Admin setting a local password for such a User who has no
local Identity is rejected. Giving a User a second local Identity is rejected
by every route. A signed-in user, Admin or not, can remove one of their own
Identities from the profile page but not the last. An external Identity of a User who was an Admin at
the migration counts as Admin-mapped until its first login afterwards, also
when that User has been demoted in between. With a provider's create
switch off, a first-time login with no matching User creates no account, and
turning the switch off asks for confirmation. A first-time login whose email
matches an existing User creates no account and attaches nothing until
ownership is proven. On a provider with group mappings, a login in no mapped
group is rejected before any Identity lookup, including one that would connect
to an existing User or that already belongs to one. For a User with a single Identity, a login whose claims
map a different global role changes the User's role. How roles combine when a
User's identities disagree waits on the open question below.

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
