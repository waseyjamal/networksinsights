import { Alert, DataTable, Input, Textarea } from "@ui";
import { useMemo, useState } from "react";
import { formatBlock, formatCount, run } from "./logic";

// The workspace of CIDR to IP Range Converter: one box that takes a block or a range, IPv4 or
// IPv6, and the answer as it is typed. Everything is worked out on the page.

export default function ToolUi() {
  const [text, setText] = useState("192.168.0.5 - 192.168.0.20");
  const result = useMemo(() => run({ text }), [text]);

  return (
    <>
      <Input
        id="cidr-range-converter-input"
        label="CIDR block or address range"
        hint="For example 10.0.0.0/22, 10.0.0.5 - 10.0.0.20 or 2001:db8::/48"
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
      {result.ok && result.kind === "cidr" && (
        <>
          {result.hostBitsSet && (
            <Alert tone="info">
              {`${result.hostBitsSet} is inside the block ${formatBlock(result.block)}, shown below.`}
            </Alert>
          )}
          <DataTable
            id="cidr-range-converter-result"
            label="Range of the block"
            columns={["Field", "Value"]}
            rows={[
              ["Block", formatBlock(result.block)],
              ["First address", result.first],
              ["Last address", result.last],
              ["Addresses", formatCount(result.count)],
              ...(result.mask ? [["Subnet mask", result.mask]] : []),
            ]}
          />
        </>
      )}
      {result.ok && result.kind === "range" && (
        <>
          <p className="text-sm text-fg-muted" id="cidr-range-converter-summary">
            {`${formatCount(result.count)} ${result.count === BigInt(1) ? "address" : "addresses"} from ${result.first} to ${result.last}, in ${result.blocks.length} ${result.blocks.length === 1 ? "block" : "blocks"}.`}
          </p>
          <Textarea
            id="cidr-range-converter-blocks"
            label="CIDR blocks"
            readOnly
            rows={Math.min(12, Math.max(3, result.blocks.length))}
            value={result.blocks.join("\n")}
          />
        </>
      )}
    </>
  );
}
