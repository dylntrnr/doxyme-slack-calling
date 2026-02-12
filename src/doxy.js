function normalizeDoxyUrl(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch (err) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith("doxy.me")) return null;

  return parsed.toString();
}

module.exports = {
  normalizeDoxyUrl
};
