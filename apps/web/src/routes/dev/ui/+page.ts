import { error } from "@sveltejs/kit";

// The component gallery is a development tool (the overflow check runs it under `vp dev`): production builds answer 404.
export const load = () => {
  if (!import.meta.env.DEV) error(404, "Not found");
};
