/**
 * Client-side citation URL resolver
 *
 * Constructs BAILII and FCL URLs for neutral citations entirely in the browser.
 * No server call needed for URL construction - only for CORS-proxied fetching.
 *
 * PRIVACY: This runs entirely in the browser. No data leaves the device.
 */

export interface ResolvedUrl {
  url: string;
  source: 'bailii' | 'fcl';
  confidence: number;
}

export interface CitationResolution {
  citation: string;
  caseName?: string;
  urls: ResolvedUrl[];
  isNeutralCitation: boolean;
}

// BAILII URL templates for neutral citations
const BAILII_PATTERNS: Record<string, { pattern: RegExp; template: string }> = {
  uksc: {
    pattern: /\[(\d{4})\]\s+UKSC\s+(\d+)/i,
    template: 'https://www.bailii.org/uk/cases/UKSC/{year}/{num}.html',
  },
  ukpc: {
    pattern: /\[(\d{4})\]\s+UKPC\s+(\d+)/i,
    template: 'https://www.bailii.org/uk/cases/UKPC/{year}/{num}.html',
  },
  ukhl: {
    pattern: /\[(\d{4})\]\s+UKHL\s+(\d+)/i,
    template: 'https://www.bailii.org/uk/cases/UKHL/{year}/{num}.html',
  },
  ewca_civ: {
    pattern: /\[(\d{4})\]\s+EWCA\s+Civ\s+(\d+)/i,
    template: 'https://www.bailii.org/ew/cases/EWCA/Civ/{year}/{num}.html',
  },
  ewca_crim: {
    pattern: /\[(\d{4})\]\s+EWCA\s+Crim\s+(\d+)/i,
    template: 'https://www.bailii.org/ew/cases/EWCA/Crim/{year}/{num}.html',
  },
  ewhc_admin: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Admin\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/Admin/{year}/{num}.html',
  },
  ewhc_ch: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Ch\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/Ch/{year}/{num}.html',
  },
  ewhc_qb: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(QB\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/QB/{year}/{num}.html',
  },
  ewhc_kb: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(KB\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/KB/{year}/{num}.html',
  },
  ewhc_fam: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Fam\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/Fam/{year}/{num}.html',
  },
  ewhc_tcc: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(TCC\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/TCC/{year}/{num}.html',
  },
  ewhc_comm: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Comm\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/Comm/{year}/{num}.html',
  },
  ewhc_pat: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Pat\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/Patents/{year}/{num}.html',
  },
  ukut_iac: {
    pattern: /\[(\d{4})\]\s+UKUT\s+(\d+)\s+\(IAC\)/i,
    template: 'https://www.bailii.org/uk/cases/UKUT/IAC/{year}/{num}.html',
  },
  ukut_lc: {
    pattern: /\[(\d{4})\]\s+UKUT\s+(\d+)\s+\(LC\)/i,
    template: 'https://www.bailii.org/uk/cases/UKUT/LC/{year}/{num}.html',
  },
  ukftt_tc: {
    pattern: /\[(\d{4})\]\s+UKFTT\s+(\d+)\s+\(TC\)/i,
    template: 'https://www.bailii.org/uk/cases/UKFTT/TC/{year}/{num}.html',
  },
  eat: {
    pattern: /\[(\d{4})\]\s+(?:UK)?EAT\s+(\d+)/i,
    template: 'https://www.bailii.org/uk/cases/UKEAT/{year}/{num}.html',
  },
  // Court of Protection
  ewcop: {
    pattern: /\[(\d{4})\]\s+EWCOP\s+(\d+)/i,
    template: 'https://www.bailii.org/ew/cases/EWCOP/{year}/{num}.html',
  },
  // Family Court
  ewfc: {
    pattern: /\[(\d{4})\]\s+EWFC\s+(\d+)/i,
    template: 'https://www.bailii.org/ew/cases/EWFC/{year}/{num}.html',
  },
  // EWHC Admiralty
  ewhc_admlty: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Adm(?:lty|iralty)\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/Admiralty/{year}/{num}.html',
  },
  // EWHC Mercantile / Business & Property
  ewhc_mercantile: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Mercantile\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/Mercantile/{year}/{num}.html',
  },
  // EWHC IPEC
  ewhc_ipec: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(IPEC\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/IPEC/{year}/{num}.html',
  },
  // EWHC Costs
  ewhc_costs: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Costs\)/i,
    template: 'https://www.bailii.org/ew/cases/EWHC/Costs/{year}/{num}.html',
  },
  // Northern Ireland courts
  nica: {
    pattern: /\[(\d{4})\]\s+NICA\s+(\d+)/i,
    template: 'https://www.bailii.org/nie/cases/NICA/{year}/{num}.html',
  },
  niqb: {
    pattern: /\[(\d{4})\]\s+NIQB\s+(\d+)/i,
    template: 'https://www.bailii.org/nie/cases/NIQB/{year}/{num}.html',
  },
  // UKFTT GRC
  ukftt_grc: {
    pattern: /\[(\d{4})\]\s+UKFTT\s+(\d+)\s+\(GRC\)/i,
    template: 'https://www.bailii.org/uk/cases/UKFTT/GRC/{year}/{num}.html',
  },
};

// FCL URL templates (fallback)
const FCL_PATTERNS: Record<string, { pattern: RegExp; template: string }> = {
  uksc: {
    pattern: /\[(\d{4})\]\s+UKSC\s+(\d+)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/uksc/{year}/{num}/data.xml',
  },
  ukpc: {
    pattern: /\[(\d{4})\]\s+UKPC\s+(\d+)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ukpc/{year}/{num}/data.xml',
  },
  ukhl: {
    pattern: /\[(\d{4})\]\s+UKHL\s+(\d+)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ukhl/{year}/{num}/data.xml',
  },
  ewca_civ: {
    pattern: /\[(\d{4})\]\s+EWCA\s+Civ\s+(\d+)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/{year}/{num}/data.xml',
  },
  ewca_crim: {
    pattern: /\[(\d{4})\]\s+EWCA\s+Crim\s+(\d+)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewca/crim/{year}/{num}/data.xml',
  },
  ewhc_admin: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Admin\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewhc/admin/{year}/{num}/data.xml',
  },
  ewhc_ch: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Ch\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewhc/ch/{year}/{num}/data.xml',
  },
  ewhc_qb: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(QB\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewhc/qb/{year}/{num}/data.xml',
  },
  ewhc_kb: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(KB\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewhc/kb/{year}/{num}/data.xml',
  },
  ewhc_fam: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Fam\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewhc/fam/{year}/{num}/data.xml',
  },
  ewhc_tcc: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(TCC\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewhc/tcc/{year}/{num}/data.xml',
  },
  ewhc_comm: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Comm\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewhc/comm/{year}/{num}/data.xml',
  },
  ewhc_pat: {
    pattern: /\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Pat\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewhc/pat/{year}/{num}/data.xml',
  },
  ukut_iac: {
    pattern: /\[(\d{4})\]\s+UKUT\s+(\d+)\s+\(IAC\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ukut/iac/{year}/{num}/data.xml',
  },
  ukut_lc: {
    pattern: /\[(\d{4})\]\s+UKUT\s+(\d+)\s+\(LC\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ukut/lc/{year}/{num}/data.xml',
  },
  eat: {
    pattern: /\[(\d{4})\]\s+(?:UK)?EAT\s+(\d+)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/eat/{year}/{num}/data.xml',
  },
  ewcop: {
    pattern: /\[(\d{4})\]\s+EWCOP\s+(\d+)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewcop/{year}/{num}/data.xml',
  },
  ewfc: {
    pattern: /\[(\d{4})\]\s+EWFC\s+(\d+)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ewfc/{year}/{num}/data.xml',
  },
  ukftt_grc: {
    pattern: /\[(\d{4})\]\s+UKFTT\s+(\d+)\s+\(GRC\)/i,
    template: 'https://caselaw.nationalarchives.gov.uk/ukftt/grc/{year}/{num}/data.xml',
  },
};

// Traditional law report patterns (these need server-side search, no direct URL)
const TRADITIONAL_PATTERNS = [
  /\[\d{4}\]\s*\d*\s*(?:AC|QB|KB|Ch|Fam)\s+\d+/i,
  /\[\d{4}\]\s*\d+\s+WLR\s+\d+/i,
  /\[\d{4}\]\s*\d+\s+All\s+ER\s+\d+/i,
  /\[\d{4}\]\s*\d+\s+Lloyd's\s+Rep\s+\d+/i,
  /\[\d{4}\]\s*\d+\s+FLR\s+\d+/i,
  /\[\d{4}\]\s*\d+\s+Cr\s+App\s+R\s+\d+/i,
  /\[\d{4}\]\s*\d*\s*ICR\s+\d+/i,
  /\[\d{4}\]\s*\d*\s*IRLR\s+\d+/i,
  /\[\d{4}\]\s*\d*\s*BCLC\s+\d+/i,
];

/**
 * Check if a citation is a neutral citation (can construct URL directly)
 */
export function isNeutralCitation(citation: string): boolean {
  for (const config of Object.values(BAILII_PATTERNS)) {
    if (config.pattern.test(citation)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a citation is a traditional law report citation (needs search)
 */
export function isTraditionalCitation(citation: string): boolean {
  return TRADITIONAL_PATTERNS.some(p => p.test(citation));
}

/**
 * Construct BAILII and FCL URLs for a neutral citation.
 * This runs entirely in the browser - no server call needed.
 */
export function constructUrls(citation: string): ResolvedUrl[] {
  const urls: ResolvedUrl[] = [];

  // Try BAILII patterns first
  for (const [, config] of Object.entries(BAILII_PATTERNS)) {
    const match = citation.match(config.pattern);
    if (match) {
      const year = match[1];
      const num = match[2];
      urls.push({
        url: config.template.replace('{year}', year).replace('{num}', num),
        source: 'bailii',
        confidence: 0.95,
      });
      break;
    }
  }

  // Also construct FCL URL as fallback
  for (const [, config] of Object.entries(FCL_PATTERNS)) {
    const match = citation.match(config.pattern);
    if (match) {
      const year = match[1];
      const num = match[2];
      urls.push({
        url: config.template.replace('{year}', year).replace('{num}', num),
        source: 'fcl',
        confidence: 0.90,
      });
      break;
    }
  }

  return urls;
}

/**
 * Construct a human-readable FCL URL (HTML page, not XML data endpoint).
 * These are the public-facing pages users can view in a browser.
 */
export function constructFclHtmlUrl(citation: string): string | null {
  for (const [, config] of Object.entries(FCL_PATTERNS)) {
    const match = citation.match(config.pattern);
    if (match) {
      const year = match[1];
      const num = match[2];
      // Convert XML data URL template to HTML page URL
      const htmlUrl = config.template
        .replace('{year}', year)
        .replace('{num}', num)
        .replace('/data.xml', '');
      return htmlUrl;
    }
  }
  return null;
}

/**
 * Resolve a citation entirely client-side.
 * For neutral citations, constructs URLs directly.
 * For traditional citations, marks as needing server search.
 */
export function resolveClientSide(citation: string, caseName?: string): CitationResolution {
  const isNeutral = isNeutralCitation(citation);

  if (isNeutral) {
    return {
      citation,
      caseName,
      urls: constructUrls(citation),
      isNeutralCitation: true,
    };
  }

  return {
    citation,
    caseName,
    urls: [],
    isNeutralCitation: false,
  };
}
