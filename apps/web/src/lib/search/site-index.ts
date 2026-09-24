// The search index of this site: the production registry, built once. The endpoint that serves it
// and the dialog that names its address both import this, so they cannot disagree (ADR 0045).

import { tools } from "../registry";
import { buildSearchIndex, serializeSearchIndex } from "./index-build";

export const siteSearchIndex = serializeSearchIndex(buildSearchIndex(tools));
