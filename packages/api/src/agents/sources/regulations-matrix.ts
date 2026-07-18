import type { ProjectType, RegulationsRegion } from '@atlas/shared';

// Theme 09 — regulations sources matrix. (project_type, region) maps
// to a list of regulator news / press / consultation pages the agent
// scrapes weekly. Empty matrix entries fall back to the broader
// region-wide list (also seeded here).
//
// Sources are intentionally a small, hand-picked starting set; the
// agent will surface "no recent items" rather than guess at sources
// that aren't listed here. Expand the matrix as use cases broaden.

export interface RegulationSource {
    name: string;
    url: string;
    /** Optional CSS-ish hint for the agent's snapshot extractor. */
    selector_hint?: string;
}

const REGION_WIDE_SOURCES: Record<RegulationsRegion, RegulationSource[]> = {
    EU: [
        { name: 'EDPB news', url: 'https://www.edpb.europa.eu/news/news_en' },
        { name: 'European Commission press', url: 'https://ec.europa.eu/commission/presscorner/home/en' },
    ],
    US: [
        { name: 'Federal Register — Tech & Privacy', url: 'https://www.federalregister.gov/topics/technology' },
        { name: 'FTC press releases', url: 'https://www.ftc.gov/news-events/news/press-releases' },
    ],
    UK: [
        { name: 'ICO news', url: 'https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/' },
        { name: 'GOV.UK announcements', url: 'https://www.gov.uk/search/news-and-communications' },
    ],
    IN: [
        { name: 'MeitY press', url: 'https://www.meity.gov.in/whatsnew' },
    ],
    CA: [
        { name: 'OPC Canada news', url: 'https://www.priv.gc.ca/en/opc-news/news-and-announcements/' },
    ],
    AU: [
        { name: 'OAIC news', url: 'https://www.oaic.gov.au/news' },
    ],
};

// (project_type, region) overrides. Anything not in this map falls
// back to the region-wide list.
const MATRIX: Partial<Record<`${ProjectType}:${RegulationsRegion}`, RegulationSource[]>> = {
    'saas:EU': [
        { name: 'CNIL news (FR)', url: 'https://www.cnil.fr/en/news' },
        { name: 'DPC (IE) news', url: 'https://www.dataprotection.ie/en/news-media/latest-news' },
        ...REGION_WIDE_SOURCES.EU,
    ],
    'saas:US': REGION_WIDE_SOURCES.US,
    'fintech:US': [
        { name: 'CFPB press', url: 'https://www.consumerfinance.gov/about-us/newsroom/' },
        { name: 'SEC press', url: 'https://www.sec.gov/newsroom/press-releases' },
        ...REGION_WIDE_SOURCES.US,
    ],
    'healthcare:US': [
        { name: 'HHS/OCR press', url: 'https://www.hhs.gov/about/news/index.html' },
        { name: 'FDA press', url: 'https://www.fda.gov/news-events/fda-newsroom/press-announcements' },
        ...REGION_WIDE_SOURCES.US,
    ],
    'healthcare:EU': REGION_WIDE_SOURCES.EU,
    'ecommerce:EU': REGION_WIDE_SOURCES.EU,
    'ecommerce:US': REGION_WIDE_SOURCES.US,
    'gaming:US': REGION_WIDE_SOURCES.US,
    'enterprise:US': REGION_WIDE_SOURCES.US,
    'enterprise:EU': REGION_WIDE_SOURCES.EU,
};

/**
 * Resolve the source list for a (project_type, region) tuple. Falls
 * back to the region-wide sources when the matrix lacks an entry.
 * The agent calls this per region and union-deduplicates by URL.
 */
export function sourcesFor(projectType: ProjectType, region: RegulationsRegion): RegulationSource[] {
    const key = `${projectType}:${region}` as const;
    return MATRIX[key] ?? REGION_WIDE_SOURCES[region];
}
