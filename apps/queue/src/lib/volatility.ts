const INTERVAL_TIERS = [
    5, 10, 30, 60, 300, 900, 1800, 3600, 21600, 43200, 86400,
];

export function computeVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (mean === 0) return 0;

    const variance =
        prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
    const stddev = Math.sqrt(variance);

    return stddev / mean; // coefficient of variation
}

export function getAdjustedIntervalTier(
    baseIntervalSeconds: number,
    cv: number,
): number {
    const baseTierIndex = INTERVAL_TIERS.indexOf(baseIntervalSeconds);
    const effectiveBase =
        baseTierIndex === -1
            ? INTERVAL_TIERS.indexOf(
                  INTERVAL_TIERS.find((t) => t >= baseIntervalSeconds) ??
                      INTERVAL_TIERS[INTERVAL_TIERS.length - 1],
              )
            : baseTierIndex;

    let targetIndex: number;

    if (cv > 0.02) {
        // Volatile: stay at base tier
        targetIndex = effectiveBase;
    } else if (cv < 0.005) {
        // Very stable: move 2 tiers slower
        targetIndex = Math.min(effectiveBase + 2, INTERVAL_TIERS.length - 1);
    } else {
        // Moderate stability: move 1 tier slower
        targetIndex = Math.min(effectiveBase + 1, INTERVAL_TIERS.length - 1);
    }

    // Cap at 4 tiers above base
    targetIndex = Math.min(targetIndex, effectiveBase + 4);

    return INTERVAL_TIERS[targetIndex];
}
