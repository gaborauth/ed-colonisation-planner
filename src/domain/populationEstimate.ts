// ILLUSTRATIVE ONLY. Update 3 (and the original colonisation-beta patch) describe population now
// growing "at a significantly faster rate with a significantly higher population limit," on
// weekly maintenance ticks, "quickly for the first month before slowing to a more gradual pace" —
// but no official growth formula or curve shape was published anywhere in the patch notes this
// project has access to. This is a shaped curve (exponential approach to a ceiling) picked only to
// match that qualitative "fast then slowing" description, parameterized by the solver's own
// `initial_population_increase`/`max_population_increase` scores as stand-ins for a floor/ceiling.
// It is NOT a verified simulation — do not treat any number here as a real prediction. Revise or
// replace entirely if an official formula ever surfaces.

// Tuned so ~80% of the initial->max gap closes by week 4 ("the first month"), then the remainder
// closes gradually — the only free parameter in this admittedly invented shape.
const ILLUSTRATIVE_GROWTH_RATE_PER_WEEK = -Math.log(0.2) / 4;

export interface PopulationWeekEstimate {
  week: number;
  estimatedPopulation: number;
}

export function estimateIllustrativePopulationCurve(
  initialPopulationIncreaseScore: number,
  maxPopulationIncreaseScore: number,
  weeks = 12,
): PopulationWeekEstimate[] {
  const initial = Math.max(0, initialPopulationIncreaseScore);
  const max = Math.max(initial, maxPopulationIncreaseScore);
  const gap = max - initial;

  const curve: PopulationWeekEstimate[] = [];
  for (let week = 0; week <= weeks; week++) {
    const estimatedPopulation = max - gap * Math.exp(-ILLUSTRATIVE_GROWTH_RATE_PER_WEEK * week);
    curve.push({ week, estimatedPopulation: Math.round(estimatedPopulation * 100) / 100 });
  }
  return curve;
}
