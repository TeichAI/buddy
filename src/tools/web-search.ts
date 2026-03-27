const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; buddy/0.1; +https://duckduckgo.com/html)";
const MAX_RESULTS = 3;
const MAX_SNIPPET_CHARS = 220;
const MAX_PAGE_EXTRACT_CHARS = 1400;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface PageExtract {
  title: string;
  url: string;
  text: string;
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "--",
    hellip: "..."
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return namedEntities[normalized] ?? match;
  });
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(value: string): string {
  const withoutNonContent = value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/section|\/article|\/h[1-6]|\/ul|\/ol|\/pre|\/blockquote|\/main|\/header|\/footer|\/nav)\b[^>]*>/gi, "\n");

  return normalizeWhitespace(decodeHtmlEntities(withoutNonContent.replace(/<[^>]+>/g, " ")));
}

function singleLineText(value: string, maxChars: number): string {
  const text = stripHtml(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function pageText(value: string, maxChars: number): string {
  const text = stripHtml(value);
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function resolveDuckDuckGoUrl(rawHref: string): string {
  const decodedHref = decodeHtmlEntities(rawHref).trim();
  const normalizedHref = decodedHref.startsWith("//") ? `https:${decodedHref}` : decodedHref;

  try {
    const url = new URL(normalizedHref, DUCKDUCKGO_HTML_URL);
    const redirectedUrl = url.searchParams.get("uddg");
    if (redirectedUrl) {
      return decodeURIComponent(redirectedUrl);
    }

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    return normalizedHref;
  }

  return normalizedHref;
}

function extractPageTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) {
    return undefined;
  }

  const title = singleLineText(titleMatch[1], 160);
  return title || undefined;
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const titleRegex =
    /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(titleRegex));
  const results: SearchResult[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match.index === undefined) {
      continue;
    }

    const segment = html.slice(match.index, matches[index + 1]?.index ?? html.length);
    const snippetMatch = segment.match(
      /<[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i
    );
    const title = singleLineText(match[3], 160);
    const url = resolveDuckDuckGoUrl(match[2]);
    const snippet = snippetMatch ? singleLineText(snippetMatch[1], MAX_SNIPPET_CHARS) : "";

    if (!title || !/^https?:\/\//i.test(url)) {
      continue;
    }

    results.push({ title, url, snippet });
    if (results.length >= MAX_RESULTS) {
      break;
    }
  }

  return results;
}

async function fetchText(url: string): Promise<{ url: string; contentType: string; body: string }> {
  const response = await fetch(url, {
    headers: {
      "user-agent": DEFAULT_USER_AGENT,
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1"
    },
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return {
    url: response.url || url,
    contentType: response.headers.get("content-type") || "",
    body: await response.text()
  };
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = new URL(DUCKDUCKGO_HTML_URL);
  url.searchParams.set("q", query);

  const response = await fetchText(url.toString());
  return parseDuckDuckGoResults(response.body);
}

async function fetchPageExtract(result: SearchResult): Promise<PageExtract> {
  const response = await fetchText(result.url);
  const contentType = response.contentType.toLowerCase();
  const text = contentType.startsWith("text/plain")
    ? normalizeWhitespace(response.body)
    : pageText(response.body, MAX_PAGE_EXTRACT_CHARS);

  return {
    title: extractPageTitle(response.body) || result.title,
    url: response.url,
    text: text || "(No readable text found.)"
  };
}

export async function webSearchTool(query: string): Promise<string> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error('Tool argument "query" must be a non-empty string.');
  }

  const results = await searchDuckDuckGo(normalizedQuery);
  if (results.length === 0) {
    return `Web search found no DuckDuckGo HTML results for "${normalizedQuery}".`;
  }

  const pageExtracts = await Promise.all(
    results.map(async (result) => {
      try {
        return await fetchPageExtract(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          title: result.title,
          url: result.url,
          text: `Failed to fetch page text: ${message}`
        };
      }
    })
  );

  const lines = [`Web search results for "${normalizedQuery}":`, "", "DuckDuckGo results:"];

  results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`URL: ${result.url}`);
    if (result.snippet) {
      lines.push(`Snippet: ${result.snippet}`);
    }
    lines.push("");
  });

  lines.push("Page text from the top results:");

  pageExtracts.forEach((page, index) => {
    lines.push(`${index + 1}. ${page.title}`);
    lines.push(`URL: ${page.url}`);
    lines.push(page.text);
    lines.push("");
  });

  return lines.join("\n").trim();
}
