# Security policy

How to report a vulnerability in lazylab, what is in scope, and where the security design is described.

## Supported versions

lazylab is pre-1.0. Fixes land on `develop` and are released from `main`; only the latest `main` is supported.

## Reporting a vulnerability

Open a **confidential issue** at [gitlab.com/sgkens/lazylab/-/issues/new](https://gitlab.com/sgkens/lazylab/-/issues/new) (tick "This issue is confidential"). Include:

- the lazylab commit or version, and how it runs (Bun or Docker, behind which proxy);
- what an attacker needs (network position, a session, an agent token) and what they gain;
- steps to reproduce, or a proof of concept that does not touch systems you do not own.

Never include real GitLab tokens, agent tokens, passwords or a `vault.json`.

You can expect an acknowledgement within a week. Please allow time for a fix before disclosing publicly.

## Scope

In scope:

- the vault: encryption, key handling, the password change and lock paths;
- sessions, sign-in throttling, origin and CSRF checks;
- agent tokens, the MCP endpoint and `/api/agent`, including the secret-access flag on `get_env`;
- anything that sends a GitLab token, a vault value or a masked CI variable somewhere it should not go;
- the `lazy` CLI's handling of its config file, `.env` files and temporary files.

Out of scope:

- attacks that need the admin password or an unrevoked agent token: they act as the owner by design;
- running lazylab on a network address over plain HTTP after the startup warning;
- denial of service against a single-user instance;
- vulnerabilities in GitLab itself.

## Design

The [Security model](docs/src/security.md) describes what is encrypted, how sessions and agent tokens work, and what is not covered. Hardening work that is planned but not done is tracked under `SEC-*` in [devtracker-pending.md](devtracker-pending.md).
