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

function findBestMatch(query, items, options = {}) {
  const threshold = options.threshold ?? 0.55;
  const scored = items
    .map((item) => ({
      item,
      score: scoreCandidate(query, item.matchText || item.title || ""),
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
