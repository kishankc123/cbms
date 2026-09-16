/**
 * Nepali (Bikram Sambat) fiscal years run Shrawan 1 to Ashad end, so a fiscal
 * year always spans two consecutive BS years — e.g. "2081/82". This generates
 * that label format for a range of years for use in a select input.
 */
export function generateFiscalYearOptions(startBsYear = 2075, count = 25): string[] {
  return Array.from({ length: count }, (_, i) => {
    const year = startBsYear + i;
    return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
  });
}
