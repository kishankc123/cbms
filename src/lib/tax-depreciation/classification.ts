// Which tax class an accounting category normally belongs to. Only a starting point: whoever sets up tax depreciation confirms or changes it,
// and anything the names don't clearly place is marked for review.

export type DefaultClass = { poolKey: string | null; needsReview: boolean; reason: string };

const has = (name: string, words: string[]) => words.some((w) => name.includes(w));

/** The Nepal default for a category name (Income Tax Act 2058, Schedule 2). */
export function defaultNepalClass(categoryName: string): DefaultClass {
  const n = categoryName.toLowerCase();
  if (has(n, ["land"]) && !has(n, ["landscap"])) return { poolKey: null, needsReview: false, reason: "Land is not depreciated." };
  if (has(n, ["intangible", "software", "licen", "patent", "trademark", "goodwill", "copyright"])) return { poolKey: "E", needsReview: false, reason: "Intangible assets are each their own class." };
  if (has(n, ["building", "structure"])) return { poolKey: "A", needsReview: false, reason: "Buildings and permanent structures." };
  if (has(n, ["construction", "excavation"])) return { poolKey: "D", needsReview: false, reason: "Construction and excavation equipment." };
  if (has(n, ["vehicle", "automobile", "car", "bus", "minibus", "truck"])) return { poolKey: "C", needsReview: false, reason: "Automobiles, buses and minibuses." };
  if (has(n, ["computer", "it equipment", "data processing", "furniture", "fixture", "office"])) return { poolKey: "B", needsReview: false, reason: "Computers, furniture and office equipment." };
  if (has(n, ["machinery", "plant"])) return { poolKey: "D", needsReview: false, reason: "Other qualifying tangible depreciable assets." };
  return { poolKey: "D", needsReview: true, reason: "The name doesn't clearly match a class, so it starts as Class D for review." };
}
