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
- Tasks at the bottom lists the cluster's recent tasks. Click one to read its log. Tasks you start are followed until they end.

Charts show an hour, a day, a week, a month or a year.

## Guests

A guest has tabs:

- Summary: use, addresses (a VM needs the QEMU guest agent for these), uptime and charts.
- Hardware: Edit changes processors and memory. Add disk (or Add mount point on a container) makes a new disk; a disk's menu grows it, moves it to another storage, or detaches it. A detached disk stays as unused until you delete it. Network adapters are added, edited and removed here too. Changes Proxmox can't make while the guest runs are marked Pending and apply when it restarts from Proxmox.
- Options: name, tags, start on boot, protection, start order and notes, the QEMU guest agent for VMs and DNS for containers.
- Cloud-Init (VMs): user, password, SSH keys and network. Regenerate image writes them for the next boot. A VM without a cloud-init drive offers to add one.

## Storage

A storage has a tab for each kind of content it holds. ISO images and CT templates can be downloaded from a URL, with a checksum if you have one; CT templates also have Templates, the Proxmox catalog. The bin deletes a file. Backups and disk images are listed; restore comes with backups in a later release.

## Nodes

A node has tabs for Services (start, stop, restart, reload), Updates (refresh the package lists; install upgrades from the node's terminal), Disks (health and SMART) and Log. The power button reboots or shuts the node down after you type its name. If Termix runs on that node, it goes down too.

## Permissions

- View Proxmox: see nodes, guests, storage, charts and tasks.
- Operate Proxmox guests: power guests on and off.
- Configure Proxmox: create, clone, migrate, convert and delete guests, change their hardware and options, and manage storage content.
- Administer Proxmox: node services, log, reboot and shutdown, and later access and cluster management.

Anything beyond viewing also needs edit access to the Termix host. Every change is written to the audit log. Proxmox's own rights for the token or SSH user still apply on top.

## Troubleshooting

- Termix does not trust the node's certificate: with API directly, paste the node's CA from `/etc/pve/pve-root-ca.pem` into CA certificate, or pick API over SSH tunnel, which needs no CA.
- The API token was refused: check the token ID and secret. With Privilege Separation on, the token needs its own role, like PVEVMAdmin on `/`.
- pvesh was not found: the host is not a Proxmox node, or the SSH user can't run `pvesh`.
