# Deploy

Review-app style deployments of any ref of a source repository (default `mitre/tir`) into
the cluster. Every deployment is a slot: `https://<slot>.tirtest.com`, a Deployment,
Service and Ingress named `tir-<slot>` in namespace `tir`, and its own Postgres database
`tir_<slot>` on the dedicated CNPG cluster `tir-review-db`, created declaratively through a
CNPG `Database` resource so branches with different migrations never share a schema.

## Triggers

| Event                                                  | Result                                               |
| ------------------------------------------------------ | ---------------------------------------------------- |
| PR opened or updated by an author with write access    | deploys `pr-<n>` automatically                       |
| PR by anyone else, while it carries the `deploy` label | deploys `pr-<n>` after approval on `review-external` |
| PR closed                                              | destroys `pr-<n>` and drops its database             |
| nightly `sweep.yml`                                    | destroys slots other than `main` idle for 7 days     |
| `workflow_dispatch`                                    | any ref, PR or named slot, see below                 |

Trust follows the author, not the branch location. The resolve job asks GitHub for the
author's permission on this repository and treats `admin` and `write` (which includes the
maintain role) as trusted, so maintainers working from forks deploy automatically and the
same rule applies unchanged on any repository the workflow is moved to. Dependabot and
outside contributors take the label and approval path.

PR events use `pull_request_target`, so the workflow that reaches the runner is always the
base branch's copy and a PR cannot change what runs on the cluster. Each deploy comments the
slot URL on the PR.

The two environments are created with `deploy/setup-environments.sh <owner/repo> <reviewer>...`
where a reviewer is a user login or an `org/team-slug`. It needs repository admin.

Slot names come from `deploy/slot-name.sh`:

| Input                 | Slot              | URL                                  |
| --------------------- | ----------------- | ------------------------------------ |
| `pr=247`              | `pr-247`          | https://pr-247.tirtest.com           |
| `ref=main`            | `main`            | https://main.tirtest.com             |
| `ref=feat/api-tokens` | `feat-api-tokens` | https://feat-api-tokens.tirtest.com  |
| `name=demo`           | `demo`            | https://demo.tirtest.com             |

```
gh workflow run deploy.yml --ref deploy -f pr=247
gh workflow run deploy.yml --ref deploy -f ref=main
gh workflow run destroy.yml --ref deploy -f name=pr-247
```

`deploy.yml` builds the image on a GitHub-hosted runner and pushes it to
`ghcr.io/<owner>/tir`. Only the deploy job runs on the `tir-deploy` runner, and it never
checks out source: it renders `deploy/k8s/slot.yaml` with `deploy/render.sh` and applies it.
Deployments are pinned to the image digest, so any new build rolls.

## Isolation

`deploy/k8s/base` holds the namespace-level pieces, applied once with `kubectl apply -k`:

- `tir-review-db`, a CNPG cluster for review slots only. Slots read the app role's
  credentials from the secret CNPG generates, so no database password is managed by hand.
- A NetworkPolicy: slot pods accept traffic only from traefik and reach only the review
  database and DNS.
- A ResourceQuota and LimitRange for the namespace.
- The `tir-deployer` ServiceAccount and a Role limited to slot resources in namespace `tir`,
  used by the in-cluster runner.

Slot pods run as non-root with a read-only root filesystem, no capabilities and no service
account token. Writable paths are `/tmp` and `/src/tmp`, both emptyDir.

### Only through Cloudflare

Slots are meant to be reached only through Cloudflare. `edge-probe.yml` (Actions tab)
reports what an outside client gets from the origin directly and through Cloudflare, so
the restriction can be checked after any network change.

The `cloudflare-origin-pull` TLSOption in `deploy/k8s/base` is an optional second layer:
with Authenticated Origin Pulls enabled on the zone and the CA in Secret
`cloudflare-origin-pull-ca` (key `tls.ca`, from `cloudflare-origin-pull-ca.pem`), adding
`traefik.ingress.kubernetes.io/router.tls.options: tir-cloudflare-origin-pull@kubernetescrd`
to the slot Ingress makes traefik require Cloudflare's client certificate.

## Runner

The runner is an Actions Runner Controller scale set named `tir-deploy` in namespace
`arc-runners`, with `deploy/arc/values.yaml`. It needs a secret `arc-github` holding a
token with repository Administration read and write, then:

```
helm install arc --namespace arc-systems --create-namespace \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller
helm install tir-deploy --namespace arc-runners -f deploy/arc/values.yaml \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set
```

## Other one-time setup

- Secret `tir-env` in namespace `tir` with `SECRET_KEY`, `INIT_PASSWORD` and their `NUXT_`
  twins (`deploy/create-env-secret.sh path/to/.env` builds it). The built Nuxt server reads
  runtime config through `NUXT_*` while the boot migrator reads the plain names.
- A proxied wildcard DNS record `*.tirtest.com` in Cloudflare pointing at the same origin
  as the apex, and a traefik Cloudflare token that covers the zone.
- GitHub environments `review` (no rules) and `review-external` (required reviewer).

`deploy/Dockerfile` replaces the Iron Bank base with `node:22-slim`, compiles native modules
(libxmljs has no Node 22 prebuilt) in a throwaway build stage, and adds `npm ci`,
which the upstream Dockerfile leaves to the build context.
