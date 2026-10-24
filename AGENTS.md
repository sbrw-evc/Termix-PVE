# AGENTS.md

This repo is a [Termix](https://github.com/Termix-SSH/Termix) plugin. These notes are for AI coding tools.

## Read first

Before changing anything, read `node_modules/@termix-ssh/plugin-sdk/PLUGIN-GUIDE.md`. It covers the
manifest, backend, database, frontend, UI, testing, releasing and submitting to the community registry,
and it matches the SDK version installed here. If it is missing, run `npm install`. If it is still missing,
the SDK is older than 1.0.6: run `npm install -D @termix-ssh/plugin-sdk@latest` or read
https://docs.termix.site/develop instead.

If the guide and the SDK's TypeScript types disagree, the types are right.

## First time setup

If `manifest.json` still has the id `hello-world`, this plugin was just made from the template. Ask the
user for the plugin's id, name and description, then:

1. In `manifest.json`, set `id`, `name`, `description`, `author`, `repository`, `docs`, `category`,
   `icon` and `features`. The id is lowercase with dashes and can't change after the first release.
2. Rename every `hello-world`, `hello_world` and `Hello World` to match: `package.json`,
   `locales/en.json`, the index name in `src/backend/tables.ts`, the API paths in `src/backend/routes.ts`,
   the tab id in `src/frontend/index.tsx`, the tests, `docs/index.md`, `CONTRIBUTING.md` and `README.md`.
3. Delete `migrations/` and run `npm run migrations` so the tables use the new id.
4. Replace the example notes feature with the real one, and fill in "About this plugin" below.

## Commands

```bash
npm run build        # bundle into dist/
npm test             # run the tests
npm run typecheck    # type check
npm run validate     # check manifest.json, migrations, changelog and docs
npm run migrations   # write migrations after changing src/backend/tables.ts
npm run pack         # write <id>-<version>.tmxplug
npm run format       # format with Prettier
```

`npx termix-plugin dev --server <url> --key <tmx_...>` installs the plugin on a Termix server with
developer mode on and reinstalls it on every save. Don't start it unless the user asks.

## Layouts and themes

A plugin can also be a layout (`contributes.layouts`, capability `ui:layout`, `app.registerLayout` in the
frontend, shell state from `useShell()`) or add themes (`contributes.themes`, capability `ui:theme`, one CSS
file per theme scoped under `.<id>`). A theme only plugin has no `src/`: just `manifest.json`, `themes/*.css`,
`locales/` and a test that runs `validateThemeCss()`. The guide's "Layouts and themes" section has the rules.

## Done means

- `npm test`, `npm run typecheck`, `npm run validate`, `npm run build` and `npm run format:check` pass
- `npx termix-plugin migrations --check` passes
- New UI text is in `locales/en.json`, new routes have an `@openapi` block and a test
- `docs/` and the section below still match what the plugin does
- User facing changes are in `CHANGELOG.md` under the version they ship in

## About this plugin

Keep this section current when the plugin changes: what it does, how it is put together, decisions that
aren't obvious from the code, and anything that has bitten you before.

- What it does: manages Proxmox VE nodes and clusters. A host becomes a Proxmox node through its
  `enablePve` host setting; the Proxmox tool in the rail's Tools band is hidden until one exists
  (`RailItemSync` in `src/frontend/index.tsx`, mounted in the `shell.overlay` slot).
- How it talks to Proxmox: `src/backend/pve/client.ts` has one `PveClient` over three transports (API
  over an SSH `forwardOut` tunnel, API through `ctx.fetch`, `pvesh` over SSH). Paths and params are
  the same for all three.
- The UI calls one route, `POST /hosts/:hostId/call`, with a method, path segments and params.
  `src/backend/pve/policy.ts` lists every allowed path with the permission it needs; anything else is
  refused. Add a rule there for every new Proxmox call, and keep reads at `view`.
- Changes need edit access to the Termix host and are audited as `pve_call`.
- Settings are declared in `manifest.json`, so core draws the host form. There are no tables.
- Bitten before: `EmptyState` shows `hint` and `action` only at guided verbosity, so error text goes in
  its own element. `DialogContent` needs `sm:max-w-*` to widen. `ctx.fetch` failures carry the TLS
  code in `cause`.
- Volume ids ("local:iso/x.iso") are one path segment. `pvePath` URL-encodes segments for the API and
  passes them raw to pvesh, which can't decode %2F.
- Guest config edits go through `setConfig` in `src/frontend/guests/useGuestConfig.ts`: empty values
  become `delete`, and the config's `digest` makes PVE refuse a change someone else beat us to.
  Property strings ("local-lvm:vm-1-disk-0,size=8G") are parsed in `guests/config.ts`.
- `/nodes/{node}/journal` returns its cursors as the first and last lines; `journalLines` drops them.
- Console (`src/backend/console.ts`, `ctx.ws.route("/console")`): VMs run `LC_PVE_TICKET=<pw> qm vncproxy`
  over SSH exec, which sets that ticket as the VNC password; noVNC is handed the open socket and the
  password. Containers run `pct enter` on a PTY, relayed to xterm.js as JSON frames. Non-root users go
  through `sudo -n env`. No console over API directly.
- Uploads (`src/backend/upload.ts`) stream the raw body over SSH `tee` into the path `pvesm path` gives,
  then `mv -n`: core parses only JSON and form bodies, so the route reads the request itself.
- Node network edits land in `interfaces.new`; PUT `nodes/{node}/network` applies, DELETE reverts.
  pvesh drops the `changes` attribute, so the UI tracks pending changes itself.
- Import detection (`src/backend/guest-probe.ts`): OS from `ostype` (old Windows types are w2k*, wxp, wvista,
  not win*), refined by `agent/get-osinfo`. Docker/Podman via one `sh -c` script of `pct exec` / `qm guest
exec` over SSH, local node only; each answer starts with `+` so a failed exec reads as unknown. RDP/VNC hosts
  set `remote-desktop` settings (`enableRdp`/`rdpPort`, `enableVnc`/`vncPort`) and their login in
  `protocolAuth`; Docker is `pluginEnable.docker` plus `containerRuntime`.
- Rules may list allowed parameters (`params` in `policy.ts`, checked by `paramsAllowed`): PUT
  `nodes/{node}/config` is open only for `acme`, `acmedomainN`, `digest` and a `delete` of those.
- Uploads: read the SSH channel (`resume()`) or it never emits `close` and the request hangs at 100%.
- Import (`src/backend/import.ts`): imported guests carry the hidden `pveSource` host setting; sync
  finds them with `listHostValues`. Scheduled sync runs every minute through `ctx.schedule` and
  `ctx.asUser` (users:impersonate) for nodes with `pveImportSync` on.
- Translations: `locales/translated/<file>.json` for the 41 languages of Termix-Registry's
  `translate/languages.json`, with each language's own plural keys (`Intl.PluralRules`), and
  `locales/translations-lock.json` hashing the English each was made from (the official translator's
  format). Add new strings to `en.json`; untranslated keys fall back to English.
- Roadmap: `ROADMAP.md`.
