// The app icons, /icons/<name>.png, drawn at build time from the constellation mark (ADR 0052).
// `icons` is a reserved path, so no tool can take it.

import type { APIRoute, GetStaticPaths } from "astro";
import { renderIcon } from "../../lib/pwa/icon-render";
import { appIcons } from "../../lib/pwa/paths";

export const getStaticPaths = (() =>
  appIcons.map((icon) => ({
    params: { icon: icon.name },
    props: { icon },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(new Uint8Array(await renderIcon(props.icon)), {
    headers: { "Content-Type": "image/png" },
  });
