// Used only by the calendar cross-check tests.
declare module "@remotemerge/nepali-date-converter" {
  type Converted = { year: number; month: number; date: number; day: string };
  export default class DateConverter {
    constructor(dateInput: string);
    toAd(): Converted;
    toBs(): Converted;
  }
}
