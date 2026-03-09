// ============ SEARCH ============
// Smart search with word boundaries and relevance scoring

interface SearchResult {
  item: any;
  score: number;
  matches: string[];
}

// Normalize for comparison (lowercase, remove punctuation, collapse spaces)
// Also normalize common brand name variations
const normalize = (s: string): string => {
  if (!s) return '';
  let normalized = s.toLowerCase().replace(/['"-]/g, '').replace(/\s+/g, ' ').trim();
  
  // Map common variations to canonical form
  const variations: Record<string, string> = {
    'barons': 'barrons',
    'barron': 'barrons',
  };
  
  // Replace whole word variations
  for (const [variant, canonical] of Object.entries(variations)) {
    const regex = new RegExp(`\\b${variant}\\b`, 'g');
    normalized = normalized.replace(regex, canonical);
  }
  
  return normalized;
};

// Escape special regex characters
const escapeRegex = (s: string): string => 
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Check if query matches text with word boundary awareness
// Returns match type: 'exact' | 'start' | 'word' | 'contains' | null
const getMatchType = (text: string, query: string, allowContains: boolean = true): { type: string; index: number } | null => {
  const normText = normalize(text);
  const normQuery = normalize(query);

  if (!normText || !normQuery) return null;

  // Exact match (case insensitive)
  if (normText === normQuery) {
    return { type: 'exact', index: 0 };
  }

  // Starts with query
  if (normText.startsWith(normQuery)) {
    return { type: 'start', index: 0 };
  }

  // Word boundary match (query at start of word)
  const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(normQuery)}`, 'i');
  const wordMatch = normText.match(wordBoundaryRegex);
  if (wordMatch && wordMatch.index !== undefined) {
    return { type: 'word', index: wordMatch.index };
  }

  // Contains query anywhere (substring) - only for longer queries
  if (allowContains) {
    const index = normText.indexOf(normQuery);
    if (index !== -1) {
      return { type: 'contains', index };
    }
  }

  return null;
};

// Calculate relevance score based on match type and field importance
const calculateScore = (matchType: string, fieldWeight: number): number => {
  const typeScores: Record<string, number> = {
    'exact': 100,
    'start': 80,
    'word': 60,
    'contains': 40
  };
  return (typeScores[matchType] || 0) * fieldWeight;
};

// Search projects with relevance scoring
const searchProjects = async (query: string, allFn: (sql: string, params?: any[]) => Promise<any[]>): Promise<SearchResult[]> => {
  const allProjects = await allFn('SELECT * FROM projects');
  const results: SearchResult[] = [];
  // For short queries (< 3 chars), don't allow 'contains' matches (word internals)
  const allowContains = query.length >= 3;

  for (const proj of allProjects) {
    let score = 0;
    const matches: string[] = [];

    // Handle customLinks - may be string, array, or object
    let customLinks: any[] = [];
    if (proj.customLinks) {
      if (typeof proj.customLinks === 'string') {
        try { customLinks = JSON.parse(proj.customLinks); } catch { customLinks = []; }
      } else if (Array.isArray(proj.customLinks)) {
        customLinks = proj.customLinks;
      }
    }
    const designers = proj.designers ? (typeof proj.designers === 'string' ? JSON.parse(proj.designers) : proj.designers) : [];
    const businessLines = proj.businessLine ?
      (typeof proj.businessLine === 'string' ? 
        (() => { try { return JSON.parse(proj.businessLine); } catch { return [proj.businessLine]; } })() : 
        (Array.isArray(proj.businessLine) ? proj.businessLine : [proj.businessLine])) : [];

    // Check name (highest weight: 1.0)
    const nameMatch = getMatchType(proj.name, query, allowContains);
    if (nameMatch) {
      score += calculateScore(nameMatch.type, 1.0);
      matches.push(`name:${nameMatch.type}`);
    }

    // Check business lines (weight: 0.8)
    for (const bl of businessLines) {
      const blMatch = getMatchType(bl, query, allowContains);
      if (blMatch) {
        score += calculateScore(blMatch.type, 0.8);
        matches.push(`businessLine:${blMatch.type}`);
      }
    }

    // Check designers (weight: 0.6)
    for (const designer of designers) {
      const designerMatch = getMatchType(designer, query, allowContains);
      if (designerMatch) {
        score += calculateScore(designerMatch.type, 0.6);
        matches.push(`designer:${designerMatch.type}`);
      }
    }

    // Check description (weight: 0.4)
    if (proj.description) {
      const descMatch = getMatchType(proj.description, query, allowContains);
      if (descMatch) {
        score += calculateScore(descMatch.type, 0.4);
        matches.push(`description:${descMatch.type}`);
      }
    }

    // Check asset link names (weight: 0.3)
    const allLinks = [
      proj.deckName ? { name: proj.deckName, url: proj.deckLink, type: 'Deck' } : null,
      proj.prdName ? { name: proj.prdName, url: proj.prdLink, type: 'PRD' } : null,
      proj.briefName ? { name: proj.briefName, url: proj.briefLink, type: 'Brief' } : null,
      proj.figmaLink ? { name: 'Figma', url: proj.figmaLink, type: 'Figma' } : null,
      ...customLinks.map((l: any) => ({ name: l.name, url: l.url, type: 'Link' }))
    ].filter(Boolean);

    for (const link of allLinks) {
      const linkMatch = getMatchType(link.name, query, allowContains);
      if (linkMatch) {
        score += calculateScore(linkMatch.type, 0.3);
        matches.push(`link:${link.type}:${linkMatch.type}`);
      }
    }

    if (score > 0) {
      results.push({
        item: {
          ...proj,
          timeline: proj.timeline ? JSON.parse(proj.timeline) : [],
          customLinks,
          designers,
          businessLines,
          matchedLinks: allLinks.filter((l: any) => getMatchType(l.name, query, allowContains))
        },
        score,
        matches
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
};

// Search team members with relevance scoring
const searchTeam = async (query: string, allFn: (sql: string, params?: any[]) => Promise<any[]>): Promise<SearchResult[]> => {
  const allTeam = await allFn('SELECT * FROM team');
  const results: SearchResult[] = [];
  const allowContains = query.length >= 3;

  for (const member of allTeam) {
    let score = 0;
    const matches: string[] = [];

    const brands = JSON.parse(member.brands || '[]');

    // Check name (highest weight: 1.0)
    const nameMatch = getMatchType(member.name, query, allowContains);
    if (nameMatch) {
      score += calculateScore(nameMatch.type, 1.0);
      matches.push(`name:${nameMatch.type}`);
    }

    // Check role (weight: 0.7)
    const roleMatch = getMatchType(member.role, query, allowContains);
    if (roleMatch) {
      score += calculateScore(roleMatch.type, 0.7);
      matches.push(`role:${roleMatch.type}`);
    }

    // Check brands (weight: 0.5)
    for (const brand of brands) {
      const brandMatch = getMatchType(brand, query, allowContains);
      if (brandMatch) {
        score += calculateScore(brandMatch.type, 0.5);
        matches.push(`brand:${brandMatch.type}`);
      }
    }

    if (score > 0) {
      results.push({
        item: {
          ...member,
          brands,
          timeOff: member.timeOff ? JSON.parse(member.timeOff) : []
        },
        score,
        matches
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
};

// Search business lines with relevance scoring
const searchBusinessLines = async (query: string, allFn: (sql: string, params?: any[]) => Promise<any[]>): Promise<SearchResult[]> => {
  const allBL = await allFn('SELECT * FROM business_lines');
  const results: SearchResult[] = [];
  const allowContains = query.length >= 3;

  for (const bl of allBL) {
    let score = 0;
    const matches: string[] = [];

    // Handle customLinks - may be string, array, or object
    let customLinks: any[] = [];
    if (bl.customLinks) {
      if (typeof bl.customLinks === 'string') {
        try { customLinks = JSON.parse(bl.customLinks); } catch { customLinks = []; }
      } else if (Array.isArray(bl.customLinks)) {
        customLinks = bl.customLinks;
      }
    }

    // Check name (highest weight: 1.0)
    const nameMatch = getMatchType(bl.name, query, allowContains);
    if (nameMatch) {
      score += calculateScore(nameMatch.type, 1.0);
      matches.push(`name:${nameMatch.type}`);
    }

    // Check asset links (weight: 0.3)
    const allLinks = [
      bl.deckName ? { name: bl.deckName, url: bl.deckLink, type: 'Deck' } : null,
      bl.prdName ? { name: bl.prdName, url: bl.prdLink, type: 'PRD' } : null,
      bl.briefName ? { name: bl.briefName, url: bl.briefLink, type: 'Brief' } : null,
      bl.figmaLink ? { name: 'Figma', url: bl.figmaLink, type: 'Figma' } : null,
      ...customLinks.map((l: any) => ({ name: l.name, url: l.url, type: 'Link' }))
    ].filter(Boolean);

    for (const link of allLinks) {
      const linkMatch = getMatchType(link.name, query, allowContains);
      if (linkMatch) {
        score += calculateScore(linkMatch.type, 0.3);
        matches.push(`link:${link.type}:${linkMatch.type}`);
      }
    }

    if (score > 0) {
      results.push({
        item: {
          ...bl,
          customLinks,
          matchedLinks: allLinks.filter((l: any) => getMatchType(l.name, query, allowContains))
        },
        score,
        matches
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
};

// Search notes with relevance scoring
const searchNotes = async (query: string, allFn: (sql: string, params?: any[]) => Promise<any[]>): Promise<SearchResult[]> => {
  const allNotes = await allFn('SELECT * FROM notes WHERE hidden = 0 OR hidden IS NULL');
  const results: SearchResult[] = [];
  const allowContains = query.length >= 3;

  for (const note of allNotes) {
    let score = 0;
    const matches: string[] = [];

    // Check title (highest weight: 1.0)
    const titleMatch = getMatchType(note.title, query, allowContains);
    if (titleMatch) {
      score += calculateScore(titleMatch.type, 1.0);
      matches.push(`title:${titleMatch.type}`);
    }

    // Check projects_raw (weight: 0.8)
    if (note.projects_raw) {
      const projMatch = getMatchType(note.projects_raw, query, allowContains);
      if (projMatch) {
        score += calculateScore(projMatch.type, 0.8);
        matches.push(`projects:${projMatch.type}`);
      }
    }

    // Check people_raw (weight: 0.7)
    if (note.people_raw) {
      const peopleMatch = getMatchType(note.people_raw, query, allowContains);
      if (peopleMatch) {
        score += calculateScore(peopleMatch.type, 0.7);
        matches.push(`people:${peopleMatch.type}`);
      }
    }

    // Check content_preview (weight: 0.5)
    if (note.content_preview) {
      const contentMatch = getMatchType(note.content_preview, query, allowContains);
      if (contentMatch) {
        score += calculateScore(contentMatch.type, 0.5);
        matches.push(`content:${contentMatch.type}`);
      }
    }

    // Check source_filename (weight: 0.3)
    if (note.source_filename) {
      const fnMatch = getMatchType(note.source_filename.replace(/_/g, ' '), query, allowContains);
      if (fnMatch) {
        score += calculateScore(fnMatch.type, 0.3);
        matches.push(`filename:${fnMatch.type}`);
      }
    }

    if (score > 0) {
      results.push({ item: note, score, matches });
    }
  }

  return results.sort((a, b) => b.score - a.score);
};

export { searchProjects, searchTeam, searchBusinessLines, searchNotes, SearchResult };
