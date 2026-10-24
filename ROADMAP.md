# Roadmap

Each phase is a release, checked on a real node before it ships. Every new Proxmox path goes into
`src/backend/pve/policy.ts` with the permission it needs, and the UI reaches it through the
`/hosts/:hostId/call` proxy.

## 0.1: guests (done)

- Host flag and connection settings, Proxmox tool under Tools
- VMs and containers: power, create, clone, migrate, template, delete
- Charts for nodes and guests, tasks with logs

## 0.2: infrastructure

- Hardware of VMs and containers: CPU, memory, options, cloud-init
- Disks: add, resize, move, detach, delete (`configure`)
- Network adapters of guests; node networks and bridges with apply (`configure` / `administer`)
- CT templates and ISO images: list, download from URL, upload, delete
- Nodes: services, syslog, updates, disks, shutdown and reboot (`administer`)
- Console: noVNC for VMs, xterm.js for containers and node shells over the `/plugin-ws` proxy

## 0.3: data and safety

- Snapshots: take, roll back, delete
- Backups: run now, restore, jobs, retention, PBS storages
- Replication jobs
- Firewall: datacenter, node and guest rules, aliases, IP sets, security groups
- Cluster: status, join information, HA groups and resources

## 0.4: access

- Users, groups, roles, pools, 2FA, API tokens, realms (`administer`)

## Open questions

- Console traffic needs a WebSocket to the node. Over the SSH tunnel this works; with API directly the
  plugin opens `wss` itself, outside `ctx.fetch`.
- Volume ids contain `/` (`local:iso/debian.iso`). Paths that carry one as a segment need encoding per
  transport before storage content can be deleted.
