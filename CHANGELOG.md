# Changelog

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
