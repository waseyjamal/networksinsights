import { defineWorker } from "@networksinsights/tool-sdk/worker";
import xmlFormatter from "xml-formatter";
import { formatXml, type Input, type WorkerResult } from "./logic";

// The Web Worker of "XML Formatter" (ADR 0062). The `xml-formatter` library (MIT, with its parser
// xml-parser-xo) loads with this worker, so its code is fetched only once the visitor types or
// pastes XML. formatXml() in logic.ts checks the XML, then prints it with the library.

defineWorker<Input, WorkerResult>(async (input, { signal }) => {
  signal.throwIfAborted();
  return formatXml(xmlFormatter, input);
});
