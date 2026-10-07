import { DataTable, Textarea } from "@ui";
import { useMemo, useState } from "react";
import { run } from "./logic";

// The workspace of IPv6 Address Expander and Compressor: one box for addresses, one per line, and a
// table with each one in full and in its RFC 5952 short form. Everything is worked out on the page.

export default function ToolUi() {
  const [text, setText] = useState("2001:0DB8:0000:0000:0001:0000:0000:0001");
  const result = useMemo(() => run({ text }), [text]);

  return (
    <>
      <Textarea
        id="ipv6-expander-compressor-input"
        label="IPv6 addresses, one per line"
        rows={4}
        spellCheck={false}
        autoComplete="off"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {!result.ok && (
        <p className="text-sm text-danger-text" role="alert">
          {result.error}
        </p>
      )}
      {result.ok && (
        <DataTable
          id="ipv6-expander-compressor-result"
          label="Expanded and compressed addresses"
          columns={["Typed", "Expanded", "Compressed (RFC 5952)"]}
          rows={result.rows.map((row) =>
            row.ok ? [row.input, row.expanded, row.compressed] : [row.input, row.error, ""],
          )}
        />
      )}
    </>
  );
}
