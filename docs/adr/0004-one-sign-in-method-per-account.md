---
status: proposed
date: 2026-11-18
decision-makers: Mark Rivera
consulted: Amndeep Singh Mann
---

# An account has one sign-in method until Identities exist

## Context and Problem Statement

Every provider resolves a login to a User by email. With several providers
configured, an identity presented by one provider lands on an account created
through another whenever the email addresses coincide, and nothing in TIR
decided that they are the same person. ADR 0001 replaces email as the login
key with an Identity table resolved by provider and external key. Under it, a
first login whose email matches an existing User is asked to prove ownership
of that User and is never linked on the match. That work is a single large
migration that has not started, while the multi-provider release (lmco/tir#14)
is about to ship and widens the number of providers that can present a
coinciding email. What should happen in the meantime when a login matches an
existing account that a different method created?

## Decision Drivers

- mitre/tir discussion 197 treats implicit linking by email as an
  account-takeover vector that needs action now, not only once Identities
  exist.
- Deployments already have people who sign in through more than one method on
  one email, typically an admin created locally who also uses SSO, and an
  interim rule must leave a way to serve them.
- The interim must not add schema or configuration that ADR 0001 then has to
  remove.
- A user who has lost one credential (a forgotten local password) must be
  able to move to another method without losing the account.
- A change to how an account signs in must leave a record of who made it, and
  must not leave TIR with no Admin able to sign in.

## Considered Options

- Keep implicit linking by email until ADR 0001 lands.
- One sign-in method per account: refuse a login through any other method,
  and let the method be changed deliberately.
- A per-provider "link existing accounts by email" switch, off for new
  providers and on for existing ones.
- Bring ADR 0001 forward into the multi-provider release.

## Decision Outcome

Chosen option: "One sign-in method per account", because it applies ADR 0001's
rule that a matching email never links, across methods, before the prove-
ownership prompt exists, it needs no schema change, and its escape hatch is a
deliberate action on the user record that ADR 0001 turns into attaching an
Identity.

Each User has exactly one sign-in method, recorded in the existing
`creationMethod` column as `local`, `ldap`, `oidc` or `oauth`, with null read
as `local`. A login whose email matches an account under a different method is
refused. Through an external provider the message names the account's method
and says how it can be changed. The local form gives the same answer as a
wrong password, so it does not reveal which emails have accounts. This refusal
stands in for ADR 0001's prompt to prove ownership.

An Admin can change the sign-in method of any account in the user editor,
another Admin's included. Admins are trusted with each other's accounts, as
they already are through the password reset and the provider configuration.
This covers an admin created locally who moves to SSO, and an Admin who has
lost their only credential. Each change is written to the log with the
account, the old and new method and the Admin who made it. The log entry is
what makes a takeover visible. A change made to someone else's account ends
that account's sessions, so a session opened through the old method does not
outlive it. An Admin changing their own method stays signed in.

A change is refused when it would leave no Admin able to sign in. That covers
a method change, a role change, deleting an account, and saving a provider
configuration that removes or disables the providers the remaining Admins
depend on. An account can sign in through any provider of its method, so the
check counts an Admin as able to sign in while any provider of their method is
enabled, or while they hold a password and local sign-in is available. It is a
lockout guard and not a trust rule, and it does not stop a change made while
no Admin could sign in already. The guard also holds at login. A role that a
provider's group mappings grant is applied as the provider reports it, except
that a login which would lower the last Admin able to sign in keeps the Admin
role and writes a warning to the log. Mappings that give every Admin the User
role, such as an Admin group next to a broad User group that every Admin is
also in, would otherwise leave nobody able to correct them. The cost is that a
last Admin who has left keeps the role for as long as any of their logins
still works, so ending that access means closing the login, at the provider or
in TIR.

Moving away from `local` keeps the stored password as a fallback until the
first successful sign-in through the new method, which clears it. Until then
local password login still works, so a switch to a method that turns out not
to work cannot lock the account. Once no password is stored, local login is
refused for an account whose method is not local. The reset refuses to set a
password for an account whose method is not local at any time, so a fallback
password cannot be changed and does not come back once it is cleared. Moving
to `local` keeps any stored password and does not create one. An account
without one has it set with the existing reset. Providers of the same family
(two LDAP directories, two OIDC realms) share one method and are not told
apart. That distinction waits for ADR 0001.

### Consequences

- Good, because an identity presented through one method can no longer take
  over an account created through another method by matching its email.
- Good, because the escape hatch is a visible action on the user record rather
  than a hidden rule, and it is the action ADR 0001 turns into attaching an
  Identity.
- Bad, because a person who signs in through two methods today keeps only the
  one that created the account until the method is changed or ADR 0001 lands.
  For the common case an SSO sign-in is refused and local still works.
- Bad, because a non-Admin user who loses their only credential depends on an
  Admin to move them, where ADR 0001 lets them connect a login themselves.
- Good, because an Admin who loses their only credential is moved to another
  method by another Admin, the same as any other user.
- Bad, because an Admin can switch another Admin's account to a method where
  they control a login with that email address and then sign in as them. An
  Admin can already do that with a password reset, and the log entry records
  who made the change.
- Bad, because the lockout guard judges by method and does not ask whether the
  last Admin exists at the provider that remains, so removing the one
  directory they use is allowed while another directory of that method stays
  enabled.
- Bad, because a deployment's only Admin, when signed in through an external
  method, cannot move to Local. The reset refuses an account that is not
  Local, and the lockout guard refuses a Local Admin with no password. A
  second Admin with a local password is the way round it. ADR 0001 removes
  the case, since a local login is then attached by setting a password.
- Neutral, because `creationMethod` now means the account's current sign-in
  method rather than how it was first created. The Phase 1 migration (ADR
  0003) reads the column to create each account's Identity and the old meaning
  is not needed afterwards.

### Confirmation

`finalizeLogin` in `server/auth/authProvider.ts` and `LocalAuthProvider`
refuse a login whose method differs from the account's, covered by unit tests
on the rule. `server/api/users/edit.put.ts` accepts a method change from an
Admin for any account, rejects it from anyone else, and logs it.
`anyAdminCanSignIn` in `server/auth/signInMethod.ts` is the lockout guard,
covered by unit tests and called from the user edit, the user delete and the
provider configuration save.
After a change away from `local`, local login works until the first sign-in
through the new method and is refused after it.
`server/api/auth/setPW.post.ts` refuses a password for an account whose method
is not local. Checked
against LDAP and OAuth test providers: an LDAP-created user is refused by the
OAuth provider, an Admin switches the user to OAuth, the OAuth provider then
signs the user in and LDAP is refused.

## Pros and Cons of the Options

### Keep implicit linking by email until ADR 0001 lands

- Good, because nothing changes for existing deployments.
- Bad, because the takeover described in discussion 197 stays open for the
  whole life of the multi-provider release.

### One sign-in method per account

- Good, because it is the smallest change that closes the hole, and its rule
  that a matching email never links across methods is one the final design
  keeps.
- Good, because every affected non-Admin user can be resolved with one field.
- Bad, because dual-method users lose a method until someone acts.

### Per-provider link switch

- Good, because an upgrade changes nothing for existing providers.
- Bad, because it adds a configuration surface that permits exactly the
  implicit linking ADR 0001 rejects, and ADR 0001 would have to remove it.

### Bring ADR 0001 forward

- Good, because the final model ships once.
- Bad, because Phase 1 rewires all four providers plus a data migration, and
  holding the multi-provider release for it leaves the hole open longer than
  the interim rule does.

## More Information

Interim for ADR 0001 (multi-identity login) and ADR 0002 (user-merge), which
are recorded in lmco/tir#48. ADR 0003 is recorded in lmco/tir#52. Both merge
after this one. Implemented in lmco/tir#14. Superseded when ADR 0001 lands.
