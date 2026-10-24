/**
 * Odds conversion utilities
 * Handles American odds to decimal and implied probability conversions
 */

function americanToImpliedProb(odds) {
  if (odds == null || Number.isNaN(Number(odds))) return null;
  const value = Number(odds);
  return value > 0 ? 100 / (value + 100) : Math.abs(value) / (Math.abs(value) + 100);
}

function americanToDecimal(odds) {
  const value = Number(odds);
  return value > 0 ? 1 + (value / 100) : 1 + (100 / Math.abs(value));
}

module.exports = {
  americanToImpliedProb,
  americanToDecimal
};
