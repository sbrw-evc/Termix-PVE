# Changelog

## 0.4.2

### Fixed

- A node's CPU shows its sockets as "Sockets: 1", which reads right in every language, instead of "1 × sockets"

## 0.4.1

### Fixed

- The datacenter summary no longer says creating and joining clusters stays in Proxmox; it points at Create cluster and Join cluster

## 0.4.0

### Added

- Datacenter Options: notes, keyboard, language, console viewer, e-mail from address, HTTP proxy, MAC prefix, workers, migration network, bandwidth limits, next free VMID range, HA shutdown policy
- SDN: zones, VNets and subnets, controllers, IPAM and DNS servers, with pending changes marked and Apply
- Metric servers: Graphite, InfluxDB and OpenTelemetry
- Resource mappings for PCI devices, USB devices and directories, with the device picked on each node
- Notifications: SMTP, sendmail, Gotify and webhook targets with Send a test, and matchers
- Create a cluster, or join one with its Join information
- Ceph setup: install in a terminal, initialize, monitors, managers, OSDs (create, in, out, scrub, destroy), pools, metadata servers and CephFS, and restart Ceph services
- Guests get Task History, Monitor (VMs), Replication and Permissions tabs
- Nodes get Replication and Subscription tabs
- Hosts that reach Proxmox through the API directly open Proxmox's own console page for guests and the Ceph installer

### Changed

- API calls can send list parameters, as Proxmox takes them for recipients, targets and mappings

## 0.3.2

### Changed

- Every Proxmox host shows in one tree, each under its own Datacenter row named after the host, instead of picking one at the top left; details, tasks and Import to Termix follow the selected row

## 0.3.1

### Fixed

- Restoring a container backup failed with "Parameter verification failed": the restore storage is now picked from the storages that hold this kind of disk, and a container needs one
- Move down on a firewall rule did nothing; it now moves the rule one step
- A form dialog lists Proxmox's errors for parameters it has no field for, instead of only "Parameter verification failed"
- Recovery keys ask which user first and say they replace the old ones, instead of making keys for the first user at once
- The datacenter summary says how many guests run, without the node count

## 0.3.0

### Added

- Datacenter view: click Datacenter in the tree for Summary, Storage, Backup, Replication, Permissions, HA and Firewall
- Cluster summary: quorum, nodes and the join information a new node pastes into Proxmox
- Proxmox Backup Server storage: add, edit and remove
- Backup jobs: schedule, guests (all, all except, listed or a pool), mode, compression, notes and retention, with Run now, and the guests no job includes
- Backup tab on guests: back up now, restore into a new guest or over the guest, notes, protection and delete
- Replication jobs with their last sync and errors, and Run now
- High availability: status, managed guests with Migrate to, and node and resource affinity rules
- Firewall for the datacenter, nodes and guests: options, rules with move up and down, security groups, aliases, IP sets and the log; turning the datacenter firewall on asks first
- Permissions: users, API tokens (the secret is shown once), two factor with TOTP and recovery keys, groups, pools and their members, roles, realms (LDAP, Active Directory, OpenID Connect) and permissions
- Ceph tab on nodes: health, monitors and pools, read only; says so when Ceph is not installed

### Changed

- The Now row of the snapshot list no longer shows Proxmox's untranslated "You are here!"
- The new screens are in English and Russian; other languages show them in English for now

## 0.2.15

### Added

- Snapshots tab on VMs and containers: take a snapshot (with RAM for a running VM), roll back, edit its description and delete, shown as a tree like in Proxmox
- Node Notes and Options in the System tab: notes, the delay before guests start on boot, and the Wake-on-LAN MAC
- The strings added in 0.2.13 and 0.2.14 are translated into every language

### Fixed

- Chart axis labels like 17.1 GiB were cut on the left: memory, swap and network axes use short forms like 17.1G

## 0.2.14

### Added

- The task list at the bottom collapses: click its heading. It stays collapsed next time, and shows how many tasks are running while folded

### Fixed

- Summary labels like Kernel no longer break in the middle of a word in Japanese, Chinese and Korean

## 0.2.13

### Changed

- Wipe is off for a disk in use (volume group, pool, mount or the system disk) until what is on it is removed
- Uptime is written in the interface language, and service states and guest states in the import list are translated

### Fixed

- Short labels and table headings no longer break in the middle of a word in Japanese, Chinese and Korean
- Russian: shorter view names so the search field fits, and wording fixes in the import dialog and the System tab

## 0.2.12

### Added

- The plugin speaks every language Termix ships: 41 translations next to English, with plural forms per language

### Changed

- Removing an LVM volume group that still has logical volumes, or an LVM-Thin pool that still holds data, is blocked until they are emptied

## 0.2.11

### Added

- Create LVM volume groups, LVM-Thin pools, directories and ZFS pools on unused disks, and remove them, optionally wiping their disks
- Initialize a disk with GPT, or wipe it after typing its path
- Upload a custom certificate for a node, or remove it
- ACME: register accounts, add DNS challenge plugins, set a node's domains, and order or renew its certificate

### Fixed

- Task history keeps its dates on one line and cuts long error texts

## 0.2.10

### Added

- Node System tab: DNS, time zone and /etc/hosts, with editing, and the node's certificates with their expiry
- Updates has Repositories: turn APT repositories on and off and add Proxmox's standard ones, with the warnings Proxmox gives
- Disks shows the LVM volume groups, LVM-Thin pools, directories and ZFS pools on the node's disks
- Node Tasks tab: the task history of the node, filtered by type, guest, user or failures, with each task's log

## 0.2.9

### Fixed

- Tab buttons keep their labels on one line and the row scrolls, instead of wrapping "Cloud-Init" inside its button
- The guest's ... menu is wide enough for Proxmox console on one line

## 0.2.8

### Fixed

- Node, guest and storage tabs scroll sideways instead of running past the edge in a narrow pane
- The per-guest connection picker in the import dialog is only as wide as it needs

## 0.2.7

### Changed

- The Console button opens the guest's own Termix host, in Termix's own terminal or remote desktop. A guest that is not in Termix yet gets an offer to add it, then opens
- Proxmox's own console (noVNC for VMs, a terminal for containers) moves to the guest's ... menu as Proxmox console, for guests with no network yet

## 0.2.6

### Changed

- A guest's console opens from a Console button in its header, in a new Termix tab of its own, and connects at once, as Proxmox opens its console window. The Console tab inside the guest is gone

## 0.2.5

### Added

- Import to Termix shows each guest's OS, from Proxmox's OS type or the QEMU guest agent, and picks RDP for Windows and SSH for the rest
- Pick SSH, RDP or VNC per guest before importing; RDP and VNC hosts get the Remote Desktop plugin's settings
- Sign imported guests in with one of your saved credentials, a username only, or no login, with separate logins for SSH and for RDP and VNC
- Import finds Docker and Podman in running guests on the node and turns on the Docker plugin with that runtime

### Fixed

- Uploads no longer stop at 100%: the file was written but never moved into place
- Older Windows VMs (2008, Vista, XP, 2003, 2000) are recognized as Windows

## 0.2.4

### Added

- Import to Termix picks the folder from your existing Termix folders, or creates a new one, with `/` for a subfolder

## 0.2.3

### Fixed

- Creating or editing a bridge with VLAN aware unchecked no longer turns it on: Proxmox reads the setting as on whenever it is sent, so off is now left out or cleared
- Bridge comments no longer gain an empty line each time they are saved
- Name and type are locked when editing a network interface

## 0.2.2

### Added

- Console tab on guests: noVNC for VMs, with Ctrl+Alt+Del, and a terminal for containers, through `qm vncproxy` and `pct enter` over SSH
- Upload ISO images and CT templates from the browser, with progress
- Node Network tab: create, edit and remove bridges, bonds and VLANs, then Apply or Revert
- Import to Termix: turn VMs and containers into Termix hosts, tagged proxmox, with their addresses, and keep them in sync on a schedule
- Charts: server load, swap, and CPU, memory and IO pressure stall, with Average or Maximum
- Folder view in the tree, by kind as in Proxmox: containers, VMs, nodes, pools, SDN and storage; Server view keeps the node layout
- Swap use on node and guest summaries, and a Shell button on nodes

### Changed

- The node log shows the newest lines first

## 0.2.1

### Fixed

- The node log loads over the SSH tunnel: Proxmox gzips that answer, and the tunnel now unpacks compressed answers
- A container's cores field is empty when it uses every core, instead of showing 1 and limiting it on save
- Growing, moving and adding disks close their dialog straight away; the task list follows the work
- Detaching a disk says it stays as an unused disk
- The template catalog has one Close button

## 0.2.0

### Added

- Guest tabs: Summary, Hardware, Options and, for VMs, Cloud-Init
- Hardware: processors and memory, add, grow, move and detach disks, delete unused disks, CD/DVD media, and add, edit and remove network adapters, with changes that wait for a restart marked Pending
- Options: name, tags, start on boot, protection, start order, notes, the QEMU guest agent and a container's DNS
- Cloud-Init: user, password, SSH keys, network and DNS, with Regenerate image, and a button to add the drive
- The addresses of a running guest in its summary
- Storage tabs for ISO images, CT templates, backups and disk images: download from a URL, the Proxmox template catalog, and delete
- Node tabs: services with start, stop, restart and reload, package updates with refresh, physical disks with SMART, and the log
- Reboot and shut down a node, after typing its name

## 0.1.3

### Changed

- Open in Proxmox moved from the host row to the host's right-click menu; Proxmox under Tools is the way in

## 0.1.2

### Fixed

- The details pane wraps to fit instead of running past the right edge in a narrow window
- Charts with nothing to show say so, and an all-zero byte axis no longer reads 1 B on every line
- Guest counts catch up right after a task ends

## 0.1.1

### Fixed

- API over SSH tunnel reaches the node instead of port 80 on the Termix server

## 0.1.0

### Added

- Mark a host as a Proxmox node in its settings; a Proxmox tool then shows under Tools
- Connect through the Proxmox API over SSH tunnel, straight to the API, or with pvesh over SSH
- The cluster's nodes, VMs, containers and storage in a tree
- Start, shut down, stop, reboot, suspend, resume and reset guests
- Create, clone, migrate, convert to template and delete VMs and containers
- CPU, memory, network and disk charts for nodes and guests
- Recent cluster tasks with their logs, and tasks you start followed until they end
- View, operate, configure and admin permissions, with every change audited
