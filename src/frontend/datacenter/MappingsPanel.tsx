import { useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Segmented } from "@termix-ssh/plugin-sdk/ui";
import { pve, type PveParams } from "../api";
import { CrudSection, type FieldSpec, type FormValues } from "./crud";
import { nodeNames, type DatacenterProps } from "./DatacenterView";
import {
  dirEntry,
  entriesByNode,
  pciEntry,
  pciLabel,
  usbEntry,
  usbLabel,
  usefulUsb,
  type MappingKind,
  type PciDevice,
  type UsbDevice,
} from "./mappings";

interface Mapping extends Record<string, unknown> {
  id: string;
  description?: string;
  map?: string[] | string;
  mdev?: number;
  "live-migration-capable"?: number;
}

const KINDS: MappingKind[] = ["pci", "usb", "dir"];

/** PCI, USB and directory mappings: one name for a device on each node. */
export function MappingsPanel({
  hostId,
  resources,
  isVisible,
}: DatacenterProps) {
  const { t } = useTranslation();
  const nodes = nodeNames(resources);
  const [kind, setKind] = useState<MappingKind>("pci");
  const [pci, setPci] = useState<Record<string, PciDevice[]>>({});
  const [usb, setUsb] = useState<Record<string, UsbDevice[]>>({});

  // What each node has, to pick from.
  useEffect(() => {
    if (!isVisible || kind === "dir") return;
    let cancelled = false;
    void Promise.all(
      nodes.map((node) =>
        pve<unknown[]>(hostId, "GET", ["nodes", node, "hardware", kind]).then(
          (list) => [node, list ?? []] as const,
          () => [node, []] as const,
        ),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      if (kind === "pci")
        setPci(Object.fromEntries(pairs) as Record<string, PciDevice[]>);
      else setUsb(Object.fromEntries(pairs) as Record<string, UsbDevice[]>);
    });
    return () => {
      cancelled = true;
    };
    // nodes is derived from resources each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, isVisible, kind, nodes.join()]);

  const nodeField = (node: string): FieldSpec => {
    const key = `node:${node}`;
    if (kind === "dir") {
      return {
        key,
        labelKey: "mappings.pathOn",
        labelValues: { node },
        local: true,
        placeholder: "/mnt/share",
      };
    }
    const options =
      kind === "pci"
        ? (pci[node] ?? []).map((d) => ({ value: d.id, label: pciLabel(d) }))
        : usefulUsb(usb[node] ?? null).map((d) => ({
            value: `${d.vendid}:${d.prodid}`,
            label: usbLabel(d),
          }));
    return {
      key,
      labelKey: "mappings.deviceOn",
      labelValues: { node },
      kind: "select",
      local: true,
      options,
    };
  };

  const fields: FieldSpec[] = [
    {
      key: "id",
      labelKey: "mappings.id",
      required: true,
      createOnly: true,
      pattern: /^[A-Za-z][A-Za-z0-9\-_.]*$/,
      patternKey: "crud.id",
    },
    { key: "description", labelKey: "mappings.description" },
    ...(kind === "pci"
      ? ([
          { key: "mdev", labelKey: "mappings.mdev", kind: "check" },
          {
            key: "live-migration-capable",
            labelKey: "mappings.liveMigration",
            kind: "check",
          },
        ] as FieldSpec[])
      : []),
    ...nodes.map(nodeField),
  ];

  const toParams = (values: FormValues, creating: boolean): PveParams => {
    const map: string[] = [];
    for (const node of nodes) {
      const picked = String(values[`node:${node}`] ?? "").trim();
      if (!picked) continue;
      if (kind === "dir") map.push(dirEntry(node, picked));
      else if (kind === "pci") {
        const d = (pci[node] ?? []).find((x) => x.id === picked);
        if (d) map.push(pciEntry(node, d));
      } else {
        const d = (usb[node] ?? []).find(
          (x) => `${x.vendid}:${x.prodid}` === picked,
        );
        if (d) map.push(usbEntry(node, d));
      }
    }
    const params: PveParams = {
      map,
      description: String(values.description ?? "").trim() || undefined,
    };
    if (creating) params.id = String(values.id);
    if (kind === "pci") {
      params.mdev = values.mdev === true ? 1 : 0;
      params["live-migration-capable"] =
        values["live-migration-capable"] === true ? 1 : 0;
    }
    if (!creating && !params.description) params.delete = "description";
    return params;
  };

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        className="self-start"
        value={kind}
        onChange={(v) => setKind(v as MappingKind)}
        options={KINDS.map((value) => ({
          value,
          label: t(`mappings.kinds.${value}`),
        }))}
      />
      <CrudSection<Mapping>
        key={kind}
        hostId={hostId}
        isVisible={isVisible}
        titleKey={`mappings.titles.${kind}`}
        hintKey="mappings.hint"
        emptyKey="mappings.none"
        listPath={["cluster", "mapping", kind]}
        rowId={(m) => m.id}
        view={(m) => {
          const byNode = entriesByNode(kind, m.map);
          return {
            title: m.id,
            detail: [
              m.description,
              Object.entries(byNode)
                .map(([node, dev]) => `${node}: ${dev}`)
                .join(", "),
            ]
              .filter(Boolean)
              .join(" · "),
            badges: m.mdev ? <Badge variant="outline">mdev</Badge> : null,
          };
        }}
        fields={fields}
        prepare={(row) => {
          const byNode = entriesByNode(kind, row.map);
          return {
            ...row,
            ...Object.fromEntries(
              Object.entries(byNode).map(([node, dev]) => [
                `node:${node}`,
                dev,
              ]),
            ),
          };
        }}
        createPath={["cluster", "mapping", kind]}
        itemPath={(m) => ["cluster", "mapping", kind, m.id]}
        loadItem
        toParams={toParams}
        createLabelKey="mappings.add"
        deleteText={(m) => ({
          title: t("mappings.deleteTitle", { id: m.id }),
          description: t("mappings.deleteDescription"),
        })}
      />
    </div>
  );
}
