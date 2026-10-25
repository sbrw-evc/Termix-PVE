import { useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Button, Segmented } from "@termix-ssh/plugin-sdk/ui";
import { Check } from "lucide-react";
import { pve, toCallError, type PveParams } from "../api";
import { useTasks } from "../tasks";
import {
  CrudSection,
  paramsFrom,
  type FieldSpec,
  type FormValues,
} from "./crud";
import { nodeNames, type DatacenterProps } from "./DatacenterView";

type SdnView = "zones" | "vnets" | "controllers" | "ipams" | "dns";
const VIEWS: SdnView[] = ["zones", "vnets", "controllers", "ipams", "dns"];

/** An SDN object read with pending=1: `state` says what Apply will do to it. */
interface SdnRow extends Record<string, unknown> {
  type?: string;
  state?: "new" | "changed" | "deleted";
  pending?: Record<string, unknown>;
}

const SDN_ID = /^[A-Za-z][A-Za-z0-9]*[A-Za-z0-9]$/;
const CIDR = /^[0-9a-fA-F:.]+\/\d{1,3}$/;
const is =
  (...types: string[]) =>
  (v: FormValues) =>
    types.includes(String(v.type));

/** Pending values show over the running ones, as Proxmox's SDN view does. */
export function withPending(row: Record<string, unknown>) {
  return { ...row, ...((row.pending as Record<string, unknown>) ?? {}) };
}

function StateBadge({ state }: { state?: string }) {
  const { t } = useTranslation();
  if (!state) return null;
  return (
    <Badge variant={state === "deleted" ? "destructive" : "outline"}>
      {t(`sdn.state.${state}`)}
    </Badge>
  );
}

export function SdnPanel({ hostId, resources, isVisible }: DatacenterProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const [view, setView] = useState<SdnView>("zones");
  const [zones, setZones] = useState<SdnRow[]>([]);
  const [controllers, setControllers] = useState<SdnRow[]>([]);
  const [ipams, setIpams] = useState<SdnRow[]>([]);
  const [dnsList, setDnsList] = useState<SdnRow[]>([]);
  const [vnet, setVnet] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const nodes = nodeNames(resources);
  const ids = (rows: SdnRow[], key: string) =>
    rows.map((r) => ({ value: String(r[key]) }));

  const apply = async () => {
    setApplying(true);
    try {
      const upid = await pve(hostId, "PUT", ["cluster", "sdn"]);
      await track(upid, t("sdn.applyLabel"));
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setApplying(false);
    }
  };

  const zoneFields: FieldSpec[] = [
    {
      key: "zone",
      labelKey: "sdn.zone",
      required: true,
      createOnly: true,
      pattern: SDN_ID,
      patternKey: "sdn.idFormat",
    },
    {
      key: "type",
      labelKey: "sdn.type",
      kind: "select",
      required: true,
      createOnly: true,
      default: "simple",
      options: ["simple", "vlan", "qinq", "vxlan", "evpn"].map((value) => ({
        value,
        labelKey: `sdn.zoneTypes.${value}`,
      })),
    },
    {
      key: "bridge",
      labelKey: "sdn.bridge",
      showIf: is("vlan", "qinq"),
      required: true,
      placeholder: "vmbr0",
    },
    {
      key: "tag",
      labelKey: "sdn.serviceVlan",
      kind: "number",
      showIf: is("qinq"),
    },
    {
      key: "vlan-protocol",
      labelKey: "sdn.vlanProtocol",
      kind: "select",
      showIf: is("qinq"),
      options: [{ value: "802.1q" }, { value: "802.1ad" }],
    },
    {
      key: "peers",
      labelKey: "sdn.peers",
      hintKey: "sdn.peersHint",
      showIf: is("vxlan"),
      required: true,
    },
    {
      key: "vxlan-port",
      labelKey: "sdn.vxlanPort",
      kind: "number",
      showIf: is("vxlan"),
      placeholder: "4789",
    },
    {
      key: "controller",
      labelKey: "sdn.controller",
      kind: "select",
      showIf: is("evpn"),
      required: true,
      options: ids(controllers, "controller"),
    },
    {
      key: "vrf-vxlan",
      labelKey: "sdn.vrfVxlan",
      kind: "number",
      showIf: is("evpn"),
      required: true,
    },
    { key: "mac", labelKey: "sdn.mac", showIf: is("evpn") },
    {
      key: "exitnodes",
      labelKey: "sdn.exitNodes",
      hintKey: "sdn.nodesHint",
      showIf: is("evpn"),
    },
    {
      key: "exitnodes-primary",
      labelKey: "sdn.exitPrimary",
      showIf: is("evpn"),
    },
    {
      key: "exitnodes-local-routing",
      labelKey: "sdn.exitLocal",
      kind: "check",
      showIf: is("evpn"),
    },
    {
      key: "advertise-subnets",
      labelKey: "sdn.advertise",
      kind: "check",
      showIf: is("evpn"),
    },
    {
      key: "disable-arp-nd-suppression",
      labelKey: "sdn.noArpSuppression",
      kind: "check",
      showIf: is("evpn"),
    },
    {
      key: "dhcp",
      labelKey: "sdn.dhcp",
      kind: "select",
      showIf: is("simple"),
      options: [{ value: "dnsmasq", label: "dnsmasq" }],
    },
    {
      key: "nodes",
      labelKey: "sdn.nodes",
      hintKey: "sdn.nodesHint",
      placeholder: nodes.join(","),
    },
    { key: "mtu", labelKey: "sdn.mtu", kind: "number" },
    {
      key: "ipam",
      labelKey: "sdn.ipam",
      kind: "select",
      options: ids(ipams, "ipam"),
    },
    {
      key: "dns",
      labelKey: "sdn.dns",
      kind: "select",
      options: ids(dnsList, "dns"),
    },
    {
      key: "reversedns",
      labelKey: "sdn.reverseDns",
      kind: "select",
      options: ids(dnsList, "dns"),
    },
    { key: "dnszone", labelKey: "sdn.dnsZone" },
  ];

  const vnetFields: FieldSpec[] = [
    {
      key: "vnet",
      labelKey: "sdn.vnet",
      required: true,
      createOnly: true,
      pattern: SDN_ID,
      patternKey: "sdn.idFormat",
    },
    {
      key: "zone",
      labelKey: "sdn.zone",
      kind: "select",
      required: true,
      options: ids(zones, "zone"),
    },
    { key: "alias", labelKey: "sdn.alias" },
    { key: "tag", labelKey: "sdn.tag", kind: "number", hintKey: "sdn.tagHint" },
    { key: "vlanaware", labelKey: "sdn.vlanAware", kind: "check" },
    { key: "isolate-ports", labelKey: "sdn.isolatePorts", kind: "check" },
  ];

  const subnetFields: FieldSpec[] = [
    {
      key: "subnet",
      labelKey: "sdn.subnet",
      required: true,
      createOnly: true,
      pattern: CIDR,
      patternKey: "sdn.cidrFormat",
      placeholder: "10.10.0.0/24",
    },
    { key: "gateway", labelKey: "sdn.gateway", placeholder: "10.10.0.1" },
    { key: "snat", labelKey: "sdn.snat", kind: "check" },
    { key: "dnszoneprefix", labelKey: "sdn.dnsPrefix" },
    {
      key: "dhcp-range",
      labelKey: "sdn.dhcpRange",
      hintKey: "sdn.dhcpRangeHint",
      kind: "textarea",
      local: true,
    },
    { key: "dhcp-dns-server", labelKey: "sdn.dhcpDns" },
  ];

  const controllerFields: FieldSpec[] = [
    {
      key: "controller",
      labelKey: "sdn.controller",
      required: true,
      createOnly: true,
      pattern: /^[A-Za-z][A-Za-z0-9_-]*[A-Za-z0-9]$/,
      patternKey: "sdn.idFormat",
    },
    {
      key: "type",
      labelKey: "sdn.type",
      kind: "select",
      required: true,
      createOnly: true,
      default: "evpn",
      options: [{ value: "evpn" }, { value: "bgp" }, { value: "isis" }],
    },
    {
      key: "asn",
      labelKey: "sdn.asn",
      kind: "number",
      showIf: is("evpn", "bgp"),
      required: true,
    },
    {
      key: "peers",
      labelKey: "sdn.peers",
      hintKey: "sdn.peersHint",
      showIf: is("evpn", "bgp"),
    },
    {
      key: "node",
      labelKey: "sdn.node",
      kind: "select",
      showIf: is("bgp", "isis"),
      required: true,
      options: nodes.map((value) => ({ value })),
    },
    { key: "ebgp", labelKey: "sdn.ebgp", kind: "check", showIf: is("bgp") },
    { key: "loopback", labelKey: "sdn.loopback", showIf: is("bgp", "isis") },
    {
      key: "isis-domain",
      labelKey: "sdn.isisDomain",
      showIf: is("isis"),
      required: true,
    },
    {
      key: "isis-ifaces",
      labelKey: "sdn.isisIfaces",
      showIf: is("isis"),
      required: true,
    },
    {
      key: "isis-net",
      labelKey: "sdn.isisNet",
      showIf: is("isis"),
      required: true,
    },
  ];

  const ipamFields: FieldSpec[] = [
    {
      key: "ipam",
      labelKey: "sdn.ipam",
      required: true,
      createOnly: true,
      pattern: SDN_ID,
      patternKey: "sdn.idFormat",
    },
    {
      key: "type",
      labelKey: "sdn.type",
      kind: "select",
      required: true,
      createOnly: true,
      default: "netbox",
      options: [
        { value: "netbox", label: "NetBox" },
        { value: "phpipam", label: "phpIPAM" },
        { value: "pve", label: "PVE" },
      ],
    },
    {
      key: "url",
      labelKey: "sdn.url",
      showIf: is("netbox", "phpipam"),
      required: true,
    },
    {
      key: "token",
      labelKey: "sdn.token",
      hintKey: "sdn.secretHint",
      kind: "password",
      local: true,
      showIf: is("netbox", "phpipam"),
    },
    {
      key: "section",
      labelKey: "sdn.section",
      kind: "number",
      showIf: is("phpipam"),
      required: true,
    },
  ];

  const dnsFields: FieldSpec[] = [
    {
      key: "dns",
      labelKey: "sdn.dns",
      required: true,
      createOnly: true,
      pattern: SDN_ID,
      patternKey: "sdn.idFormat",
    },
    {
      key: "type",
      labelKey: "sdn.type",
      kind: "select",
      required: true,
      createOnly: true,
      default: "powerdns",
      options: [{ value: "powerdns", label: "PowerDNS" }],
    },
    { key: "url", labelKey: "sdn.url", required: true },
    {
      key: "key",
      labelKey: "sdn.apiKey",
      hintKey: "sdn.secretHint",
      kind: "password",
      local: true,
    },
    { key: "ttl", labelKey: "sdn.ttl", kind: "number" },
    { key: "reversemaskv6", labelKey: "sdn.reverseMask", kind: "number" },
  ];

  /** Params with a typed secret only; lists split into arrays. */
  const withSecret =
    (fields: FieldSpec[], secret?: string) =>
    (values: FormValues, creating: boolean): PveParams => {
      const params = paramsFrom(fields, values, creating);
      if (secret) {
        const value = String(values[secret] ?? "").trim();
        if (value) params[secret] = value;
      }
      return params;
    };

  const subnetParams = (values: FormValues, creating: boolean): PveParams => {
    const params = paramsFrom(subnetFields, values, creating);
    params.type = "subnet";
    const ranges = String(values["dhcp-range"] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [start, end] = l.split(/\s*-\s*|\s+/);
        return `start-address=${start},end-address=${end}`;
      });
    if (ranges.length) params["dhcp-range"] = ranges;
    else if (!creating)
      params.delete = [String(params.delete ?? ""), "dhcp-range"]
        .filter(Boolean)
        .join(",");
    return params;
  };

  const common = {
    hostId,
    isVisible,
    listParams: { pending: 1 } as PveParams,
    loadItem: true,
    prepare: withPending,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          className="max-w-full overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap"
          value={view}
          onChange={(v) => setView(v as SdnView)}
          options={VIEWS.map((value) => ({
            value,
            label: t(`sdn.views.${value}`),
          }))}
        />
        <span className="flex-1" />
        <Button size="sm" disabled={applying} onClick={() => void apply()}>
          <Check className="mr-1 size-3.5" />
          {t("sdn.apply")}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("sdn.applyHint")}</p>

      {/* The lists the selects pick from load with their own sections. */}
      {view === "zones" && (
        <CrudSection<SdnRow>
          {...common}
          titleKey="sdn.views.zones"
          emptyKey="sdn.none"
          listPath={["cluster", "sdn", "zones"]}
          onLoaded={setZones}
          rowId={(z) => String(z.zone)}
          view={(z) => ({
            title: String(z.zone),
            detail: [z.bridge, z.peers, z.nodes].filter(Boolean).join(" · "),
            badges: (
              <>
                <Badge variant="outline">{String(z.type ?? "")}</Badge>
                <StateBadge state={z.state} />
              </>
            ),
          })}
          fields={zoneFields}
          createPath={["cluster", "sdn", "zones"]}
          itemPath={(z) => ["cluster", "sdn", "zones", String(z.zone)]}
          toParams={(v, c) => paramsFrom(zoneFields, v, c)}
          createLabelKey="sdn.addZone"
        />
      )}
      {view === "vnets" && (
        <>
          <CrudSection<SdnRow>
            {...common}
            titleKey="sdn.views.vnets"
            hintKey="sdn.vnetsHint"
            emptyKey="sdn.none"
            listPath={["cluster", "sdn", "vnets"]}
            rowId={(n) => String(n.vnet)}
            view={(n) => ({
              title: (
                <button
                  type="button"
                  className="text-left underline-offset-2 hover:underline"
                  onClick={() => setVnet(String(n.vnet))}
                >
                  {String(n.vnet)}
                </button>
              ),
              detail: [
                t("sdn.inZone", { zone: n.zone }),
                n.tag ? `tag ${n.tag}` : null,
                n.alias,
              ]
                .filter(Boolean)
                .join(" · "),
              badges: <StateBadge state={n.state} />,
            })}
            fields={vnetFields}
            createPath={["cluster", "sdn", "vnets"]}
            itemPath={(n) => ["cluster", "sdn", "vnets", String(n.vnet)]}
            toParams={(v, c) => ({
              ...paramsFrom(vnetFields, v, c),
              ...(c ? { type: "vnet" } : {}),
            })}
            createLabelKey="sdn.addVnet"
          />
          {/* Zones feed the VNet zone picker. */}
          <ZonesLoader
            hostId={hostId}
            isVisible={isVisible}
            onLoaded={setZones}
          />
          {vnet && (
            <CrudSection<SdnRow>
              key={vnet}
              {...common}
              titleKey="sdn.subnetsOf"
              titleValues={{ vnet }}
              emptyKey="sdn.noSubnets"
              listPath={["cluster", "sdn", "vnets", vnet, "subnets"]}
              rowId={(s) => String(s.subnet)}
              view={(s) => ({
                title: String(s.cidr ?? s.subnet),
                detail: [
                  s.gateway ? t("sdn.gatewayIs", { gw: s.gateway }) : null,
                  s.snat ? "SNAT" : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                badges: <StateBadge state={s.state} />,
              })}
              fields={subnetFields}
              prepare={(row) => {
                const r = withPending(row);
                const ranges = [r["dhcp-range"]]
                  .flat()
                  .filter(Boolean) as string[];
                return {
                  ...r,
                  subnet: r.cidr ?? r.subnet,
                  "dhcp-range": ranges
                    .map((x) => {
                      const s = String(x).match(/start-address=([^,]+)/)?.[1];
                      const e = String(x).match(/end-address=([^,]+)/)?.[1];
                      return s && e ? `${s} - ${e}` : String(x);
                    })
                    .join("\n"),
                };
              }}
              createPath={["cluster", "sdn", "vnets", vnet, "subnets"]}
              itemPath={(s) => [
                "cluster",
                "sdn",
                "vnets",
                vnet,
                "subnets",
                String(s.subnet),
              ]}
              toParams={subnetParams}
              createLabelKey="sdn.addSubnet"
            />
          )}
        </>
      )}
      {view === "controllers" && (
        <CrudSection<SdnRow>
          {...common}
          titleKey="sdn.views.controllers"
          emptyKey="sdn.none"
          listPath={["cluster", "sdn", "controllers"]}
          onLoaded={setControllers}
          rowId={(c) => String(c.controller)}
          view={(c) => ({
            title: String(c.controller),
            detail: [c.asn ? `ASN ${c.asn}` : null, c.peers, c.node]
              .filter(Boolean)
              .join(" · "),
            badges: (
              <>
                <Badge variant="outline">{String(c.type ?? "")}</Badge>
                <StateBadge state={c.state} />
              </>
            ),
          })}
          fields={controllerFields}
          createPath={["cluster", "sdn", "controllers"]}
          itemPath={(c) => [
            "cluster",
            "sdn",
            "controllers",
            String(c.controller),
          ]}
          toParams={(v, c) => paramsFrom(controllerFields, v, c)}
          createLabelKey="sdn.addController"
        />
      )}
      {view === "ipams" && (
        <CrudSection<SdnRow>
          {...common}
          titleKey="sdn.views.ipams"
          emptyKey="sdn.none"
          listPath={["cluster", "sdn", "ipams"]}
          onLoaded={setIpams}
          rowId={(i) => String(i.ipam)}
          view={(i) => ({
            title: String(i.ipam),
            detail: i.url ? String(i.url) : undefined,
            badges: <Badge variant="outline">{String(i.type ?? "")}</Badge>,
          })}
          fields={ipamFields}
          createPath={["cluster", "sdn", "ipams"]}
          itemPath={(i) => ["cluster", "sdn", "ipams", String(i.ipam)]}
          toParams={withSecret(ipamFields, "token")}
          canEdit={(i) => i.type !== "pve"}
          canDelete={(i) => i.ipam !== "pve"}
          createLabelKey="sdn.addIpam"
        />
      )}
      {view === "dns" && (
        <CrudSection<SdnRow>
          {...common}
          titleKey="sdn.views.dns"
          emptyKey="sdn.none"
          listPath={["cluster", "sdn", "dns"]}
          onLoaded={setDnsList}
          rowId={(d) => String(d.dns)}
          view={(d) => ({
            title: String(d.dns),
            detail: d.url ? String(d.url) : undefined,
            badges: <Badge variant="outline">{String(d.type ?? "")}</Badge>,
          })}
          fields={dnsFields}
          createPath={["cluster", "sdn", "dns"]}
          itemPath={(d) => ["cluster", "sdn", "dns", String(d.dns)]}
          toParams={withSecret(dnsFields, "key")}
          createLabelKey="sdn.addDns"
        />
      )}
      {/* Controllers, IPAMs and DNS servers feed the zone dialog. */}
      {view === "zones" && (
        <>
          <ListLoader
            hostId={hostId}
            isVisible={isVisible}
            path="controllers"
            onLoaded={setControllers}
          />
          <ListLoader
            hostId={hostId}
            isVisible={isVisible}
            path="ipams"
            onLoaded={setIpams}
          />
          <ListLoader
            hostId={hostId}
            isVisible={isVisible}
            path="dns"
            onLoaded={setDnsList}
          />
        </>
      )}
    </div>
  );
}

/** Loads one SDN list for a picker, drawing nothing. */
function ListLoader({
  hostId,
  isVisible,
  path,
  onLoaded,
}: {
  hostId: number;
  isVisible: boolean;
  path: string;
  onLoaded: (rows: SdnRow[]) => void;
}) {
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    pve<SdnRow[]>(hostId, "GET", ["cluster", "sdn", path]).then(
      (rows) => !cancelled && onLoaded(rows ?? []),
      () => !cancelled && onLoaded([]),
    );
    return () => {
      cancelled = true;
    };
    // onLoaded is a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, isVisible, path]);
  return null;
}

function ZonesLoader(props: {
  hostId: number;
  isVisible: boolean;
  onLoaded: (rows: SdnRow[]) => void;
}) {
  return <ListLoader {...props} path="zones" />;
}
