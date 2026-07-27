// Reconstructs the true stellar hierarchy (system -> star -> planet -> moon -> sub-moon -> ...)
// from Elite Dangerous's body-naming convention, for the System facilities tree's display only —
// doesn't affect the solver or anything else, which all stay flat over `JournalBody[]`.
//
// Naming convention (not officially documented, inferred from in-game observation, per the user's
// own worked example): a body's name is the system name, optionally followed by a space-separated
// suffix — one token per hierarchy level. A system with a single star has no suffix at all for
// that star (the star's own name IS the bare system name); with multiple stars, each additional
// one gets a letter suffix ("A", "B", ...). Planets get a number under their star ("B 10"), moons
// get a letter under their planet ("B 10 e"), sub-moons another letter ("B 10 e a"), and so on.
//
// Not every body in this chain is necessarily itself a scanned JournalBody (the Journal only
// records what's actually been scanned) — an intermediate level with no matching scanned body
// still gets a synthetic node (label only, `body: null`, no slots/facilities) so deeper scanned
// bodies still nest under the right ancestor instead of flattening out.

import type { JournalBody } from "../journal/parser";

export interface BodyHierarchyNode {
  label: string;
  /** Cumulative space-separated path from the root, e.g. "B 10 e" — "" for the root itself. */
  path: string;
  /** The scanned body at exactly this path, or null for a synthetic (never individually scanned)
   * ancestor that only exists to group its descendants correctly. */
  body: JournalBody | null;
  children: BodyHierarchyNode[];
}

function pathTokens(starSystem: string, bodyName: string): string[] {
  if (bodyName === starSystem) return [];
  const prefix = `${starSystem} `;
  if (bodyName.startsWith(prefix)) {
    return bodyName
      .slice(prefix.length)
      .split(" ")
      .filter((t) => t.length > 0);
  }
  // Unrecognized naming (an exotic/edge-case system name) — degrade to a single flat top-level
  // node rather than guessing a wrong hierarchy.
  return [bodyName];
}

function sortChildren(node: BodyHierarchyNode): void {
  node.children.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  node.children.forEach(sortChildren);
}

export function buildBodyHierarchy(starSystem: string, bodies: JournalBody[]): BodyHierarchyNode {
  const root: BodyHierarchyNode = { label: starSystem, path: "", body: null, children: [] };
  const nodesByPath = new Map<string, BodyHierarchyNode>([["", root]]);
  const bodyById = new Map<number, JournalBody>(bodies.map((b) => [b.bodyId, b]));

  // Rings/belts (`journal/parser.ts`'s `withRingBodies`) are handled in a second pass below — their
  // own `bodyName` has multiple trailing tokens ("A Belt"/"A Ring") that don't correspond to one
  // hierarchy level each, unlike an ordinary star/planet/moon/sub-moon chain.
  const ringBodies: JournalBody[] = [];

  for (const body of bodies) {
    if (body.kind === "ring") {
      ringBodies.push(body);
      continue;
    }
    const tokens = pathTokens(starSystem, body.bodyName);
    if (tokens.length === 0) {
      root.body = body;
      continue;
    }
    let parent = root;
    let cumulative = "";
    for (const token of tokens) {
      cumulative = cumulative ? `${cumulative} ${token}` : token;
      let node = nodesByPath.get(cumulative);
      if (!node) {
        node = { label: token, path: cumulative, body: null, children: [] };
        nodesByPath.set(cumulative, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.body = body;
  }

  // Attach each ring/belt as a single leaf directly under its real parent's already-resolved node
  // (found via the parent bodyId `parents[0]` carries), rather than walking its name token-by-token
  // like an ordinary body above — its own name's trailing tokens become one combined leaf label
  // instead of several spurious extra nesting levels.
  for (const ring of ringBodies) {
    const parentId = ring.parents[0]?.bodyId;
    const parent = parentId !== undefined ? bodyById.get(parentId) : undefined;
    const parentTokens = parent ? pathTokens(starSystem, parent.bodyName) : [];
    const parentPath = parentTokens.join(" ");
    const parentNode = nodesByPath.get(parentPath) ?? root;
    const ringTokens = pathTokens(starSystem, ring.bodyName);
    const label = ringTokens.slice(parentTokens.length).join(" ") || ring.bodyName;
    const path = parentPath ? `${parentPath} ${label}` : label;
    parentNode.children.push({ label, path, body: ring, children: [] });
  }

  sortChildren(root);
  return root;
}
