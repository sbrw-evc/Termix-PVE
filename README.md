<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>Proxmox VE</h1>

<p>Manage Proxmox VE from Termix</p>

</div>

<br />

## Overview

A [Termix](https://github.com/Termix-SSH/Termix) plugin that manages Proxmox VE: virtual machines, containers, storage, network, backups, firewall, access and the cluster. Mark a host as a Proxmox node and a Proxmox tool shows under Tools in the sidebar.

It reaches the node through the Proxmox API over the host's SSH connection, straight to the API with a token, or with `pvesh` over SSH.

<br />

## Features

Done in 0.1.0:

- A Proxmox tool under Tools once a host is a Proxmox node
- The cluster's nodes, VMs, containers and storage in a tree
- Start, shut down, stop, reboot, suspend, resume and reset guests
- Create, clone, migrate, convert to template and delete VMs and containers
- CPU, memory, network and disk charts for nodes and guests, by hour, day, week, month or year
- Recent cluster tasks with their logs

Next: see [ROADMAP.md](ROADMAP.md).

<br />

## Install

Termix 26.10 or newer.

1. In Termix, open Settings, General and turn on Plugin developer mode.
2. Build the plugin: `npm install && npm run build && npm run pack`.
3. In Plugins, click Install from file and pick `pve-<version>.tmxplug`.

<br />

## License

Apache License 2.0
