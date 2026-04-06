function normalizeText(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a) {
    return b.length;
  }

  if (!b) {
    return a.length;
  }

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let row = 0; row <= a.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= b.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function scoreCandidate(query, candidate) {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);

  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  if (normalizedQuery === normalizedCandidate) {
    return 1;
  }

  if (normalizedCandidate.includes(normalizedQuery)) {
    return 0.96;
  }

  if (normalizedQuery.includes(normalizedCandidate)) {
    return 0.9;
  }

  const queryTokens = normalizedQuery.split(" ");
  const candidateTokens = normalizedCandidate.split(" ");
  const intersection = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  const tokenScore = intersection / Math.max(queryTokens.length, candidateTokens.length, 1);

  const distance = levenshtein(normalizedQuery, normalizedCandidate);
  const length = Math.max(normalizedQuery.length, normalizedCandidate.length, 1);
  const similarity = 1 - distance / length;

  return Number(Math.max(tokenScore * 0.7 + similarity * 0.3, similarity * 0.75).toFixed(2));
}

function computeRecencyBoost(timestamp) {
  if (!timestamp) {
    return 0;
  }

  const ageHours = Math.max((Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60), 0);
  if (ageHours <= 1) {
    return 0.08;
  }
  if (ageHours <= 24) {
    return 0.05;
  }
  if (ageHours <= 24 * 7) {
    return 0.02;
  }
  return 0;
}

function computeEntityBoost(query, item) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedQuery.includes("note") && item.entityType === "note") {
    return 0.08;
  }
  if ((normalizedQuery.includes("remind") || normalizedQuery.includes("reminder")) && item.entityType === "reminder") {
    return 0.08;
  }
  if ((normalizedQuery.includes("habit") || normalizedQuery.includes("task")) && item.entityType === "habit") {
    return 0.08;
  }
  return 0;
}

function findBestMatch(query, items, options = {}) {
  const threshold = options.threshold ?? 0.55;
  const scored = items
    .map((item) => ({
      item,
      score: Number(
        Math.min(
          scoreCandidate(query, item.matchText || item.title || "") +
            computeRecencyBoost(item.timestamp) +
            computeEntityBoost(query, item) +
            Number(item.frequencyBoost || 0),
          1
        ).toFixed(2)
      ),
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  if (!best || best.score < threshold) {
    return null;
  }

  return {
    ...best,
    fuzzyMatched: best.score < 0.999,
    candidates: scored.slice(0, 3),
  };
}

module.exports = {
  findBestMatch,
  normalizeText,
  scoreCandidate,
};
