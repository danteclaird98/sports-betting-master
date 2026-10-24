/**
 * Formatting utilities
 * Handles game dates, signal labels, sport emojis, and formatting
 */

function formatGameDateTime(dateString, timezone = 'America/New_York') {
  const date = new Date(dateString);
  
  // Ensure valid date
  if (isNaN(date.getTime())) {
    return { gameDate: 'N/A', gameTime: 'N/A' };
  }
  
  try {
    const gameDate = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: '2-digit',
      day: '2-digit',
      year: '2-digit'
    }).format(date);
    
    const gameTime = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date);
    
    return { gameDate, gameTime };
  } catch (err) {
    console.error('Error formatting date:', err.message);
    return { gameDate: 'N/A', gameTime: 'N/A' };
  }
}

function getOutcomeKey(outcome, market) {
  if (market === 'spreads' || market === 'totals') {
    return `${outcome.name}|${outcome.point ?? ''}`;
  }
  return `${outcome.name}`;
}

function formatSignalLabel(outcome, market) {
  if (market === 'spreads' && outcome.point != null) {
    const point = Number(outcome.point);
    return `${outcome.name} ${point > 0 ? '+' : ''}${point}`;
  }
  if (market === 'totals' && outcome.point != null) {
    return `${outcome.name} ${outcome.point}`;
  }
  return outcome.name;
}

function getSportEmoji(sport) {
  if (!sport) return '🏆';
  const sportLower = sport.toLowerCase();
  if (sportLower.includes('nba') || sportLower.includes('basketball')) return '🏀';
  if (sportLower.includes('nfl') || sportLower.includes('football')) return '🏈';
  if (sportLower.includes('mlb') || sportLower.includes('baseball')) return '⚾';
  if (sportLower.includes('nhl') || sportLower.includes('hockey')) return '🏒';
  if (sportLower.includes('tennis') || sportLower.includes('atp')) return '🎾';
  if (sportLower.includes('soccer') || sportLower.includes('epl')) return '⚽';
  return '🏆';
}

module.exports = {
  formatGameDateTime,
  getOutcomeKey,
  formatSignalLabel,
  getSportEmoji
};
