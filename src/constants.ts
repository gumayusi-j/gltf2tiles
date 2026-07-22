/**
 * WGS84 ellipsoid constants (EPSG:4326).
 * Used for geodetic → ECEF coordinate transforms.
 */
export const WGS84 = {
  /** Semi-major axis (meters) */
  A: 6378137.0,
  /** Flattening */
  F: 1.0 / 298.257223563,
} as const;

export const WGS84_E2 = WGS84.F * (2.0 - WGS84.F);

/** Default tile config */
export const DEFAULTS = {
  maxItemsPerTile: 1000,
  maxDepth: 8,
  lodLevels: 1,
  simplifyRatio: 0.5,
  simplifyError: 0.01,
  subtreeLevels: 5,
  ktx2Quality: 128,
} as const;
