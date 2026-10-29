# Toolchain

The examples use only Node built-in modules and pin Node 26.13.0 in `.node-version`. There are no package dependencies or install scripts.

The GitHub workflow pins the official checkout and setup-node actions to full commit hashes. The checked release labels were checkout v7.0.1 and setup-node v7.1.0. Workflow permissions are limited to reading repository content; the case runs need no secret.

Primary references:

- [Node release distributions](https://nodejs.org/dist/)
- [Node test runner documentation](https://nodejs.org/api/test.html)
- [Official checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
- [Official setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)

The checked-in receipts record their actual Node version and platform. Their timestamps and durations can differ on another machine; their required outcomes and source fingerprints should agree.
