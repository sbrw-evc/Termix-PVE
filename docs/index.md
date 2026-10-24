Proxmox VE manages Proxmox nodes and clusters from Termix: virtual machines and containers with their hardware and options, storage content, and the nodes themselves, with charts and tasks. Backups, snapshots, firewall, access and the cluster come in later releases.

## Add a node

1. Add the Proxmox node as a normal SSH host, or open one you have.
2. In the host's settings, open SSH, find Proxmox node and turn it on.
3. Pick how Termix reaches the node under Connect through:
   - Automatic: the API over an SSH tunnel once an API token is saved, pvesh over SSH until then.
   - API over SSH tunnel: the API on port 8006 of the node, reached through the host's SSH connection. The API does not need to be open to the network, and no CA is needed.
   - API directly: Termix calls the API without SSH. Set API address if it is not the host's address, and paste the node's CA from `/etc/pve/pve-root-ca.pem` into CA certificate.
   - pvesh over SSH: no token. The SSH user must be root or have sudo.
4. For the API, make a token in Proxmox under Datacenter, Permissions, API Tokens, and enter its API token ID (like `root@pam!termix`) and API token secret.
5. Save.

Proxmox now shows under Tools in the sidebar. It stays hidden until at least one host is a Proxmox node.

## Use it

Open Proxmox from Tools, or right-click a node in the host list and pick Open in Proxmox. With more than one node, pick which one at the top left.

- The tree lists every node in the cluster with its VMs, containers and storage. Search filters it.
- A node shows its use, version and charts, and has Create VM and Create CT.
- A guest shows its use and charts, with buttons for what its state allows: Start, Shut down, Reboot, Suspend, Resume, Stop and Reset. Stop and Reset ask first, because they cut the power.
- More on a guest has Clone, Migrate, Convert to template and Delete. Delete asks you to type the guest's ID.
- Tasks at the bottom lists the cluster's recent tasks. Click its heading to fold it away; it remembers that. Click one to read its log. Tasks you start are followed until they end.

Charts show an hour, a day, a week, a month or a year, as averages or maximums. Nodes also chart server load, swap and pressure stall (CPU, memory, IO) on PVE 9.

The tree has two views: Folder lists everything by kind, like Proxmox's Folder View; Server groups guests and storage under their node.

## Import to Termix

Import to Termix at the top lists every VM and container with the address Proxmox knows: a static one from its config, or, while it runs, the container's interfaces or the QEMU guest agent. Pick guests and they become Termix hosts in a folder named after the node, or in a folder you pick from your existing ones or create, with `/` for a subfolder. They are tagged `proxmox`, the type, the node and the ID, and go through the node's jump hosts.

Each guest shows its OS, from its Proxmox OS type or, for a running VM with the guest agent, what the agent reports. Windows guests start out on RDP and the rest on SSH; pick SSH, RDP or VNC per guest before importing. RDP and VNC hosts need the Remote Desktop plugin to connect.

SSH guests can sign in like the node, with one of your saved credentials, with a username only, or not at all. RDP and VNC guests have a login of their own, chosen the same way.

Running guests on the node Termix connects to are asked whether Docker or Podman is installed, with `pct exec` for containers and `qm guest exec` for VMs with the guest agent. When one is found, the new SSH host gets the Docker plugin turned on with that runtime and a `docker` or `podman` tag. Guests on other cluster nodes are not asked.

Importing again refreshes the names, addresses and tags of guests added before, and tags the ones removed from Proxmox as `proxmox-missing`. In the host's Proxmox settings, Keep imported guests in sync does this on a schedule, and Add new guests on sync imports new guests with the last defaults. Only the node's owner can import.

## Guests

A guest has tabs:

- Summary: use, addresses (a VM needs the QEMU guest agent for these), uptime and charts.
- Hardware: Edit changes processors and memory. Add disk (or Add mount point on a container) makes a new disk; a disk's menu grows it, moves it to another storage, or detaches it. A detached disk stays as unused until you delete it. Network adapters are added, edited and removed here too. Changes Proxmox can't make while the guest runs are marked Pending and apply when it restarts from Proxmox.
- Options: name, tags, start on boot, protection, start order and notes, the QEMU guest agent for VMs and DNS for containers.
- Console: the Console button next to a running guest's power buttons opens the guest's own Termix host, as clicking it in the host list does: its terminal, or the remote desktop it was imported with. A guest that is not a Termix host yet gets an offer to add it, and Console then connects to the new host.
- Proxmox console, in the guest's ... menu, opens Proxmox's own console through the node in a new tab, for a guest with no network yet: a VM's screen through noVNC, with Ctrl+Alt+Del, or a container's terminal. It runs over SSH, so it needs an SSH transport and a root user or one with passwordless sudo, and the Console permission.
- Cloud-Init (VMs): user, password, SSH keys and network. Regenerate image writes them for the next boot. A VM without a cloud-init drive offers to add one.

## Storage

A storage has a tab for each kind of content it holds. ISO images and CT templates can be uploaded from your computer (over SSH) or downloaded from a URL, with a checksum if you have one; CT templates also have Templates, the Proxmox catalog. The bin deletes a file. Backups and disk images are listed; restore comes with backups in a later release.

## Nodes

A node has tabs for Network, System, Services (start, stop, restart, reload), Updates, Disks, Tasks and Log, in the order of Proxmox's node menu.

System shows and edits the node's DNS (search domain and up to three servers), its time zone and `/etc/hosts`, lists its certificates with their expiry, uploads a custom certificate (chain and key as PEM, pasted or read from a file) or removes it, and sets up ACME: register accounts, add DNS challenge plugins, pick the node's account and domains (HTTP or DNS challenge, up to six), then order or renew the certificate. ACME accounts and plugins need the Administer permission. Updates has Packages (refresh the package lists; install upgrades from the node's terminal) and Repositories (turn APT repositories on and off, add Proxmox's standard ones). Disks has the disks with health and SMART, Initialize GPT and Wipe (after typing the disk's path), and the LVM volume groups, LVM-Thin pools, directories and ZFS pools on them. Create makes one on unused disks (ZFS with its RAID level, compression and ashift) and can add it as storage; Remove takes it away, optionally with its storage entry and wiping its disks, after typing its name. Tasks is the node's task history, filtered by type, guest, user or failures, with each task's log.

Network lists the node's interfaces. Create makes a bridge, bond or VLAN; an interface's menu edits or removes it. Changes wait in `/etc/network/interfaces.new` until Apply, which reloads the node's network, or Revert, which drops them. Termix warns before you change the interface it reaches the node on. Shell opens the node's terminal. The power button reboots or shuts the node down after you type its name. If Termix runs on that node, it goes down too.

## Permissions

- View Proxmox: see nodes, guests, storage, charts and tasks.
- Operate Proxmox guests: power guests on and off.
- Open Proxmox consoles: VM and container consoles.
- Configure Proxmox: create, clone, migrate, convert and delete guests, change their hardware and options, and manage storage content, including uploads.
- Administer Proxmox: node network, services, log, reboot and shutdown, and later access and cluster management.

Anything beyond viewing also needs edit access to the Termix host. Every change is written to the audit log. Proxmox's own rights for the token or SSH user still apply on top.

## Troubleshooting

- Termix does not trust the node's certificate: with API directly, paste the node's CA from `/etc/pve/pve-root-ca.pem` into CA certificate, or pick API over SSH tunnel, which needs no CA.
- The API token was refused: check the token ID and secret. With Privilege Separation on, the token needs its own role, like PVEVMAdmin on `/`.
- pvesh was not found: the host is not a Proxmox node, or the SSH user can't run `pvesh`.
