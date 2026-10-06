import { redirect } from "@sveltejs/kit";
import { url } from "#lib/nav.ts";

// Old app links (#/view/arg?e=id, e.g. the proof-pack cover Chrome prints: /#/print/<year>?e=<id>) are mapped by the layout.
export const load = () => {
  if (!location.hash.startsWith("#/")) redirect(307, url("/home"));
};
