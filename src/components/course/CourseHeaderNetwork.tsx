import { cn } from '@/lib/utils';

/**
 * The network's own coordinate space. Stretched to whatever the banner is; see the note on
 * preserveAspectRatio below. 1200x180 is roughly the banner's desktop shape, so the geometry
 * below can be read as "where on the banner", not as an abstraction that needs converting.
 */
const W = 1200;
const H = 180;

/**
 * How bright a thing is, by what kind of thing it is.
 *
 * Three tiers rather than a value per node. Every node at the same opacity is a texture with
 * no depth, and a hand-picked number per node is 24 decisions nobody will keep in step. A
 * line takes the tier of its brighter endpoint, so the structure lights up around the
 * highlights on its own.
 */
const NODE_OPACITY = { dim: 0.22, node: 0.34, bright: 0.7 } as const;
const LINE_OPACITY = { dim: 0.1, node: 0.16, bright: 0.24 } as const;

type NodeKind = keyof typeof NODE_OPACITY;

/**
 * The nodes, hand-placed, and the placement is the whole design.
 *
 * Two constraints decide where they can go and neither is negotiable:
 *
 *   - Nothing bright sits behind text. The course name, the faculty line and the registration
 *     code run to roughly x=800 on the longest real course, so the whole left half is `dim`
 *     or `node` and the first highlight does not start until 856.
 *   - Nothing bright sits behind the badges, which sit top-right. Above y=58 stays dim past
 *     x=860, and all three highlights are in the middle band or below it.
 *
 * Density climbs to the right, which is where the banner has empty space to spend. The mix of
 * radii is what keeps it from reading as a grid: most nodes are 2-3 units, a few are 3+, and
 * the three highlights are 4.6-5.2 with a halo behind them.
 *
 * Roughly left to right, but do not re-sort it. EDGES below is a list of indexes into this
 * array, so moving an entry silently rewires the graph.
 */
const NODES: Array<{ x: number; y: number; r: number; kind: NodeKind }> = [
  // Left: quiet, behind the title. Four nodes, all dim.
  { x: 604, y: 148, r: 2.0, kind: 'dim' },
  { x: 662, y: 96, r: 2.4, kind: 'dim' },
  { x: 648, y: 30, r: 1.8, kind: 'dim' },
  { x: 726, y: 140, r: 3.2, kind: 'node' },
  // Middle: the structure starts to close up.
  { x: 744, y: 58, r: 2.2, kind: 'dim' },
  { x: 856, y: 118, r: 5.0, kind: 'bright' },
  { x: 816, y: 22, r: 2.0, kind: 'dim' },
  { x: 846, y: 162, r: 2.4, kind: 'dim' },
  { x: 862, y: 68, r: 3.0, kind: 'node' },
  { x: 894, y: 126, r: 2.8, kind: 'node' },
  { x: 918, y: 36, r: 2.2, kind: 'dim' },
  { x: 940, y: 170, r: 2.0, kind: 'dim' },
  { x: 962, y: 96, r: 4.6, kind: 'bright' },
  // Right: densest, and where the ground is lightest.
  { x: 996, y: 150, r: 3.0, kind: 'node' },
  { x: 1004, y: 24, r: 2.0, kind: 'dim' },
  { x: 1034, y: 72, r: 3.0, kind: 'node' },
  { x: 1062, y: 124, r: 2.4, kind: 'dim' },
  { x: 1078, y: 170, r: 2.2, kind: 'dim' },
  { x: 1092, y: 42, r: 2.6, kind: 'node' },
  { x: 1118, y: 104, r: 5.2, kind: 'bright' },
  { x: 1152, y: 152, r: 2.4, kind: 'dim' },
  { x: 1164, y: 62, r: 2.8, kind: 'node' },
  { x: 1188, y: 118, r: 2.2, kind: 'dim' },
  { x: 1182, y: 14, r: 1.8, kind: 'dim' },
];

/**
 * The edges, as pairs of indexes into NODES.
 *
 * Mostly near neighbours, which is what makes it read as a graph rather than as scattered
 * points: a node with no edge is a speck, and a node with three is a junction. A handful
 * deliberately skip a neighbour so the mesh is not uniform.
 */
const EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 4],
  [3, 5],
  [3, 7],
  [4, 5],
  [4, 8],
  [5, 7],
  [5, 8],
  [6, 8],
  [6, 10],
  [7, 9],
  [8, 9],
  [8, 10],
  [9, 11],
  [9, 12],
  [10, 12],
  [11, 13],
  [12, 13],
  [12, 15],
  [13, 16],
  [13, 19],
  [14, 15],
  [14, 18],
  [15, 16],
  [15, 18],
  [16, 17],
  [16, 19],
  [17, 19],
  [18, 19],
  [18, 21],
  [19, 20],
  [19, 21],
  [19, 22],
  [20, 22],
  [21, 23],
];

/**
 * Three long links, drawn as curves rather than as straight edges.
 *
 * Every other connection is between neighbours, so a set of straight lines settles into an
 * even mesh. These three cross the whole right half and bow away from it, which is what stops
 * the structure looking like a triangulation. One quadratic control point each: they are
 * tuned by eye, and two control points is twice as much to re-derive when one moves.
 */
const ARCS = [
  'M 662 96 Q 770 10 862 68',
  'M 856 118 Q 950 180 1034 72',
  'M 894 126 Q 1030 174 1164 62',
];

/** The tier a line takes: the brighter of its two ends. */
function lineKind(a: NodeKind, b: NodeKind): NodeKind {
  if (a === 'bright' || b === 'bright') return 'bright';
  if (a === 'node' || b === 'node') return 'node';
  return 'dim';
}

/**
 * The edges resolved to coordinates, once, at module load rather than on every render.
 *
 * The throw is the point of doing it here. EDGES is a hand-written list of indexes, and an
 * index that has drifted past the end of NODES would otherwise be a line that silently does
 * not draw, which is invisible in a decoration nobody is looking at closely. This is constant
 * data, so it either fails the first time the module loads or it never fails.
 */
const LINES = EDGES.map(([a, b]) => {
  const from = NODES[a];
  const to = NODES[b];
  if (!from || !to) {
    throw new Error(`CourseHeaderNetwork: edge ${a}-${b} names a node that does not exist`);
  }
  return {
    key: `${a}-${b}`,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    opacity: LINE_OPACITY[lineKind(from.kind, to.kind)],
  };
});

/**
 * The connected-node figure behind the course banner.
 *
 * Presentation only, and decorative in the strict sense: it is `aria-hidden`, it cannot take
 * focus, it takes no pointer events and it carries no information the banner needs. Remove it
 * and the course page loses nothing but its texture, which is exactly why the high-contrast
 * theme is allowed to delete it by setting its two colours to `transparent`.
 *
 * Both colours come from the banner's token family, so this never has to know which theme it
 * is in. Lines and ordinary nodes are `currentColor` at three opacities, set by the caller as
 * `text-course-banner-node`; the three highlights are the brighter `--course-banner-glow`.
 *
 * Static. Nothing here pulses, drifts or reacts to the pointer. This sits at the top of every
 * course page for as long as the page is open, and a persistent shell element that moves is
 * something people learn to look away from.
 *
 * No blur filters either. The highlights get their lift from a large translucent circle drawn
 * behind them, which costs one more `<circle>`; a Gaussian blur on three nodes costs a
 * filter region the compositor has to re-rasterise. About 70 elements in total.
 *
 * `xMidYMid slice` rather than the default, and it is the one attribute worth understanding
 * here. `slice` covers the banner and crops whatever does not fit, so the figure is never
 * squashed at any width; `xMid` decides what gets cropped as the banner narrows. Centring is
 * what makes that graceful: a wide desktop banner shows nearly all 1200 units, a tablet shows
 * the middle two thirds, and a phone shows a narrow slice of the quiet left-of-centre region,
 * so the network naturally thins out exactly where there is least room for it. `xMax` would
 * do the opposite and slide the densest cluster behind stacked text on the smallest screen.
 */
export function CourseHeaderNetwork({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={cn(
        'text-course-banner-node pointer-events-none absolute inset-0 size-full',
        // Quieter on a phone, where the banner is a stack of full-width rows and every part
        // of it has text over it. One opacity on the whole figure rather than hiding a group:
        // half a graph reads as a rendering fault, a faint one reads as a background.
        'opacity-60 sm:opacity-100',
        className,
      )}
    >
      <g stroke="currentColor" strokeWidth={1} fill="none" strokeLinecap="round">
        {LINES.map(({ key, ...line }) => (
          <line key={key} {...line} />
        ))}
        {ARCS.map((d) => (
          <path key={d} d={d} opacity={0.14} />
        ))}
      </g>

      {/* The halos, under every node so a line never crosses over one. */}
      <g fill="var(--course-banner-glow)" opacity={0.16}>
        {NODES.filter((n) => n.kind === 'bright').map((n) => (
          <circle key={`halo-${n.x}-${n.y}`} cx={n.x} cy={n.y} r={n.r * 2.6} />
        ))}
      </g>

      {NODES.map((n) => (
        <circle
          key={`${n.x}-${n.y}`}
          cx={n.x}
          cy={n.y}
          r={n.r}
          fill={n.kind === 'bright' ? 'var(--course-banner-glow)' : 'currentColor'}
          opacity={NODE_OPACITY[n.kind]}
        />
      ))}
    </svg>
  );
}

export default CourseHeaderNetwork;
