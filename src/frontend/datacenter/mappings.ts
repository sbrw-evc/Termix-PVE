import { composeProps, parseProps } from "./options";

export type MappingKind = "pci" | "usb" | "dir";

/** One device of GET /nodes/{node}/hardware/pci. */
export interface PciDevice {
  id: string;
  vendor: string;
  device: string;
  vendor_name?: string;
  device_name?: string;
  subsystem_vendor?: string;
  subsystem_device?: string;
  iommugroup?: number;
}

/** One device of GET /nodes/{node}/hardware/usb. */
export interface UsbDevice {
  busnum: number;
  port: number;
  level?: number;
  usbpath?: string;
  vendid: string;
  prodid: string;
  product?: string;
  manufacturer?: string;
  class?: number;
}

const hex = (v: string) => v.replace(/^0x/i, "");

/** What a mapping entry stores for a PCI device on a node. */
export function pciEntry(node: string, d: PciDevice): string {
  const sub =
    d.subsystem_vendor && d.subsystem_device
      ? `${hex(d.subsystem_vendor)}:${hex(d.subsystem_device)}`
      : undefined;
  return composeProps({
    node,
    path: d.id,
    id: `${hex(d.vendor)}:${hex(d.device)}`,
    "subsystem-id": sub,
    iommugroup:
      d.iommugroup !== undefined && d.iommugroup >= 0
        ? String(d.iommugroup)
        : undefined,
  })!;
}

/** USB is mapped by vendor and product id, so it follows the device between ports. */
export function usbEntry(node: string, d: UsbDevice): string {
  return composeProps({ node, id: `${d.vendid}:${d.prodid}` })!;
}

export function dirEntry(node: string, path: string): string {
  return composeProps({ node, path: path.trim() })!;
}

/**
 * The devices a mapping picks per node: the PCI path, the USB vendor:product,
 * or the directory path — whatever the form's per-node field holds.
 */
export function entriesByNode(
  kind: MappingKind,
  map: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  const list = Array.isArray(map) ? map : map ? [map] : [];
  for (const raw of list) {
    const e = parseProps(raw);
    if (!e.node) continue;
    out[e.node] = kind === "usb" ? (e.id ?? e.path ?? "") : (e.path ?? "");
  }
  return out;
}

/** Hardware labels for pickers. */
export function pciLabel(d: PciDevice): string {
  return [d.id, d.vendor_name, d.device_name].filter(Boolean).join(" · ");
}

export function usbLabel(d: UsbDevice): string {
  return [`${d.vendid}:${d.prodid}`, d.manufacturer, d.product]
    .filter(Boolean)
    .join(" · ");
}

/** USB hubs and root hubs are class 9; they are not worth passing through. */
export function usefulUsb(devices: UsbDevice[] | null): UsbDevice[] {
  return (devices ?? []).filter((d) => d.class !== 9);
}

const MAPPING_ID = /^[A-Za-z][A-Za-z0-9\-_.]*$/;
export const mappingIdOk = (id: string) => MAPPING_ID.test(id);
