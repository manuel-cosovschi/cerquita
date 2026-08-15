/**
 * PRIMITIVE VALUES — extracted from the Claude Design export.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Source: `design-reference/mobile-app-design/project/Cerquita - Design
 * Exploration Board.dc.html`, direction **1a "Map first"** — the only direction
 * the board actually contains, despite its title promising seven.
 *
 * This is the ONLY file in the repository that holds raw visual values.
 * Everything else reads semantic tokens from `./semantic.ts`.
 *
 * READ THIS BEFORE TREATING THE PALETTE AS FINAL: the board states its own
 * branding is provisional — "Sorteé paleta, tipografía y radio por dirección a
 * propósito… Es branding provisional y descartable: primero UX, después
 * identidad." The LAYOUT and INTERACTION decisions in 1a are real design
 * intent; the specific hues are a deliberate coin-flip meant to be replaced
 * once a direction is chosen. See `docs/design-audit.md`.
 *
 * Colors are given as hex converted from the export's `oklch()` values, so they
 * work in React Native too. The original oklch is kept in a comment beside each
 * one, because it is the authoritative value for web.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const palette = {
  /**
   * Warm neutral ramp. The product is not grey: the canvas is a cream
   * (`#f6f2ea`) and the ink is a warm near-black (`#141210`), never pure black.
   */
  neutral: {
    0: '#ffffff',
    /** Canvas — the background of every screen and sheet. */
    50: '#f6f2ea',
    /** Board / app chrome behind the canvas. */
    100: '#eceae5',
    /** Chip and tag fill. */
    150: '#f2ede3',
    200: '#eee8dd',
    /** Placeholder imagery stripes. */
    300: '#e5dfd3',
    400: '#dcd6ca',
    500: '#d0cabd',
    600: '#8a837a',
    700: '#57514a',
    800: '#332e28',
    /** Ink — primary text, dark cards, the floating dock's active state. */
    900: '#141210',
    950: '#0b0a09',
  },

  /**
   * Accent: warm orange. Carries urgency — auctions, countdowns, "Ahora", and
   * the publish action in the dock.
   */
  accent: {
    /** oklch(.94 .03 55) — subtle fill. */
    100: '#fdeadb',
    /** oklch(.8 .15 55) — legible on the dark ink card. */
    300: '#ffa156',
    /** oklch(.74 .17 55) — the accent itself. */
    500: '#fa8927',
    /** oklch(.5 .16 45) — accent as text on the cream canvas. */
    700: '#a83a00',
    /** Text placed ON the accent. Deliberately dark, not white. */
    onAccent: '#241403',
  },

  /**
   * Social: teal. The design uses it exclusively for the friend relationship —
   * friend ring on markers, friend price, friend card outline.
   */
  social: {
    /** oklch(.94 .03 190) */
    100: '#d6f2ef',
    /** oklch(.66 .12 190) */
    500: '#00a9a2',
    /** oklch(.5 .1 190) — the "AMIGO" label. */
    600: '#007570',
    /** oklch(.42 .1 190) — the friend price. */
    700: '#005d59',
    /** Text placed ON teal. */
    onSocial: '#04252b',
  },

  /** Blue appears only twice: the viewer's own location dot, and verified ticks. */
  info: {
    /** oklch(.6 .17 255) — location pulse. */
    500: '#2a80e2',
    /** oklch(.6 .14 255) — verified badge. */
    600: '#4081d2',
  },

  success: { 100: '#d6f2ef', 500: '#00a9a2', 700: '#005d59' },
  warning: { 100: '#fdeadb', 500: '#fa8927', 700: '#a83a00' },
  danger: { 100: '#fbdedd', 500: '#d33d38', 700: '#962a26' },
} as const;

/** Spacing scale, in px. Derived from the export's recurring paddings. */
export const space = {
  0: 0,
  1: 2,
  2: 4,
  3: 7,
  4: 10,
  5: 14,
  6: 16,
  7: 18,
  8: 22,
  9: 26,
  10: 34,
  11: 44,
  12: 62,
} as const;

/**
 * Corner radii, in px.
 *
 * The board's own note for 1a reads "Radio 28 · burbujas y pills", and the
 * export bears that out: nothing in this design is square. Even 96px thumbnails
 * carry a 20px radius.
 */
export const radius = {
  none: 0,
  /** Price bubble hanging off a marker. */
  xs: 14,
  /** Cluster bubbles on the search screen. */
  sm: 18,
  /** Product thumbnail inside a result card. */
  md: 20,
  /** Marker photo, dock FAB. */
  lg: 24,
  /** Result and detail cards. */
  xl: 26,
  /** Buttons, search bar, pills — the signature radius. */
  pill: 28,
  /** Bottom sheets and the floating dock. */
  sheet: 34,
  /** The device frame itself. */
  device: 42,
  full: 9999,
} as const;

/**
 * Two families, with distinct jobs.
 *
 * Bricolage Grotesque 800 is the "loud" face: the wordmark, prices, and section
 * counts ("37 cerca tuyo"). Archivo carries everything else. Mixing them is the
 * design's main typographic device, so `display` and `sans` are NOT
 * interchangeable.
 */
export const fontFamily = {
  display: "'Bricolage Grotesque', 'Archivo', system-ui, sans-serif",
  sans: "'Archivo', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  /** Countdowns and technical captions use a monospace face in the export. */
  numeric: "ui-monospace, Menlo, 'SF Mono', monospace",
} as const;

/** Font sizes, in px, taken from the export's literal values. */
export const fontSize = {
  '3xs': 7.5,
  '2xs': 9.5,
  xs: 10.5,
  sm: 11.5,
  base: 12.5,
  md: 14.5,
  lg: 15,
  xl: 19,
  '2xl': 21,
  '3xl': 30,
  '4xl': 34,
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  /** Bricolage's display weight. Prices and the wordmark only. */
  black: 800,
} as const;

export const lineHeight = {
  tight: 1,
  snug: 1.25,
  normal: 1.5,
  relaxed: 1.55,
} as const;

export const letterSpacing = {
  /** Bricolage display text is tracked in tightly. */
  tighter: '-0.03em',
  tight: '-0.02em',
  normal: '0',
  /** Uppercase micro-labels: "AMIGO", "SUBASTA", "BUSCA". */
  wide: '0.05em',
  wider: '0.08em',
} as const;

/**
 * Elevation.
 *
 * The export's shadows are consistently large, soft and NEGATIVE-spread — they
 * read as lift rather than as an outline. Markers additionally carry a solid
 * ring (see `ring` below), which is what keeps them legible over map tiles.
 */
export const shadow = {
  none: 'none',
  /** Filter chips floating over the map. */
  sm: '0 3px 10px -4px rgba(0, 0, 0, 0.2)',
  /** Result cards. */
  md: '0 4px 14px -8px rgba(0, 0, 0, 0.25)',
  /** Search bar, floating buttons. */
  lg: '0 6px 18px -6px rgba(0, 0, 0, 0.22)',
  /** Map markers. */
  marker: '0 8px 18px -6px rgba(0, 0, 0, 0.35)',
  /** The price bubble hanging off a marker. */
  bubble: '0 4px 10px -3px rgba(0, 0, 0, 0.4)',
  /** Bottom sheets, which cast upward. */
  sheet: '0 -12px 34px -12px rgba(0, 0, 0, 0.28)',
  /** The floating dock. */
  dock: '0 10px 28px -8px rgba(0, 0, 0, 0.3)',
} as const;

/**
 * Solid rings. Distinct from shadows: these are what separate a marker from the
 * map underneath, and what encodes relationship (a teal ring means "friend").
 */
export const ring = {
  /** Default marker ring — white, 3px. */
  marker: '0 0 0 3px #ffffff',
  /** Cluster halo, a translucent ink glow. */
  cluster: '0 0 0 6px rgba(20, 18, 16, 0.14)',
  clusterSm: '0 0 0 5px rgba(20, 18, 16, 0.13)',
  /** Inset hairline used instead of a border on light surfaces. */
  hairline: 'inset 0 0 0 1px rgba(0, 0, 0, 0.05)',
  hairlineStrong: 'inset 0 0 0 1.5px rgba(0, 0, 0, 0.14)',
} as const;

export const borderWidth = {
  none: 0,
  hairline: 1,
  thick: 1.5,
  ring: 3,
} as const;

export const duration = {
  instant: 0,
  fast: 120,
  normal: 200,
  slow: 320,
  /** The location dot's pulse, straight from the export's keyframes. */
  pulse: 2400,
} as const;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0.2, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

export const zIndex = {
  base: 0,
  map: 10,
  mapMarker: 20,
  mapMarkerActive: 30,
  overlayControls: 40,
  bottomSheet: 50,
  header: 60,
  dock: 65,
  modal: 70,
  toast: 80,
} as const;

export const breakpoint = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

/**
 * Map marker geometry, measured from the export.
 *
 * 1a's marker is a photo thumbnail with the price bubble hanging off its bottom
 * edge (overlapping by 9px) and a caption underneath — not a text pill. The
 * overlap is what makes it read as one object.
 */
export const marker = {
  /** Marker photo on the map screen. */
  thumbSize: 62,
  thumbRadius: 24,
  /** How far the price bubble overlaps the photo above it. */
  bubbleOverlap: 9,
  bubbleRadius: 14,
  /** Cluster bubbles on the map screen. */
  clusterSizeSm: 40,
  clusterSizeMd: 52,
  clusterSizeLg: 62,
  /** Cluster bubbles on the search screen are squircles, not circles. */
  searchClusterSize: 44,
  searchClusterRadius: 18,
  /** The viewer's own location dot. */
  locationDotSize: 18,
} as const;

/**
 * Chrome dimensions taken from the export, so screens do not re-derive them.
 */
export const layout = {
  /** Reference device the design was drawn at. */
  deviceWidth: 390,
  deviceHeight: 844,
  statusBarHeight: 44,
  searchBarHeight: 50,
  /** Floating dock — it is inset from the edges, not flush. */
  dockHeight: 70,
  dockInset: 14,
  dockBottom: 34,
  dockFabSize: 58,
  navIconSize: 22,
  /** Circular icon buttons floating over the map. */
  floatingButtonSize: 44,
  /** Primary CTA height on the product screen. */
  ctaHeight: 56,
  /** Result card thumbnail. */
  cardThumbSize: 96,
  homeIndicatorWidth: 120,
} as const;

/**
 * Map tile treatment.
 *
 * The export desaturates and warms OpenStreetMap tiles so the markers stay the
 * loudest thing on screen. Without this the map competes with its own content.
 * `tint` is an accent wash laid over the tiles at 7%.
 */
export const mapTiles = {
  filter: 'saturate(0.55) contrast(0.96) brightness(1.04)',
  /** Search and product screens sit under more chrome, so tiles go quieter. */
  filterQuiet: 'saturate(0.4) contrast(0.95) brightness(1.05)',
  tintOpacity: 0.07,
  /**
   * Dark-mode candidate from the bundle's `tile-test.html`. NOT yet approved —
   * see `docs/design-audit.md` before shipping it.
   */
  filterDarkCandidate: 'invert(1) hue-rotate(180deg) saturate(0.55) brightness(0.9) contrast(1.05)',
} as const;

/** Minimum interactive target, in px. */
export const touchTarget = {
  min: 44,
  comfortable: 50,
} as const;
