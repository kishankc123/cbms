// Each country's usual currency, so "Add new country" can suggest one (the platform administrator can still change it).
// Grouped by currency: the codes after the colon are the countries (ISO 3166-1 alpha-2) that use it.
const BY_CURRENCY =
  "EUR:AD AT AX BE BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA YT BG|" +
  "USD:AS BQ EC FM GU IO MH MP PR PW SV TC TL UM US VG VI|XOF:BJ BF CI GW ML NE SN TG|XAF:CM CF TD CG GQ GA|XCD:AI AG DM GD MS KN LC VC|" +
  "AUD:AU CC CX HM KI NF NR TV|NZD:NZ CK NU PN TK|NOK:NO BV SJ|DKK:DK FO GL|GBP:GB GG IM JE GS|CHF:CH LI|ANG:CW SX|XPF:PF NC WF|ILS:IL PS|MAD:MA EH|" +
  "AFN:AF|ALL:AL|DZD:DZ|AOA:AO|ARS:AR|AMD:AM|AWG:AW|AZN:AZ|BSD:BS|BHD:BH|BDT:BD|BBD:BB|BYN:BY|BZD:BZ|BMD:BM|BTN:BT|BOB:BO|BAM:BA|BWP:BW|BRL:BR|BND:BN|BIF:BI|CVE:CV|KHR:KH|CAD:CA|KYD:KY|" +
  "CLP:CL|CNY:CN|COP:CO|KMF:KM|CDF:CD|CRC:CR|CUP:CU|CZK:CZ|DJF:DJ|DOP:DO|EGP:EG|ERN:ER|SZL:SZ|ETB:ET|FKP:FK|FJD:FJ|GMD:GM|GEL:GE|GHS:GH|GIP:GI|GTQ:GT|GNF:GN|GYD:GY|HTG:HT|HNL:HN|HKD:HK|HUF:HU|" +
  "ISK:IS|INR:IN|IDR:ID|IRR:IR|IQD:IQ|JMD:JM|JPY:JP|JOD:JO|KZT:KZ|KES:KE|KPW:KP|KRW:KR|KWD:KW|KGS:KG|LAK:LA|LBP:LB|LSL:LS|LRD:LR|LYD:LY|MOP:MO|MGA:MG|MWK:MW|MYR:MY|MVR:MV|MRU:MR|MUR:MU|MXN:MX|" +
  "MDL:MD|MNT:MN|MZN:MZ|MMK:MM|NAD:NA|NPR:NP|NIO:NI|NGN:NG|MKD:MK|OMR:OM|PKR:PK|PAB:PA|PGK:PG|PYG:PY|PEN:PE|PHP:PH|PLN:PL|QAR:QA|RON:RO|RUB:RU|RWF:RW|SHP:SH|WST:WS|STN:ST|SAR:SA|RSD:RS|SCR:SC|" +
  "SLE:SL|SGD:SG|SBD:SB|SOS:SO|ZAR:ZA|SSP:SS|LKR:LK|SDG:SD|SRD:SR|SEK:SE|SYP:SY|TWD:TW|TJS:TJ|TZS:TZ|THB:TH|TOP:TO|TTD:TT|TND:TN|TRY:TR|TMT:TM|UGX:UG|UAH:UA|AED:AE|UYU:UY|UZS:UZ|VUV:VU|VES:VE|" +
  "VND:VN|YER:YE|ZMW:ZM|ZWG:ZW";

const CURRENCY_OF = new Map(BY_CURRENCY.split("|").flatMap((g) => {
  const [currency, codes] = g.split(":");
  return codes.split(" ").map((code) => [code, currency] as const);
}));

export const suggestedCurrency = (code: string) => CURRENCY_OF.get(code) ?? "";
/** Statutory periods are counted in BS in Nepal and in AD everywhere else. */
export const suggestedCalendar = (code: string): "AD" | "BS" => (code === "NP" ? "BS" : "AD");
