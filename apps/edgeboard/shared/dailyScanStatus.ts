export type ScanSourceHealth = {
  source: string;
  status: string;
  retrievedAt?: string | null;
};

export type ScanSportHealth = {
  status: string;
  sourceHealth?: ScanSourceHealth[];
};

/** Data availability is independent of model or wager approval. */
export function dailyScanStatus(
  sports: ScanSportHealth[],
  priceCount: number,
  candidateCount = 0,
) {
  const sources = sports.flatMap((sport) =>
    sport.sourceHealth?.length
      ? sport.sourceHealth
      : sport.status === 'UNAVAILABLE'
        ? [{ source: 'Sport scan', status: 'UNAVAILABLE' }]
        : [],
  );
  const unavailableSources = sources.filter(
    (source) => source.status === 'UNAVAILABLE',
  ).length;
  const retrievedSources = sources.filter(
    (source) => source.status === 'RETRIEVED',
  ).length;
  const unsupportedSources = sources.filter(
    (source) => source.status === 'SPORT_UNSUPPORTED',
  ).length;
  const unknownSources = sports.reduce((sum, sport) => {
    if (!sport.sourceHealth?.length) return sum + (sport.status === 'UNAVAILABLE' ? 0 : 1);
    return sum + sport.sourceHealth.filter(source =>
      !['RETRIEVED', 'UNAVAILABLE', 'SPORT_UNSUPPORTED'].includes(source.status)
    ).length;
  }, 0);
  const evidence = { unavailableSources, retrievedSources, unsupportedSources, unknownSources };

  if (candidateCount > 0) {
    return {
      ...evidence,
      status: 'CANDIDATES_REQUIRE_VERIFICATION',
      title: 'HOLD — research candidates need verification',
      description:
        'Research candidates were returned. Account-specific prices, model approval, uncertainty and settlement rules still need verification before wagering.',
    };
  }
  if (priceCount > 0) {
    return {
      ...evidence,
      status: 'RESEARCH_ONLY',
      title: 'HOLD — prices need verification',
      description:
        'Public prices were returned for research. Betting value is not established. Review the independent model evidence and exact account offer; quote freshness, uncertainty and settlement checks remain required.',
    };
  }
  if ((sports.length === 0 || unknownSources > 0) && retrievedSources === 0) {
    return {
      ...evidence,
      status: 'DATA_UNAVAILABLE',
      title: 'HOLD — scan evidence incomplete',
      description:
        'Source diagnostics are missing or unrecognized. Retry the scan before interpreting an empty board as no available prices or drawing a model conclusion.',
    };
  }
  if (unavailableSources > 0 && retrievedSources === 0) {
    return {
      ...evidence,
      status: 'SOURCE_UNAVAILABLE',
      title: 'HOLD — research sources unavailable',
      description:
        'The available feeds failed to return usable data for this selection. Retry the scan or inspect source status below. A failed source request is not evidence that no worthwhile opportunities exist.',
    };
  }
  if (unsupportedSources > 0 && retrievedSources === 0) {
    return {
      ...evidence,
      status: 'UNSUPPORTED',
      title: 'HOLD — public source coverage unavailable',
      description:
        'The scanned sources do not support this selection. No upcoming prices were returned; model performance and betting value were not evaluated.',
    };
  }
  return {
    ...evidence,
    status: 'NO_UPCOMING_PRICES',
    title: 'HOLD — no upcoming public prices returned',
    description:
      'No usable upcoming price examples were returned for this selection and scan window. Check the sport filter or retry later. This is a data-coverage result, not a profitability assessment.',
  };
}
