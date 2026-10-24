/**
 * Date parsing utilities
 * Safe date/time parser for game time sorting
 */

function parseDateTimeString(dateStr, timeStr) {
  // dateStr format: "MM/DD/YY" (e.g., "04/22/26")
  // timeStr format: "HH:MM AM/PM" (e.g., "02:30 PM")
  // Convert to ISO datetime for proper parsing
  
  const [month, day, year] = dateStr.split('/');
  // Handle 2-digit year: 00-30 = 2000-2030, 31-99 = 1931-1999
  const yearFull = parseInt(year) <= 30 ? `20${year}` : `19${year}`;
  
  // Parse 12-hour time to 24-hour format
  let [hours, minutes] = timeStr.split(' ')[0].split(':');
  const period = timeStr.split(' ')[1]; // 'AM' or 'PM'
  
  hours = parseInt(hours);
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  
  hours = String(hours).padStart(2, '0');
  
  // Construct ISO datetime string (local time, not UTC)
  const isoString = `${yearFull}-${month}-${day}T${hours}:${minutes}:00`;
  return new Date(isoString);
}

module.exports = {
  parseDateTimeString
};
