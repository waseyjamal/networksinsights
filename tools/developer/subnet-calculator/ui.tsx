import { Alert, DataTable, Input } from "@ui";
import { useMemo, useState } from "react";
import { formatCount, run } from "./logic";

// The workspace of Subnet Calculator: one box for an address with its prefix or mask, and the
// subnet in a table as it is typed. Everything is worked out on the page.

export default function ToolUi() {
  const [text, setText] = useState("192.168.1.10/24");
  const result = useMemo(() => run({ text }), [text]);
  const subnet = result.ok ? result.subnet : null;

  return (
    <>
      <Input
        id="subnet-calculator-input"
        label="IPv4 address with prefix or mask"
        hint="For example 192.168.1.10/24 or 192.168.1.10 255.255.255.0"
        value={text}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setText(event.target.value)}
      />
      {!result.ok && (
        <p className="text-sm text-danger-text" role="alert">
          {result.error}
        </p>
      )}
      {subnet && (
        <>
          <DataTable
            id="subnet-calculator-result"
            label="Subnet"
            columns={["Field", "Value"]}
            rows={[
              ["Address", subnet.address],
              ["Network", `${subnet.network}/${subnet.prefix}`],
              ["Subnet mask", subnet.mask],
              ["Wildcard mask", subnet.wildcard],
              ["Broadcast", subnet.broadcast ?? "None"],
              ["First usable", subnet.firstHost],
              ["Last usable", subnet.lastHost],
              ["Addresses", formatCount(subnet.totalAddresses)],
              ["Usable hosts", formatCount(subnet.usableHosts)],
              ["Mask in binary", subnet.binaryMask],
            ]}
          />
          {subnet.note && <Alert tone="info">{subnet.note}</Alert>}
        </>
      )}
    </>
  );
}
