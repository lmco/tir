---
status: proposed
date: 2026-11-20
decision-makers: Mark Rivera
---

# Existing logins cross the Identity cutover through placeholders bound at first login

## Context and Problem Statement

ADR 0001 moves login onto an Identity table resolved by provider and external
key. Like ADR 0001, this ADR takes as its starting point main after
lmco/tir#14.

Before lmco/tir#14 the external keys were not stored. OIDC checked the subject
and discarded it, LDAP bound with the DN, OAuth kept no account id, and each
then found the User by email. From lmco/tir#14 on, each external login records
the provider's identifier and the key on the account (ADR 0004), but an
account that has not signed in since has neither. So the Phase 1 migration
cannot fill the keys in for those accounts, and without a bridge each of them
would arrive after the cutover as an unrecognised identity. ADR 0001 would
then ask each of them to sign in with an existing credential, which an account
with only an external login does not have. The same gap exists whenever an
Admin prepares a login for someone else, because an Admin cannot know a
person's subject or DN in advance. How do existing accounts, and accounts an
Admin prepares, get their external key?

## Decision Drivers

- No account that can sign in before the cutover may be locked out by it.
- The bridge must not reopen linking by email match beyond the one login that
  needs it.
- A provider that did not exist at the cutover must not be able to claim an
  existing account.
- A wrong first assertion must be correctable, also for an Admin who has only
  an external login.

## Considered Options

- No bridge: existing external logins arrive unrecognised and prove ownership
  under ADR 0001.
- Rebind by email: on the providers present at migration, keep honouring a
  login that presents the account's email and let it replace the stored key.
- Placeholder Identities bound once, with an Admin reset.

## Decision Outcome

Chosen option: "Placeholder Identities bound once, with an Admin reset",
because it carries every working login across the cutover, trusts an email
match for a single login instead of indefinitely, and leaves a recovery that
does not depend on the person being able to sign in.

The migration creates a local Identity for each User with a stored password.
For a User whose sign-in method is an external one and whose account carries
a recorded provider identifier and key (ADR 0004), it creates an Identity
bound to that provider and key, provided the provider still exists and is of
the account's method. Such an account needs no placeholder and is never
matched by email. For every other User whose sign-in method is an external
one, it creates a placeholder Identity for that method holding the User's
email at migration and no key. The
sign-in method is the account's single method under ADR 0004, which keeps it
in the `creationMethod` column, changes it only through the method switch, and
refuses a login through any other method. Without that rule the column would
only say how the account was created. ADR 0004 also keeps a stored password
working as a local fallback after a switch away from Local, until the first
login through the new method clears it, so a local Identity for every stored
password carries over what works at the cutover.

For an account without a recorded key nothing says which provider it uses, so
a placeholder is pinned to
the providers of its method that are enabled when the migration runs, a single
one in most deployments. The pin is the list of those providers' identifiers
(ADR 0001), stored on the placeholder row, so a provider that is added or
enabled later can never bind it. A pinned provider whose address is edited
keeps its identifier and stays pinned. A provider that exists at the cutover
carries its identifier already or is given one by the migration before any
placeholder is pinned. The first successful login through a pinned provider
whose email equals the placeholder's records the presented key and that
provider on it, and while a key is stored no other login binds it. A login
whose provider and key already resolve to an Identity signs in to that
Identity's User and binds no placeholder. A placeholder is not affected by
later changes to `primaryEmail` and is never bound by a login whose email
differs. Addresses are compared exactly, case included, as today's lookup and
the unique `email` column do, here and for the reservation below. Where the
provider's verified-email setting from lmco/tir#14 is on, an address the
provider does not report as verified binds nothing. This is the one place a
login is tied to a User by email. When no provider of an account's method is
enabled at migration, no placeholder is created. The migration logs and flags
every account it leaves without an Identity, so the operator can see who will
need help signing in. That is an account with no stored password whose method
either has no enabled provider or is Local, which ADR 0004 allows after a
switch to Local until a password is set. An Admin attaches an Identity to such
an account as to any User (ADR 0001), an Admin's account included.

The migration also logs and flags every provider it pins a placeholder to
whose verified-email setting is off, and every LDAP provider it pins one to,
because a placeholder at such a provider binds on an address the provider has
not verified. Before the cutover the operator turns the setting on, or
confirms that users of the directory cannot edit their own mail attribute.

An email must never name two accounts at a login. An address held by a
placeholder is reserved for as long as the placeholder exists, bound or not,
because a reset can unbind it again. Another User cannot take it as
`primaryEmail` (ADR 0001), an Admin cannot attach a placeholder whose email is
another User's `primaryEmail`, and no placeholder of another User can hold it.
One person may hold placeholders at several providers under the same address. A
retired merge source's address counts as its target's here, so it is reserved
against everyone else. The migration cannot create an overlap, because each
placeholder starts with its own User's unique email. Should one exist all the
same, no placeholder binds. Where the email is another User's `primaryEmail`
the login is asked to sign in to that User, as ADR 0001 does for any match, and
where placeholders of two Users hold it the login is rejected. No action these
ADRs allow produces that state, so it is a defect. An Admin releases it in the
user editor by attaching a corrected placeholder and removing the colliding
one. A login that binds nothing can still present a reserved address, through
a provider outside the pin, with an unverified address, or under a new key
once the placeholder is bound. It is treated as ADR 0001 treats a match on
`primaryEmail`: the person is asked to sign in with one of that User's
existing credentials, and no account is created whatever the create switch
says. Local sign-up with a reserved address is refused.

A placeholder that a merge moved to the target (ADR 0002) stops binding on an
email match, because the merge has widened what that login would reach. A login
whose email matches it is asked to sign in with one of the target's
credentials, and that sign-in binds it. The pin and the verified-email setting
apply to that login as they do to any bind. This stays true of that placeholder
for good, so a reset later does not reopen the email match.

Today's lookup checks the email again on every login. The bind keeps the first
key it sees, so a wrong first assertion does not correct itself. An Admin can
reset a bound placeholder from the user editor, on an Admin's account as on
any other, with an audit entry. The reset clears the key, the bound provider
and the claims the binding login stored, and ends the sessions opened through
that Identity. The next matching login through a pinned provider then binds it
again. The reset does not restore a global role the wrong bind changed. On a
provider with group mappings the right login re-syncs it, and otherwise an
Admin sets it. Only an Identity that began as a placeholder can be reset. A
local Identity cannot, nor can an external one its owner connected while
signed in, and a reset leaves a local password as it is unless it was set
since the bind, as the next paragraph describes.

A wrongly bound person holds the account until the reset and can use it as its
owner would. The reset therefore also undoes what it mechanically can. It
removes every Identity connected to the account since the bind, ends the
account's sessions, revokes every API token created since the bind, and clears
a local password set since the bind, so that it has to be set again. Identities
that a merge moved onto the account since the bind are kept, because they are
another person's logins and removing them would leave that person with none. It
goes by time and not by which session made the change, because a wrongly bound
person can connect a second login and carry on through that one. Anything the
owner added in that window goes too and can be added again. It does not undo
other edits made since the bind, such as a changed `primaryEmail` or an
Identity that was removed. The audit entry lists them for the resetting Admin,
and the owner gets back in by binding the placeholder again.

An Admin cannot know a person's subject or DN in advance, so attaching an
external Identity under ADR 0001 means choosing a provider and entering the
person's email there. That creates an unbound placeholder pinned to that one
provider, which binds at the first login through it whose email matches, under
the same rules as a migration placeholder, the reset and the reserved address
included. With the create switch off, this is how the person's first login
through their provider reaches the account the Admin made.

For the lockout guard in ADR 0001, an unbound placeholder counts as a working
Identity at every provider in its pin, and a retired merge source is not a
live account.

### Consequences

- Good, because every external login that works before the cutover works after
  it without the person doing anything.
- Good, because after the first bind the stable key decides, so an address the
  provider later gives to someone else does not inherit the account.
- Bad, because the bind trusts a matching email from a pinned provider and
  keeps the key it sees. A wrong first bind locks the real person out until an
  Admin resets the Identity, and where several providers of a method are
  enabled at migration any of them can bind.
- Bad, because a wrong bind can demote an Admin before anyone notices, and
  until the reset the wrongly bound person holds the account. The reset does
  not restore the role.
- Bad, because a stored password that ADR 0004 kept only as a fallback after a
  switch away from Local becomes a lasting local Identity, which stays until
  its owner removes it.
- Bad, because an address held by a placeholder cannot be used as anyone
  else's `primaryEmail` for as long as that Identity exists, also after its
  owner has moved to another address.
- Bad, because a person whose unbound placeholder moved in a merge has to sign
  in with one of the target's credentials once before that login works.
- Bad, because a reset sends the bind back to whoever a pinned provider
  reports under the placeholder's address, which the provider may have given
  to someone else since the first bind.
- Bad, because an LDAP account created without a mail attribute holds an
  address TIR made up. If the directory supplies a real one later, the
  placeholder does not bind and an Admin has to attach a new one.
- Bad, because a provider that lets a person set an unverified address of
  their own choosing, with its verified-email setting off, lets anyone at that
  provider who sets a placeholder's address bind it, at the first bind and
  after a reset. For such a provider the setting has to be on. LDAP has no
  such setting, and the address is whatever the directory's mail attribute
  holds. A bind through LDAP is safe only where users cannot edit that
  attribute themselves, which the operator has to confirm. The migration
  flags both kinds of provider, and only accounts that have not signed in
  since lmco/tir#14 are exposed.
- Bad, because two unlikely states leave a deployment's only Admin, when that
  account's one Identity is an unbound placeholder, with no recovery inside
  TIR. One is an LDAP directory starting to supply a real address in place of
  the made-up one before that account's first login after the cutover. The
  other is its address colliding with another User's, which no action these
  ADRs allow produces. With a second Admin either is fixed by attaching a
  login. For a sole Admin an operator correcting the row in the database is
  the interim answer.
- Bad, because a reset cannot give back what a wrongly bound person changed or
  removed by hand, and it also removes what the owner added since the bind.
  It lists the edits in the audit entry and leaves them to the owner and the
  resetting Admin.

### Confirmation

- After the migration, the first login of an existing external user binds
  their placeholder Identity and later logins resolve by key. While a key is
  stored no login binds the placeholder again. An unbound placeholder is not
  bound by a login whose email differs from the one it holds, or through a
  provider outside its pin, including one added after a pinned
  provider was deleted that reuses its config id. A pinned provider whose
  address was edited still binds it.
- A login whose provider and key already resolve to an Identity binds no
  placeholder, also when its email matches an unbound one.
- Every provider that exists at the cutover has an identifier before any
  placeholder is pinned to it.
- An account with a recorded provider identifier and key gets a bound
  Identity and no placeholder, and its first login after the cutover resolves
  by key.
- The migration log names every provider that has a placeholder pinned to it
  and either has its verified-email setting off or is an LDAP provider.
- Every User with a stored password holds a local Identity after the
  migration.
- No placeholder is created for an account whose method had no enabled
  provider at migration. The migration logs every account it leaves with no
  Identity, including a Local account with no stored password.
- An Admin resetting a bound placeholder clears its key, bound provider and
  stored claims and writes an audit entry, on an Admin's account as on any
  other. It does not change the global role, and it changes no password except
  one set since the placeholder bound. The next matching login through a
  pinned provider binds it. A local Identity, or an external one that did not
  begin as a placeholder, cannot be reset.
- An Admin attaching an external Identity enters a provider and an email,
  which creates an unbound placeholder pinned to that provider. It binds at
  the first login through that provider with that email and through no other.
- Attaching a placeholder whose email is another User's `primaryEmail`, or the
  email of another User's placeholder, bound or not, is rejected. A retired
  merge source's address is open only to its target. A login whose email
  matches an unbound placeholder and another User's `primaryEmail` binds
  nothing. One User may hold placeholders at several providers under one
  address.
- A login whose email differs from a placeholder's in letter case does not
  bind it, as it would not reach the account today.
- A reset removes every Identity connected to the account since the
  placeholder bound, including one connected through a login that was itself
  connected since then, ends the account's sessions, revokes the API tokens
  created since then, clears a local password set since then, and lists the
  other edits made since then in its audit entry. Identities a merge moved
  onto the account since then are kept.
- A login that binds nothing and presents an address a placeholder holds
  creates no account and is asked to sign in to that placeholder's User. Local
  sign-up with such an address is refused.
- A placeholder that a merge moved is bound only after a sign-in with one of
  the target's credentials, before and after a reset.
- An account the migration left without an Identity, an Admin's included, can
  have one attached by an Admin.
- For the lockout guard in ADR 0001, an unbound placeholder counts as a
  working Identity at every provider in its pin.

## Pros and Cons of the Options

### No bridge

- Good, because it adds no rule to ADR 0001.
- Bad, because an account with only an external login has no existing
  credential to prove ownership with, so it is locked out.

### Rebind by email

- Good, because it is today's lookup limited to the providers present at
  migration, and a wrong assertion corrects itself at the next login.
- Bad, because email stays the effective login key of every migrated account
  for as long as the account exists, which is what ADR 0001 sets out to end.

### Placeholder Identities bound once, with an Admin reset

- Good, because an email match is trusted for one login per account.
- Good, because the same mechanism serves an Admin preparing a login for
  someone else.
- Bad, because it needs the reset action and the pin.

## More Information

Bridge for Phase 1 of ADR 0001. Reads the sign-in method that ADR 0004 defines.

lmco/tir#14 records the provider identifier and the external key at each
login (ADR 0004), so the placeholders in this ADR are for the accounts that do
not sign in between that release and the cutover.
