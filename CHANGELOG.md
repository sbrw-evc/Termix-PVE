# Changelog

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
