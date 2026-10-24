# Sports Betting Master consolidation

This repository is the public master for eight sports-research projects. It contains a runnable shared workspace and filtered, revision-pinned source snapshots; it does not blindly start every upstream service.

## Runtime and source layout

| Project | Active integration | Preserved source |
| --- | --- | --- |
| EdgeFusion | Root Node gateway, Python market board, imports, movement history and manual journal | `sources/EdgeFusion/` |
| EdgeBoard | Latest research release in `apps/edgeboard/`, using the independent runtime rather than AppDeploy | `sources/EdgeBoard/` |
| edgeboard-appdeploy | Prior export preserved for comparison; not allowed to overwrite newer EdgeBoard modules | `sources/edgeboard-appdeploy/` |
| SportsBettingApp | `edgeodds/`, research controls, normalized quotes and versioned import contract | `sources/SportsBettingApp/` |
| sports-odds-api-python | Optional server-side SportsGameOdds SDK, installed from this checkout | `sources/sports-odds-api-python/` |
| OddsHarvester | Supported JSON exports import through `integrations/adapters.py`; scraper is not started | `sources/OddsHarvester/` |
| live-odds-tracker | Snapshot import and significant movement detection | `sources/live-odds-tracker/` |
| alexbet-sharp-bot | Existing odds calculator and The Odds API import; bot/billing remain inactive | `sources/alexbet-sharp-bot/` |

The runtime started from EdgeFusion revision `91b84cd7b6e17c626c10940845a8bbaca5d89a10`. Its EdgeBoard source trees were refreshed to revision `52725b6c09c449e1131412fb3906ff6e1a65a720`, preserving the independent-model workspace, route persistence, model audit improvements, and server-controlled provider-request guards. SDK/client imports point to `runtime/`; migration configuration and SQLite persistence are retained.

The master workspace is available at `/`, and EdgeBoard at `/edgeboard/`. Source snapshots are not npm workspaces, do not execute during the root build, and do not provide blanket compatibility guarantees for running each upstream product separately.

## Provenance and reproducibility

`docs/consolidation-manifest.json` records all eight repository URLs, exact commits, included file sizes and SHA-256 hashes, and every excluded path with a reason. Run `npm run verify:sources` to detect missing files, changed snapshots, unmanifested additions and accidental restoration of excluded files.

Original repository histories were not imported, avoiding publication of historical deleted credentials. Original repositories, branches, live deployments and databases were not modified.

## Public-release security

The user authorized a public destination after being informed that three source repositories were private. Before publication, the source working trees were scanned with Gitleaks 8.30.1; flagged configuration and deployment-script files were omitted, including one conservatively excluded test file. HAR browser-session captures, ZIP archives, runtime logs and non-example environment files were also omitted.

An automated scan is not proof that no secret exists. Credentials found in an upstream public repository should be treated as potentially compromised and rotated by their owner; this consolidation does not revoke them or clean the source repository's history.

Provider keys belong in server-side environment variables. No API key, private database or AppDeploy secret is migrated. Do not enable bot delivery, billing, scrapers, paid provider calls or automated execution merely because their source appears in this repository.

## Licensing

Upstream license files and notices are preserved in their source directories. The SDK retains Apache-2.0; OddsHarvester and Live Odds Tracker retain their MIT notices. AlexBET declares MIT in its package metadata but supplies no standalone license file in the reviewed snapshot; its metadata and existing converter notice are retained without inventing a copyright grant.

No blanket license is asserted over the user-owned applications or the combined repository. Public visibility does not by itself grant redistribution rights. Review each component's notices before redistributing or offering it as a service.

## Boundaries

This is research software and manual recordkeeping, not an automated betting service. Provider-backed features require their own valid access, permitted use and network verification; no live provider connection or profitable-model claim is established by this merge. AppDeploy private records were not exported or imported.
