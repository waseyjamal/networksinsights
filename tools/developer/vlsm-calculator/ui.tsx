import { Alert, DataTable, Input, Textarea } from "@ui";
import { useMemo, useState } from "react";
import { run } from "./logic";

// The workspace of VLSM Calculator: the network to split, the subnets it needs (one per line), and
// the plan as a table as it is typed. Everything is worked out on the page.

export default function ToolUi() {
  const [network, setNetwork] = useState("192.168.1.0/24");
  const [needs, setNeeds] = useState("Engineering 100\nOffice 50\nSales 20\nLink 2");
  const result = useMemo(() => run({ network, needs }), [network, needs]);

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="vlsm-calculator-network"
          label="Network to split"
          hint="An IPv4 network with its prefix, such as 192.168.1.0/24"
          value={network}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setNetwork(event.target.value)}
        />
        <Textarea
          id="vlsm-calculator-needs"
          label="Subnets: a name and the hosts it needs, one per line"
          rows={6}
          spellCheck={false}
          value={needs}
          onChange={(event) => setNeeds(event.target.value)}
        />
      </div>
      {!result.ok && (
        <p className="text-sm text-danger-text" role="alert">
          {result.error}
        </p>
      )}
      {result.ok && (
        <>
          {result.hostBitsSet && (
            <Alert tone="info">{`${result.hostBitsSet} is inside ${result.network}, which is split below.`}</Alert>
          )}
          <DataTable
            id="vlsm-calculator-result"
            label="Subnet plan"
            columns={[
              "Subnet",
              "Hosts needed",
              "Hosts available",
              "Network",
              "Mask",
              "Usable range",
              "Broadcast",
            ]}
            rows={result.subnets.map((s) => [
              s.name,
              String(s.hostsNeeded),
              String(s.hostsAvailable),
              `${s.network}/${s.prefix}`,
              s.mask,
              `${s.firstHost} – ${s.lastHost}`,
              s.broadcast,
            ])}
          />
          <p className="text-sm text-fg-muted" id="vlsm-calculator-free">
            {result.freeFrom
              ? `${result.freeAddresses} addresses of ${result.network} are still free, from ${result.freeFrom}.`
              : `Every address of ${result.network} is used.`}
          </p>
        </>
      )}
    </>
  );
}
