# Changelog

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
