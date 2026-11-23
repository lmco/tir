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

The external keys are not stored today. OIDC checks the subject and discards
it, LDAP binds with the DN, OAuth keeps no account id, and each then finds the
User by email. So the Phase 1 migration cannot fill the keys in, and without a
bridge every existing external user would arrive after the cutover as an
unrecognised identity. ADR 0001 would then ask each of them to sign in with an
existing credential, which an account with only an external login does not
have. The same gap exists whenever an Admin prepares a login for someone else,
because an Admin cannot know a person's subject or DN in advance. How do
existing accounts, and accounts an Admin prepares, get their external key?

## Decision Drivers

- No account that can sign in before the cutover may be locked out by it.
- The bridge must not reopen linking by email match beyond the one login that
  needs it.
- A provider that did not exist at the cutover must not be able to claim an
  existing account.
- A wrong first assertion must be correctable, also for an Admin who has only
  an external login.
- The ADR 0001 rule that an Admin's Identities change only after that Admin
  signs in should bend as little as possible.

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

The migration creates a local Identity for each User with a stored password
and, for each User whose sign-in method is an external one, a placeholder
Identity for that method holding the User's email at migration and no key. The
sign-in method is the account's single method under ADR 0004, which keeps it
in the `creationMethod` column, changes it only through the method switch, and
refuses a login through any other method. Without that rule the column would
only say how the account was created. ADR 0004 also keeps a stored password
working as a local fallback after a switch away from Local, until the first
login through the new method clears it, so a local Identity for every stored
password carries over what works at the cutover.

Nothing records which provider an account uses, so a placeholder is pinned to
the providers of its method that are enabled when the migration runs, a single
one in most deployments. The pin is the list of those providers' identifiers
(ADR 0001), stored on the placeholder row, so a provider that is added or
enabled later can never bind it. A pinned provider whose address is edited
keeps its identifier and stays pinned. The first successful login through a
pinned provider whose email equals the placeholder's records the presented key
and that provider on it, and while a key is stored no other login binds it. A
placeholder is not affected by later changes to `primaryEmail` and is never
bound by a login whose email differs. Addresses are compared exactly, case
included, as today's lookup and the unique `email` column do, here and for the
reservation below. Where the provider's verified-email setting from lmco/tir#14
is on, an address the provider does not report as verified binds nothing. This
is the one place a login is tied to a User by email. The bind fills in an
Identity the User already holds, so the ADR 0001 rule on changing an Admin's
Identities does not apply to it. When no provider of an account's method is
enabled at migration, no placeholder is created. The migration logs every
account it leaves without an Identity, so the operator can see who will need
help signing in. That is an account with no stored password whose method either
has no enabled provider or is Local, which ADR 0004 allows after a switch to
Local until a password is set.

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
user editor only on an account the ADR 0001 Admin rule does not protect, by
attaching a corrected placeholder and removing the colliding one. The
placeholder of an Admin, or of a User holding an Admin-mapped Identity, is not
changed until that person signs in.

A placeholder that a merge moved to the target (ADR 0002) stops binding on an
email match, because the merge has widened what that login would reach. A
login whose email matches it is asked to sign in with one of the target's
credentials, and that sign-in binds it. This stays true of that placeholder
for good, so a reset later does not reopen the email match.

Today's lookup checks the email again on every login. The bind keeps the first
key it sees, so a wrong first assertion does not correct itself. An Admin can
reset a bound placeholder from the user editor, with an audit entry. The reset
clears the key, the bound provider and the claims the binding login stored,
keeps any Admin-mapped mark the Identity carries, including a demotion mark
from ADR 0001, puts back the placeholder mark it carried before it was bound,
marks it if the claims being cleared mapped to Admin, ends the sessions opened
through that Identity, and cancels a pending merge the User is part of (ADR
0002). The next matching login through a pinned provider then binds it again.
The reset does not restore a global role the wrong bind changed. On a provider
with group mappings the right login re-syncs it, and otherwise an Admin sets
it. Only an Identity that began as a placeholder can be reset. A local Identity
cannot, nor can an external one its owner connected while signed in, and a
reset leaves the User's local password as it is. The reset is allowed on an
Admin's Identity too, because it is the only recovery for an Admin whose single
external login was bound to the wrong key. It hands the resetting Admin nothing
they control as long as the pinned provider decides which address a login
reports, since the bind goes to whoever it reports under that address.

An Admin cannot know a person's subject or DN in advance, so attaching an
external Identity under ADR 0001 means choosing a provider and entering the
person's email there. That creates an unbound placeholder pinned to that one
provider, which binds at the first login through it whose email matches, under
the same rules as a migration placeholder, the reset and the reserved address
included. With the create switch off, this is how the person's first login
through their provider reaches the account the Admin made.

Stored claims begin with Phase 1, so an external Identity has none until it
first signs in after the migration. The migration therefore marks every
placeholder Identity of a User who is an Admin at that point as Admin-mapped,
and the login that binds it replaces the mark with the claims the provider
reports. Without the mark, demoting such an Admin before they next sign in
would lift every Admin rule in ADR 0001.

One narrow case lifts the ADR 0001 restriction on attaching to an Admin. A live
Admin who holds no Identity at all can have one attached by another Admin. Only
the cutover produces that state, for the accounts the migration logs as left
without an Identity, because afterwards a User's last Identity cannot be
removed. Disabling or removing a provider, or resetting a placeholder, does not
produce it later, since removing a provider leaves the Identities recorded
under it on their accounts and the placeholder stays where it is. For the ADR
0001 rule on deleting a provider, an unbound placeholder counts as an Identity
at every provider in its pin, and a retired merge source is not a live account.
That person has never been able to sign in since the cutover, so the attach
takes nothing from them that they could use. A placeholder attached this way is
marked Admin-mapped until it binds, as a migration placeholder of an Admin is.

### Consequences

- Good, because every external login that works before the cutover works after
  it without the person doing anything.
- Good, because after the first bind the stable key decides, so an address the
  provider later gives to someone else does not inherit the account.
- Bad, because the bind trusts a matching email from a pinned provider and
  keeps the key it sees. A wrong first bind locks the real person out until an
  Admin resets the Identity, and where several providers of a method are
  enabled at migration any of them can bind.
- Bad, because a wrong bind can demote an Admin or replace the Admin-mapped
  mark before anyone notices, and until the reset the wrongly bound person
  holds the account. The reset restores the mark and not the role.
- Bad, because the migration mark keeps a User who was an Admin at migration
  under the Admin rules until their external Identity signs in, also after a
  demotion.
- Bad, because an Admin whose placeholder's providers are disabled after the
  cutover is not covered by the no-Identity exception and waits for a pinned
  provider to be enabled again.
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
- Bad, because under the no-Identity exception the attaching Admin chooses the
  login, so they can sign in as that account. Nobody could use it before, and
  the attach is audit-logged.
- Bad, because an LDAP account created without a mail attribute holds an
  address TIR made up. If the directory supplies a real one later, the
  placeholder does not bind and an Admin has to attach a new one, which ADR
  0001 allows for a non-Admin only.
- Bad, because a provider that lets a person set an unverified address of
  their own choosing, with its verified-email setting off, lets whoever resets
  a placeholder bind it themselves. For such a provider the setting has to be
  on before the reset is safe to use on an Admin's account.
- Bad, because two unlikely states leave an Admin whose only Identity is an
  unbound placeholder with no recovery inside TIR. One is an LDAP directory
  starting to supply a real address in place of the made-up one before that
  account's first login after the cutover. The other is its address colliding
  with another User's, which no action these ADRs allow produces. Until either
  is seen in practice, an operator correcting the row in the database is the
  interim answer, and a real occurrence is the cue to design a proper one.
- Bad, because two actions now sit outside the rule that an Admin's Identities
  change only after that Admin signs in: the reset and the no-Identity attach.

### Confirmation

- After the migration, the first login of an existing external user binds
  their placeholder Identity and later logins resolve by key. While a key is
  stored no login binds the placeholder again. An unbound placeholder is not
  bound by a login whose email differs from the one it holds, or through a
  provider outside its pin, including one added after a pinned
  provider was deleted that reuses its config id. A pinned provider whose
  address was edited still binds it.
- Every User with a stored password holds a local Identity after the
  migration.
- No placeholder is created for an account whose method had no enabled
  provider at migration. The migration logs every account it leaves with no
  Identity, including a Local account with no stored password.
- An Admin resetting a bound placeholder clears its key, bound provider and
  stored claims, keeps any Admin-mapped mark it carries, a demotion mark
  included, restores the placeholder mark it had before it was bound, marks
  it if the cleared claims mapped to Admin, ends that Identity's
  sessions, cancels a pending merge the User is in, and writes an audit entry.
  It does not change the global role or any password. The next matching login
  through a pinned provider binds it. A local Identity, or an external one
  that did not begin as a placeholder, cannot be reset.
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
- A placeholder that a merge moved is bound only after a sign-in with one of
  the target's credentials, before and after a reset.
- A placeholder Identity of a User who was an Admin at the migration counts as
  Admin-mapped until the login that binds it, also when that User has been
  demoted in between.
- Attaching an Identity to a live Admin who holds no Identity at all is
  accepted. Disabling or removing a provider, or resetting a
  placeholder, does not open that exception, because the Identity remains.

## Pros and Cons of the Options

### No bridge

- Good, because it adds no rule to ADR 0001.
- Bad, because an account with only an external login has no existing
  credential to prove ownership with, so it is locked out, and for an Admin no
  other Admin can help.

### Rebind by email

- Good, because it is today's lookup limited to the providers present at
  migration, and a wrong assertion corrects itself at the next login.
- Bad, because email stays the effective login key of every migrated account
  for as long as the account exists, which is what ADR 0001 sets out to end.

### Placeholder Identities bound once, with an Admin reset

- Good, because an email match is trusted for one login per account.
- Good, because the same mechanism serves an Admin preparing a login for
  someone else.
- Bad, because it needs the reset action, the pin and the Admin-mapped
  mark.

## More Information

Bridge for Phase 1 of ADR 0001. Reads the sign-in method that ADR 0004 defines.

Recording the external key and the provider at each login ahead of Phase 1
would let the migration fill in real keys for accounts that sign in before the
cutover and leave placeholders only for the rest. That is not decided here.
