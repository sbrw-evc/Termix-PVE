# Roadmap

Each phase is a release, checked on a real node before it ships. Every new Proxmox path goes into
`src/backend/pve/policy.ts` with the permission it needs, and the UI reaches it through the
`/hosts/:hostId/call` proxy.

## 0.1: guests (done)

- Host flag and connection settings, Proxmox tool under Tools
- VMs and containers: power, create, clone, migrate, template, delete
- Charts for nodes and guests, tasks with logs

## 0.2: infrastructure (done)

- Hardware of VMs and containers: CPU, memory, options, cloud-init
- Disks: add, grow, move, detach, delete unused
- Network adapters of guests
- ISO images and CT templates: download from URL, template catalog, delete
- Nodes: services, updates, disks with SMART, log, reboot and shutdown

## 0.2.x: console and the rest of 0.2 (done in 0.2.2)

- Console: noVNC for VMs, xterm.js for containers and node shells over the `/plugin-ws` proxy
- Upload ISO images and templates from the browser
- Node network: bridges, bonds, VLANs, with apply
- Import guests as Termix hosts, with sync

## Node menu (done in 0.2.10)

- System: DNS, Hosts, Time, Certificates
- Updates: Repositories
- Disks: LVM, LVM-Thin, Directory, ZFS
- Task History per node
- 0.2.11: creating and removing LVM, LVM-Thin, directory and ZFS storage, wiping disks, custom
  certificates and ACME (accounts, DNS plugins, domains, order and renew)

- 0.2.15: node Notes and Options (start on boot delay, Wake-on-LAN)

Ceph is shown read only since 0.3.0.

## 0.3: data and safety, and access (done in 0.3.0)

- Snapshots: take, roll back, delete (0.2.15)
- Backups: back up now, restore, jobs, retention, Proxmox Backup Server storage
- Replication jobs
- Firewall: datacenter, node and guest rules, options, aliases, IP sets, security groups
- Cluster: status, join information, HA resources and rules
- Access: users, groups, roles, pools, 2FA, API tokens, realms, permissions (`administer`)
- Ceph: health, monitors and pools per node, read only

## Later

- Ceph setup: install, monitors, OSDs, pools
- Creating and joining clusters (needs a root password, so it stays in Proxmox for now)
- SDN, metric servers, notifications and resource mappings
- The console over API directly

## Open questions

- The console runs `qm vncproxy` / `pct enter` over SSH, so it needs an SSH transport and a user that
  is root or has passwordless sudo. API directly has no console yet.
