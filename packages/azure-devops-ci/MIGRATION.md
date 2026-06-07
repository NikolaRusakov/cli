# Migration guide: pre-`@code-pushup/collect-plugin` data

The portal storage layer was moved from `@code-pushup/azure-devops-ci` to
[`@code-pushup/collect-plugin`](../collect-plugin#readme). As part of
the move, the `RunRecord` schema was generalized:

- `azProject` → `providerProject` (was always provider-agnostic; the new
  name reflects that).
- New `source: 'local' | 'ci'` discriminator.
- Storage tables gained a `provider_project` column and `source` column.
  Old `az_project` columns are still read for backward compatibility
  (see `rowToRunRecord`).

For the full migration guide (in-process helpers, per-backend SQL,
backward-compat matrix), see
[`packages/collect-plugin/MIGRATION.md`](../collect-plugin/MIGRATION.md).

## Why this is in the collect-plugin package

`@code-pushup/azure-devops-ci` now re-exports the storage layer from
`@code-pushup/collect-plugin` for backwards compatibility. All new
storage code, bug fixes, and tests live in
`@code-pushup/collect-plugin`. If you have a custom integration that
imports from `@code-pushup/azure-devops-ci`, switching to
`@code-pushup/collect-plugin` will keep your code working and ensure
you benefit from future updates.
