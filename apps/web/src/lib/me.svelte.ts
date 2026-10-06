// The person (doc _app/person, lib/person.ts) shared by every screen: /you and the Taxximizer load and save it, the tax return and
// the planner read the release date and service months from it.
import type { Person } from "@openbooks/core";

export const ME = $state<{ person: Person | null }>({ person: null });
