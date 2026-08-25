import { useId } from 'react';

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
 * Four tiers rather than a value per node. Every node at the same opacity is a texture with no
 * depth, and a hand-picked number per node is 35 decisions nobody will keep in step. A line
 * takes the tier of its brighter endpoint, so the mesh lights up around the junctions on its
 * own.
 *
 * The tiers are weighted heavily towards the quiet end on purpose: 15 dim, 10 normal, 6 medium
 * and 4 highlights. The first pass had three big highlights and not much else, so the eye found
 * three glowing circles instead of a network. What should register first is the texture.
 */
const NODE_OPACITY = { dim: 0.24, node: 0.36, medium: 0.48, bright: 0.65 } as const;
const LINE_OPACITY = { dim: 0.15, node: 0.2, medium: 0.25, bright: 0.32 } as const;

type NodeKind = keyof typeof NODE_OPACITY;

/**
 * The nodes.
 *
 * Generated once at authoring time from seeded cluster sampling, then committed as literals.
 * Nothing is computed at runtime: the figure must be identical on the server, on hydration and
 * on every rerender, so there is no `Math.random()` anywhere near this file.
 *
 * Ten cluster centres weighted towards the right, sampled with jitter and a 26-unit minimum
 * gap, plus a few connector nodes sitting between clusters so the result is a graph rather than
 * ten islands. The irregularity is the point: no rows, no symmetry, no repeated motif.
 *
 * Tiering is by degree, not by eye. The nodes with the most edges become the medium and
 * highlight ones, so a bright point is a junction the mesh actually converges on. Highlights
 * are additionally kept out of three places: left of x=800, the top-right box the badges
 * occupy (x>856, y<64), and the strip the registration-code line runs through. None sits past x=1168 either, where the banner's right edge would slice
 * a highlight in half and make it look like a rendering fault.
 *
 * Radii are 1.6-2.2 dim, 2.4-3.0 normal, 3.2-3.8 medium, 4.0-4.8 highlight. Ordered by x, and
 * do not re-sort: EDGES below is a list of indexes into this array, so moving an entry silently
 * rewires the graph.
 */
const NODES: Array<{ x: number; y: number; r: number; kind: NodeKind }> = [
  { x: 544, y: 145, r: 1.6, kind: 'dim' },
  { x: 561, y: 103, r: 1.9, kind: 'dim' },
  { x: 586, y: 84, r: 3, kind: 'node' },
  { x: 632, y: 57, r: 1.8, kind: 'dim' },
  { x: 662, y: 33, r: 2.1, kind: 'dim' },
  { x: 662, y: 143, r: 1.6, kind: 'dim' },
  { x: 710, y: 153, r: 3.6, kind: 'medium' },
  { x: 740, y: 116, r: 3.8, kind: 'medium' },
  { x: 758, y: 59, r: 1.8, kind: 'dim' },
  { x: 780, y: 117, r: 2.9, kind: 'node' },
  { x: 798, y: 80, r: 2.4, kind: 'node' },
  { x: 812, y: 118, r: 4.4, kind: 'bright' },
  { x: 823, y: 157, r: 3, kind: 'node' },
  { x: 846, y: 132, r: 3.4, kind: 'medium' },
  { x: 882, y: 167, r: 2.1, kind: 'dim' },
  { x: 896, y: 100, r: 2.5, kind: 'node' },
  { x: 914, y: 74, r: 2.7, kind: 'node' },
  { x: 919, y: 48, r: 3, kind: 'node' },
  { x: 949, y: 44, r: 3.4, kind: 'medium' },
  { x: 962, y: 144, r: 2.9, kind: 'node' },
  { x: 965, y: 92, r: 4, kind: 'bright' },
  { x: 969, y: 172, r: 1.9, kind: 'dim' },
  { x: 1002, y: 145, r: 3, kind: 'node' },
  { x: 1010, y: 44, r: 2.6, kind: 'node' },
  { x: 1018, y: 121, r: 3.7, kind: 'medium' },
  { x: 1050, y: 130, r: 2.6, kind: 'node' },
  { x: 1088, y: 55, r: 3.5, kind: 'medium' },
  { x: 1104, y: 97, r: 4.6, kind: 'bright' },
  { x: 1091, y: 152, r: 2.8, kind: 'node' },
  { x: 1128, y: 12, r: 2.1, kind: 'dim' },
  { x: 1136, y: 153, r: 4.2, kind: 'bright' },
  { x: 1157, y: 121, r: 2.6, kind: 'node' },
  { x: 1152, y: 45, r: 2.8, kind: 'node' },
  { x: 1170, y: 20, r: 1.8, kind: 'dim' },
  { x: 1190, y: 151, r: 2.5, kind: 'node' },
  // Appended, not inserted: EDGES indexes into this array, so a new entry has to go last.
  { x: 1063, y: 62, r: 2.8, kind: 'node' },
  { x: 1126, y: 86, r: 2.2, kind: 'dim' },
  { x: 1168, y: 84, r: 3, kind: 'node' },
  // The left third, added so the mesh reaches across the whole banner rather than starting at
  // 45%. Radii stay at or under 2.6 and there is not a single highlight here: this is the half
  // the title and the faculty line sit on, and size is what keeps it a texture.
  //
  // The TIERS, though, run a step higher here than the same-sized nodes on the right, which
  // looks backwards and is not. Opacity is not brightness: the ground under this end is
  // #142347 and under the other end #163C85, so blue at 24% that reads perfectly well on the
  // right is invisible on the left. Lifting the tier buys back roughly what the darker ground
  // takes away, and the two ends end up at about the same apparent weight. That is also why
  // this component no longer carries a fade mask: it was subtracting from the end that already
  // had the least to give.
  { x: 128, y: 92, r: 2, kind: 'node' },
  { x: 164, y: 148, r: 1.8, kind: 'dim' },
  { x: 190, y: 36, r: 2.2, kind: 'node' },
  { x: 232, y: 58, r: 2, kind: 'dim' },
  { x: 286, y: 122, r: 2.4, kind: 'medium' },
  { x: 330, y: 40, r: 1.8, kind: 'node' },
  { x: 356, y: 158, r: 2, kind: 'dim' },
  { x: 396, y: 86, r: 2.6, kind: 'medium' },
  { x: 434, y: 30, r: 2, kind: 'node' },
  { x: 448, y: 138, r: 2.2, kind: 'node' },
  { x: 486, y: 66, r: 2.4, kind: 'medium' },
  { x: 502, y: 170, r: 1.8, kind: 'dim' },
  { x: 518, y: 110, r: 2.6, kind: 'node' },
];

/**
 * The edges, as pairs of indexes into NODES.
 *
 * Every node joined to its two or three nearest neighbours within 122 units, deduplicated. That
 * rule is what makes the mesh local: these are all short and medium links, no node is left
 * unconnected (which is what turns a graph into a starfield), and the density follows the node
 * density rather than being drawn on top of it.
 */
const EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 3],
  [2, 4],
  [5, 6],
  [5, 7],
  [6, 7],
  [7, 8],
  [8, 10],
  [9, 10],
  [9, 11],
  [10, 11],
  [11, 12],
  [11, 13],
  [12, 13],
  [12, 14],
  [13, 14],
  [15, 16],
  [15, 17],
  [16, 17],
  [17, 18],
  [18, 20],
  [19, 20],
  [19, 21],
  [19, 22],
  [20, 23],
  [22, 24],
  [23, 24],
  [24, 25],
  [25, 28],
  [26, 27],
  [26, 29],
  [26, 32],
  [26, 33],
  [27, 28],
  [27, 31],
  [28, 30],
  [28, 34],
  [29, 32],
  [29, 33],
  [30, 31],
  [31, 34],
  [32, 33],
  [23, 35],
  [26, 35],
  [27, 36],
  [31, 37],
  [27, 37],
  [36, 37],
  [41, 42],
  [41, 43],
  [42, 44],
  [42, 47],
  [43, 45],
  [44, 47],
  [45, 46],
  [45, 48],
  [46, 48],
  [47, 50],
  [48, 50],
  [49, 50],
  [50, 0],
  [48, 2],
  [38, 39],
  [38, 40],
  [40, 41],
  [39, 41],
];

/**
 * Four long links across the composition, and only four.
 *
 * The nearest-neighbour rule above builds three separate clusters and no bridge between them,
 * which reads as three unrelated patches. These stitch them together and give the figure some
 * depth. Straight, not the sweeping quadratic arcs the first pass had: an arc is a drawn shape
 * and it made the background look decorated rather than structural.
 *
 * They are also drawn quieter than the tier they would otherwise inherit. [11, 20] joins two
 * highlights, so at the normal rule it would be the brightest line on the banner and the first
 * thing anyone saw. A long line's job here is depth, not emphasis.
 */
const CROSS_LINKS: Array<[number, number]> = [
  [2, 7],
  [10, 16],
  [11, 20],
  [18, 26],
];
const CROSS_LINK_OPACITY = 0.15;

/**
 * Six edges drawn as directed transitions, with an arrowhead at the target end.
 *
 * A nod to what the app is for. AFCT is an automata tool, and a directed edge is the one mark
 * that says "state machine" without anyone having to be told; JFLAP's own drawings are arrows
 * between circles. Six of seventy, though, and no labels: a background that arrowed every line
 * would be a diagram of something, and this has to sit behind Operating Systems and Compiler
 * Construction as comfortably as behind Automata. See the note on the marker for why the lines
 * are shortened rather than run to the node centre.
 */
const ARROW_OPACITY = 0.3;
const ARROWS: Array<[number, number]> = [
  [7, 9],
  [16, 18],
  [18, 23],
  [20, 24],
  [25, 27],
  [30, 34],
];

/** The tier a line takes: the brighter of its two ends. */
function lineKind(a: NodeKind, b: NodeKind): NodeKind {
  if (a === 'bright' || b === 'bright') return 'bright';
  if (a === 'medium' || b === 'medium') return 'medium';
  if (a === 'node' || b === 'node') return 'node';
  return 'dim';
}

/**
 * Both edge lists resolved to coordinates, once, at module load rather than on every render.
 *
 * The throw is the point of doing it here. These are hand-written lists of indexes, and one that
 * has drifted past the end of NODES would otherwise be a line that silently does not draw, which
 * is invisible in a decoration nobody is looking at closely. This is constant data, so it either
 * fails the first time the module loads or it never fails.
 */
function resolve(pairs: Array<[number, number]>, opts: { opacity?: number; trim?: boolean } = {}) {
  return pairs.map(([a, b]) => {
    const from = NODES[a];
    const to = NODES[b];
    if (!from || !to) {
      throw new Error(`IdentityNetwork: edge ${a}-${b} names a node that does not exist`);
    }
    // An arrowed line stops short of its target so the head sits just off the node instead of
    // buried under it. Done here in the geometry rather than with the marker's refX, which is
    // measured in the marker's own units and would need a different value per target radius.
    let { x: x2, y: y2 } = to;
    if (opts.trim) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const back = to.r + 5.5;
      x2 = +(to.x - (dx / len) * back).toFixed(1);
      y2 = +(to.y - (dy / len) * back).toFixed(1);
    }
    return {
      key: `${a}-${b}`,
      x1: from.x,
      y1: from.y,
      x2,
      y2,
      opacity: opts.opacity ?? LINE_OPACITY[lineKind(from.kind, to.kind)],
    };
  });
}

const LINES = resolve(EDGES);
const CROSS_LINES = resolve(CROSS_LINKS, { opacity: CROSS_LINK_OPACITY });
const ARROW_LINES = resolve(ARROWS, { trim: true, opacity: ARROW_OPACITY });
const HALOS = NODES.filter((n) => n.kind === 'bright');

/**
 * The connected-node figure behind an identity banner, on the course page and the assignment
 * page alike.
 *
 * Presentation only, and decorative in the strict sense: it is `aria-hidden`, it cannot take
 * focus, it takes no pointer events and it carries no information the banner needs. Remove it
 * and the course page loses nothing but its texture, which is exactly why the high-contrast
 * theme is allowed to delete it by setting its two colours to `transparent`.
 *
 * Both colours come from the banner's token family, so this never has to know which theme it is
 * in. Lines and ordinary nodes are `currentColor` at four opacities, set by the caller as
 * `text-course-banner-node`; the highlights are the brighter `--course-banner-glow`.
 *
 * Static. Nothing here pulses, drifts or reacts to the pointer. This sits at the top of every
 * course page for as long as the page is open, and a persistent shell element that moves is
 * something people learn to look away from.
 *
 * The left fade is a mask rather than a rule about where nodes may go, which is the change that
 * let the mesh get denser. Hand-avoiding the title area meant the figure could not start until
 * about 55% of the width and had to be sparse when it did; a horizontal gradient mask lets the
 * geometry run from 45% and simply be almost invisible there. Roughly: nothing before 30%, a
 * whisper at 44%, two thirds by 58%, full from 72%. The banner's text-safe wash still sits
 * over the top of this, so the two work together rather than either doing the whole job.
 *
 * No blur filters. The four highlights get their lift from one slightly larger translucent
 * circle behind them at 3.5 units of margin, which costs one more `<circle>` each; the first
 * pass used 2.6x the radius, so a 5-unit node came with a 13-unit halo and read as a glowing
 * orb rather than an accent. About 100 elements in total, all static.
 *
 * `xMidYMid slice` rather than the default, and it is the one attribute worth understanding
 * here. `slice` covers the banner and crops whatever does not fit, so the figure is never
 * squashed at any width; `xMid` decides what gets cropped as the banner narrows. Centring is
 * what makes that graceful: a wide desktop banner shows nearly all 1200 units, a tablet shows
 * the middle two thirds, and a phone shows a narrow slice around the 40-60% band, which the mask
 * has already faded down hard. So the network thins out on its own exactly where there
 * is least room for it, with no breakpoint deciding it. `xMax` would do the opposite and slide
 * the densest cluster behind stacked text on the smallest screen.
 */
export function IdentityNetwork({ className }: { className?: string }) {
  // One banner per page, but an id collision would point the arrowheads at another component's
  // marker, and the colons React puts in these are fine inside a url() reference.
  const arrowId = `course-network-head-${useId()}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={cn(
        'text-course-banner-node pointer-events-none absolute inset-0 size-full',
        // Quieter on a phone, where the banner is a stack of full-width rows and every part of
        // it has text over it. One opacity on the whole figure rather than hiding a group: half
        // a graph reads as a rendering fault, a faint one reads as a background.
        'opacity-70 sm:opacity-100',
        className,
      )}
    >
      <defs>
        {/*
          markerUnits userSpaceOnUse, not the default. By default a marker scales with the
          stroke width, and at 0.8 these heads would come out a third of the size they are
          drawn; in user units the head is 6.5 by 6.5 whatever the line does, which is about
          twice a small node. At 5.5 it was legible when you went looking and invisible when
          you did not, which is not much use for the one mark that says "state machine".
        */}
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 0 1.4 L 9 5 L 0 8.6 Z" fill="currentColor" />
        </marker>
      </defs>

      <g>
        {/* 0.8 units, which lands just under a pixel at desktop scale. The mesh should read as
            a weave, and a 1px line at this density reads as a diagram. */}
        <g stroke="currentColor" fill="none" strokeWidth={0.8} strokeLinecap="round">
          {LINES.map(({ key, ...line }) => (
            <line key={key} {...line} />
          ))}
        </g>
        <g stroke="currentColor" fill="none" strokeWidth={0.7} strokeLinecap="round">
          {CROSS_LINES.map(({ key, ...line }) => (
            <line key={key} {...line} />
          ))}
        </g>
        {/* The directed few. butt caps rather than round: a rounded end pokes out past the
            arrowhead's base and reads as a smudge in front of it. */}
        <g stroke="currentColor" fill="none" strokeWidth={0.9} markerEnd={`url(#${arrowId})`}>
          {ARROW_LINES.map(({ key, ...line }) => (
            <line key={key} {...line} />
          ))}
        </g>

        {/* The halos, under every node so a line never crosses over one. */}
        <g fill="var(--course-banner-glow)" opacity={0.09}>
          {HALOS.map((n) => (
            <circle key={`halo-${n.x}-${n.y}`} cx={n.x} cy={n.y} r={n.r + 3.5} />
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
      </g>
    </svg>
  );
}

export default IdentityNetwork;
