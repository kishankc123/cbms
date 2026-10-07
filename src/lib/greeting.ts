// "Good morning, Kishan": the greeting follows the hour in Nepal (the server may run in another time zone).

export function greetingFor(date: Date, timeZone = "Asia/Kathmandu"): "Good morning" | "Good afternoon" | "Good evening" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(date));
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}
