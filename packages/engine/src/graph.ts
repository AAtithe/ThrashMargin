// Pure graph utilities — no game-specific concepts.
// Used by both Thrash Margin and Banco di Niccolo.

export interface Edge<T = number> {
  from: T;
  to: T;
  [key: string]: unknown;
}

/** Return the ids of all nodes directly connected to `id`. */
export function getNeighbours(edges: [number, number][], id: number): number[] {
  return edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
}

/** BFS shortest-path (hops). Returns Infinity if unreachable. */
export function shortestPath(
  edges: [number, number][],
  from: number,
  to: number,
): number {
  if (from === to) return 0;
  const visited = new Set<number>([from]);
  const queue: Array<{ id: number; dist: number }> = [{ id: from, dist: 0 }];
  while (queue.length) {
    const { id, dist } = queue.shift()!;
    for (const nb of getNeighbours(edges, id)) {
      if (nb === to) return dist + 1;
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push({ id: nb, dist: dist + 1 });
      }
    }
  }
  return Infinity;
}
