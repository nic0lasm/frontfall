import type { Balance } from "../src/balance.ts";

/**
 * Tile prices in whole troops for tests that count them: 10 troops a tile of
 * plains (20 and 30 for hills and mountains), plus the defender's soldiers
 * per tile, whatever the odds and the sizes.
 */
export const WHOLE_PRICES: Partial<Balance> = {
  tileWeightTenths: [100, 200, 300],
  neutralSharePercent: 100,
  botNeutralSharePercent: 100,
  lossBaseThousandths: 1000,
  lossDensityThousandths: 100,
  oddsMinPercent: 100,
  oddsMaxPercent: 100,
  largeAttackerPercent: 0,
  largeDefenderPercent: 0,
  botDefensePercent: 100,
};
