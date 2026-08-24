const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// ── Product lookup from multiple sources ─────────────────────

async function lookupOpenFoodFacts(barcode) {
  try {
    const fields = 'product_name,generic_name,brands,brand_owner,image_front_url,image_url,quantity,countries,manufacturing_places,origins,ingredients_text,ingredients_analysis_tags,categories,nutriscore_grade,nova_group,nutriments,allergens,additives_tags,labels,labels_tags,stores,link';
    const resp = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${fields}`, {
      headers: { 'User-Agent': 'ScanOrigin/1.0 (contact@scanorigin.app)' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      const nutriments = p.nutriments || {};
      return {
        source: 'Open Food Facts',
        name: p.product_name || p.generic_name || '',
        brand: p.brands || '',
        brandOwner: p.brand_owner || '',
        image: p.image_front_url || p.image_url || '',
        quantity: p.quantity || '',
        countries: p.countries || '',
        manufacturing: p.manufacturing_places || '',
        origins: p.origins || '',
        ingredients: p.ingredients_text || '',
        ingredientsAnalysis: p.ingredients_analysis_tags || [],
        categories: p.categories || '',
        nutriscore: p.nutriscore_grade || '',
        novaGroup: p.nova_group || null,
        nutriments: {
          energy: nutriments['energy-kcal_100g'] || nutriments['energy_100g'] || null,
          fat: nutriments['fat_100g'] || null,
          saturatedFat: nutriments['saturated-fat_100g'] || null,
          carbs: nutriments['carbohydrates_100g'] || null,
          sugars: nutriments['sugars_100g'] || null,
          fiber: nutriments['fiber_100g'] || null,
          proteins: nutriments['proteins_100g'] || null,
          salt: nutriments['salt_100g'] || null,
          sodium: nutriments['sodium_100g'] || null,
        },
        allergens: p.allergens || '',
        additives: p.additives_tags || [],
        labels: p.labels || '',
        labelsTags: p.labels_tags || [],
        stores: p.stores || '',
        sourceUrl: p.link || `https://world.openfoodfacts.org/product/${barcode}`,
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function lookupUPCitemdb(barcode) {
  try {
    const resp = await fetch(`https://api.upcitemdb.com/prod/trial/${barcode}`, {
      headers: { 'User-Agent': 'ScanOrigin/1.0' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.code === 'OK' && data.items && data.items.length > 0) {
      const item = data.items[0];
      return {
        source: 'UPCitemdb',
        name: item.title || '',
        brand: item.brand || '',
        image: item.image || '',
        category: item.category || '',
        description: item.description || '',
        offers: item.offers || [],
        sourceUrl: item.link || '',
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function lookupDuckDuckGo(barcode) {
  try {
    const resp = await fetch(
      `https://api.duckduckgo.com/?q=${barcode}+barcode+product&format=json&no_html=1`,
      { headers: { 'User-Agent': 'ScanOrigin/1.0' } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.AbstractText && data.AbstractText.length > 10) {
      return {
        source: 'DuckDuckGo',
        name: data.Heading || 'Product found via search',
        brand: '',
        image: data.Image || '',
        description: data.AbstractText,
        sourceUrl: data.AbstractURL || '',
      };
    }
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      for (const topic of data.RelatedTopics) {
        if (topic.Text && topic.Text.length > 10) {
          return {
            source: 'DuckDuckGo',
            name: topic.Text.substring(0, 100),
            brand: '',
            image: topic.Icon?.URL || '',
            description: topic.Text,
            sourceUrl: topic.FirstURL || '',
          };
        }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function lookupCodeLook(barcode) {
  try {
    const resp = await fetch(`https://codelook.info/lookup/${barcode}`, {
      headers: { 'User-Agent': 'ScanOrigin/1.0', 'Accept': 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.name) {
      return {
        source: 'CodeLook',
        name: data.name || '',
        brand: data.brand || '',
        image: data.image || '',
        category: data.category || '',
        description: data.description || '',
        sourceUrl: data.url || `https://codelook.info/lookup/${barcode}`,
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ── Web search for manufacturing origin ───────────────────────

const SEARCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MAJOR_CITIES = ['Atlanta','London','Berlin','Paris','Tokyo','New York','Chicago','Toronto','Sydney','Amsterdam','Madrid','Rome','Munich','Milan','Geneva','Zurich','Stockholm','Oslo','Copenhagen','Dublin','Vienna','Lisbon','Warsaw','Moscow','Seoul','Beijing','Mumbai','Sao Paulo','Mexico City','Istanbul','Athens','Brussels','Helsinki','Den Dolder','Amersfoort','Naples','Tiberias','Utrecht'];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SEASONS = ['Spring','Summer','Autumn','Winter','Fall'];
const FALSE_POSITIVES = ['The','This','These','Many','Some','Such','Over','Most','Recent','Early','Late','Which','That','Those'];

const NATIONALITY_MAP = {
  'American': 'United States', 'US': 'United States', 'USA': 'United States',
  'British': 'United Kingdom', 'UK': 'United Kingdom',
  'German': 'Germany', 'French': 'France', 'Italian': 'Italy',
  'Spanish': 'Spain', 'Dutch': 'Netherlands', 'Belgian': 'Belgium',
  'Swiss': 'Switzerland', 'Swedish': 'Sweden', 'Norwegian': 'Norway',
  'Danish': 'Denmark', 'Finnish': 'Finland', 'Polish': 'Poland',
  'Irish': 'Ireland', 'Portuguese': 'Portugal', 'Austrian': 'Austria',
  'Canadian': 'Canada', 'Australian': 'Australia', 'Japanese': 'Japan',
  'Chinese': 'China', 'Korean': 'South Korea', 'Indian': 'India',
  'Brazilian': 'Brazil', 'Mexican': 'Mexico', 'Turkish': 'Turkey',
  'Greek': 'Greece', 'Russian': 'Russia',
};

function isValidCountry(c) {
  return c && c.length > 2 && c.length < 30 &&
    !MONTHS.includes(c) && !SEASONS.includes(c) &&
    !FALSE_POSITIVES.includes(c) && !MAJOR_CITIES.includes(c);
}

// ── Wikipedia API search (works from any IP, no scraping) ────

async function fetchWikipediaExtract(brand) {
  return new Promise((resolve) => {
    const title = encodeURIComponent(brand);
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=extracts&exintro=1&format=json&explaintext=1&redirects=1`;
    https.get(url, { headers: { 'User-Agent': 'ScanOrigin/1.0 (contact@scanorigin.app)' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const pages = parsed.query?.pages || {};
          for (const k of Object.keys(pages)) {
            if (k !== '-1' && pages[k].extract) {
              resolve(pages[k].extract);
              return;
            }
          }
        } catch (e) { /* ignore */ }
        resolve(null);
      });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// Fetch richer company data from Wikipedia (description, owner, founded, HQ)
async function fetchWikipediaData(brand) {
  if (!brand || brand.length < 2) return null;
  const extract = await fetchWikipediaExtract(brand);
  if (!extract) return null;

  const result = { description: '', owner: '', founded: '', hq: '', url: '' };

  // First 2-3 sentences as description
  const sentences = extract.split('. ').slice(0, 3).join('. ');
  result.description = sentences.length > 20 ? sentences + '.' : '';

  // Extract parent/owner company
  const ownerMatch = extract.match(/(?:subsidiary\s+of|owned\s+by|parent\s+company\s+(?:is\s+)?|brand\s+of)\s+([A-Z][A-Za-z]+(?:[\s\-&][A-Z][A-Za-z]+)*)/);
  if (ownerMatch && ownerMatch[1] && ownerMatch[1].trim().length > 2) {
    result.owner = ownerMatch[1].trim();
  }

  // Extract founded year
  const foundedMatch = extract.match(/(?:founded|established|created)\s+(?:in\s+)?(\d{4})/);
  if (foundedMatch) result.founded = foundedMatch[1];

  // Extract headquarters location
  const hqMatch = extract.match(/(?:headquartered|based|headquarters)\s+in\s+([A-Z][a-z]+(?:[\s,][A-Z][a-z]+)*)/);
  if (hqMatch && hqMatch[1]) {
    result.hq = hqMatch[1].replace(/,$/, '').trim();
  }

  // Wikipedia URL
  result.url = `https://en.wikipedia.org/wiki/${encodeURIComponent(brand)}`;

  return result;
}

async function searchBrandOrigin(brand) {
  if (!brand || brand.length < 2) return null;

  // Try Wikipedia first (most reliable, works from any IP)
  const wikiExtract = await fetchWikipediaExtract(brand);
  if (wikiExtract) {
    // Look for nationality patterns in the Wikipedia intro
    const natMatch = wikiExtract.match(/\b(American|British|German|French|Italian|Spanish|Dutch|Belgian|Swiss|Swedish|Norwegian|Danish|Finnish|Polish|Irish|Portuguese|Austrian|Canadian|Australian|Japanese|Chinese|Korean|Indian|Brazilian|Mexican|Turkish|Greek|Russian)\b(?:[-\s]?(?:family[-\s]?)?(?:owned|multinational|brand|company|corporation|manufacturer|producer|food|mayo|sauc|drinks?|products?|retail))/i);
    if (natMatch && natMatch[1]) {
      const natKey = natMatch[1].charAt(0).toUpperCase() + natMatch[1].slice(1).toLowerCase();
      const country = NATIONALITY_MAP[natKey];
      if (country) {
        // Try to extract parent company from the same extract
        let foundCompany = '';
        const parentMatch = wikiExtract.match(/(?:subsidiary\s+of|owned\s+by|parent\s+company\s+(?:is\s+)?|created\s+by|produced\s+(?:and\s+)?distributed\s+by|distributed\s+by|produced\s+by|brand\s+of)\s+([A-Z][A-Za-z]+(?:[-\s][A-Z][A-Za-z]+)*)/);
        if (parentMatch && parentMatch[1] && parentMatch[1].trim().length > 2 && !['The','This','These'].includes(parentMatch[1].trim())) {
          foundCompany = parentMatch[1].trim();
        }
        return { origin: country, company: foundCompany || brand };
      }
    }

    // Look for "based in [Country]" or "headquartered in [Country]"
    const basedMatch = wikiExtract.match(/(?:based|headquartered|founded)\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
    if (basedMatch && basedMatch[1] && isValidCountry(basedMatch[1].trim())) {
      let foundCompany = '';
      const parentMatch = wikiExtract.match(/(?:subsidiary\s+of|owned\s+by|parent\s+company\s+(?:is\s+)?|brand\s+of)\s+([A-Z][A-Za-z]+(?:[-\s][A-Z][A-Za-z]+)*)/);
      if (parentMatch && parentMatch[1]) foundCompany = parentMatch[1].trim();
      return { origin: basedMatch[1].trim(), company: foundCompany || brand };
    }
  }

  return null;
}

async function searchManufacturingOrigin(productName, brand) {
  // Wikipedia doesn't usually have per-product manufacturing location,
  // but the brand article sometimes mentions where products are made
  const wikiExtract = await fetchWikipediaExtract(brand);
  if (wikiExtract) {
    const patterns = [
      /made\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
      /manufactured\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
      /produced\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
      /originated\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
      /originally\s+(?:developed|created|made|produced)\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
    ];

    for (const pattern of patterns) {
      const m = wikiExtract.match(pattern);
      if (m && m[1] && isValidCountry(m[1].trim())) {
        return { origin: m[1].trim() };
      }
    }
  }
  return null;
}

// ── Product lookup aggregator ────────────────────────────────

async function lookupProduct(barcode) {
  const results = [];
  const [off, upc, ddg, cl] = await Promise.allSettled([
    lookupOpenFoodFacts(barcode),
    lookupUPCitemdb(barcode),
    lookupDuckDuckGo(barcode),
    lookupCodeLook(barcode),
  ]);
  if (off.status === 'fulfilled' && off.value) results.push(off.value);
  if (upc.status === 'fulfilled' && upc.value) results.push(upc.value);
  if (ddg.status === 'fulfilled' && ddg.value) results.push(ddg.value);
  if (cl.status === 'fulfilled' && cl.value) results.push(cl.value);

  // Enrich with Wikipedia brand info (company ownership, description)
  const brand = off.value?.brand || upc.value?.brand || '';
  const brandParts = brand.split(',').map(s => s.trim()).filter(Boolean);
  const primaryBrand = brandParts[0] || brand;
  if (primaryBrand && primaryBrand.length > 1) {
    const [brandSearch, wikiData] = await Promise.allSettled([
      searchBrandOrigin(primaryBrand),
      fetchWikipediaData(primaryBrand),
    ]);
    if (brandSearch.status === 'fulfilled' && brandSearch.value) {
      const offResult = results.find(r => r.source === 'Open Food Facts');
      if (offResult) {
        offResult.brandOrigin = brandSearch.value.origin;
        offResult.brandCompany = brandSearch.value.company;
        offResult.brandFromSearch = true;
      }
    }
    if (wikiData.status === 'fulfilled' && wikiData.value) {
      const offResult = results.find(r => r.source === 'Open Food Facts') || results[0];
      if (offResult) {
        offResult.wikiDescription = wikiData.value.description || '';
        offResult.wikiUrl = wikiData.value.url || '';
        offResult.wikiOwner = wikiData.value.owner || '';
        offResult.wikiFounded = wikiData.value.founded || '';
        offResult.wikiHq = wikiData.value.hq || '';
      }
    }
  }

  return results;
}

// ── GS1 prefix table ──────────────────────────────────────────

const GS1_PREFIXES = [
  ['000','139','🇺🇸','United States'],
  ['300','379','🇫🇷','France'],
  ['380','380','🇧🇬','Bulgaria'],
  ['383','383','🇸🇮','Slovenia'],
  ['385','385','🇭🇷','Croatia'],
  ['387','387','🇧🇦','Bosnia & Herzegovina'],
  ['389','389','🇲🇪','Montenegro'],
  ['390','390','🇧🇦','Bosnia & Herzegovina'],
  ['400','440','🇩🇪','Germany'],
  ['450','459','🇯🇵','Japan'],
  ['460','469','🇷🇺','Russia'],
  ['470','470','🇰🇬','Kyrgyzstan'],
  ['471','471','🇹🇼','Taiwan'],
  ['474','474','🇪🇪','Estonia'],
  ['475','475','🇱🇻','Latvia'],
  ['476','476','🇦🇿','Azerbaijan'],
  ['477','477','🇱🇹','Lithuania'],
  ['478','478','🇺🇿','Uzbekistan'],
  ['479','479','🇹🇼','Taiwan'],
  ['480','480','🇵🇭','Philippines'],
  ['481','481','🇧🇾','Belarus'],
  ['482','482','🇺🇦','Ukraine'],
  ['483','483','🇲🇩','Moldova'],
  ['484','484','🇲🇪','Montenegro'],
  ['485','485','🇦🇲','Armenia'],
  ['486','486','🇬🇪','Georgia'],
  ['487','487','🇰🇿','Kazakhstan'],
  ['488','489','🇹🇭','Thailand'],
  ['489','489','🇭🇰','Hong Kong'],
  ['490','499','🇯🇵','Japan'],
  ['500','509','🇬🇧','United Kingdom'],
  ['520','521','🇬🇷','Greece'],
  ['528','528','🇱🇧','Lebanon'],
  ['529','529','🇨🇾','Cyprus'],
  ['530','530','🇦🇱','Albania'],
  ['531','531','🇲🇰','North Macedonia'],
  ['535','535','🇲🇹','Malta'],
  ['539','539','🇮🇪','Ireland'],
  ['540','549','🇧🇪','Belgium & Luxembourg'],
  ['560','560','🇵🇹','Portugal'],
  ['569','569','🇮🇸','Iceland'],
  ['570','579','🇩🇰','Denmark'],
  ['590','590','🇵🇱','Poland'],
  ['594','594','🇷🇴','Romania'],
  ['599','599','🇭🇺','Hungary'],
  ['600','601','🇿🇦','South Africa'],
  ['603','603','🇬🇭','Ghana'],
  ['604','604','🇸🇳','Senegal'],
  ['608','608','🇧🇭','Bahrain'],
  ['609','609','🇲🇦','Morocco'],
  ['611','611','🇲🇷','Mauritania'],
  ['613','613','🇩🇿','Algeria'],
  ['616','616','🇰🇪','Kenya'],
  ['618','618','🇨🇮','Ivory Coast'],
  ['619','619','🇹🇳','Tunisia'],
  ['621','621','🇸🇾','Syria'],
  ['622','622','🇪🇸','Spain (experimental)'],
  ['623','623','🇱🇻','Latvia'],
  ['624','624','🇧🇫','Burkina Faso'],
  ['625','625','🇬🇷','Greece (experimental)'],
  ['626','626','🇲🇦','Morocco'],
  ['627','627','🇰🇼','Kuwait'],
  ['628','628','🇯🇴','Jordan'],
  ['629','629','🇹🇷','Turkey'],
  ['640','649','🇸🇦','Saudi Arabia'],
  ['690','699','🇨🇳','China'],
  ['700','709','🇳🇴','Norway'],
  ['710','710','🇨🇴','Colombia'],
  ['711','711','🇰🇷','South Korea'],
  ['712','712','🇹🇼','Taiwan'],
  ['713','713','🇪🇪','Estonia'],
  ['714','714','🇧🇫','Burkina Faso'],
  ['715','715','🇨🇭','Switzerland'],
  ['716','716','🇻🇺','Vanuatu'],
  ['717','717','🇸🇾','Syria'],
  ['718','718','🇧🇴','Bolivia'],
  ['719','719','🇵🇪','Peru'],
  ['720','720','🇲🇽','Mexico'],
  ['721','721','🇧🇷','Brazil'],
  ['722','722','🇨🇱','Chile'],
  ['723','723','🇨🇴','Colombia'],
  ['724','724','🇦🇷','Argentina'],
  ['725','725','🇪🇷','Eritrea'],
  ['726','726','🇿🇦','South Africa'],
  ['727','727','🇳🇿','New Zealand'],
  ['728','728','🇪🇬','Egypt'],
  ['729','729','🇮🇱','Israel'],
  ['730','739','🇸🇪','Sweden'],
  ['740','740','🇬🇹','Guatemala'],
  ['741','741','🇸🇻','El Salvador'],
  ['742','742','🇭🇳','Honduras'],
  ['743','743','🇳🇮','Nicaragua'],
  ['744','744','🇨🇷','Costa Rica'],
  ['745','745','🇵🇦','Panama'],
  ['746','746','🇩🇴','Dominican Republic'],
  ['747','747','🇲🇽','Mexico'],
  ['748','748','🇧🇿','Belize'],
  ['749','749','🇨🇱','Chile'],
  ['750','750','🇲🇽','Mexico'],
  ['751','751','🇨🇦','Canada'],
  ['752','752','🇲🇿','Mozambique'],
  ['753','753','🇨🇺','Cuba'],
  ['754','755','🇨🇦','Canada'],
  ['756','756','🇨🇷','Costa Rica'],
  ['757','757','🇬🇹','Guatemala'],
  ['758','758','🇵🇦','Panama'],
  ['759','759','🇻🇪','Venezuela'],
  ['760','769','🇨🇭','Switzerland'],
  ['770','770','🇨🇴','Colombia'],
  ['771','771','🇧🇷','Brazil'],
  ['773','773','🇺🇾','Uruguay'],
  ['775','775','🇵🇪','Peru'],
  ['777','777','🇧🇴','Bolivia'],
  ['779','779','🇦🇷','Argentina'],
  ['780','780','🇨🇱','Chile'],
  ['784','784','🇵🇬','Paraguay'],
  ['786','786','🇪🇨','Ecuador'],
  ['789','790','🇧🇷','Brazil'],
  ['800','839','🇮🇹','Italy'],
  ['840','849','🇪🇸','Spain'],
  ['850','850','🇨🇺','Cuba'],
  ['858','858','🇸🇰','Slovakia'],
  ['859','859','🇨🇿','Czech Republic'],
  ['860','860','🇷🇸','Serbia'],
  ['865','865','🇲🇳','Mongolia'],
  ['867','867','🇰🇿','Kazakhstan'],
  ['868','869','🇹🇷','Turkey'],
  ['870','879','🇳🇱','Netherlands'],
  ['880','880','🇰🇷','South Korea'],
  ['884','884','🇰🇭','Cambodia'],
  ['885','885','🇹🇭','Thailand'],
  ['888','888','🇸🇬','Singapore'],
  ['890','890','🇮🇳','India'],
  ['893','893','🇻🇳','Vietnam'],
  ['894','894','🇹🇭','Thailand'],
  ['896','896','🇵🇱','Poland'],
  ['899','899','🇮🇩','Indonesia'],
  ['900','919','🇦🇹','Austria'],
  ['930','939','🇦🇺','Australia'],
  ['940','949','🇳🇿','New Zealand'],
  ['950','950','🇬🇧','United Kingdom'],
  ['955','955','🇲🇾','Malaysia'],
  ['958','958','🇲🇴','Macau'],
  ['960','969','🇬🇧','Global Office (GS1)'],
  ['977','977','🇬🇧','Serial Publications (ISSN)'],
  ['978','979','🇬🇧','Books (ISBN)'],
  ['980','980','🇬🇧','Refund receipts'],
  ['981','984','🇬🇧','Common Currency Coupons'],
  ['985','985','🇬🇧','UK coupons'],
  ['986','989','🇬🇧','GS1 UK coupons'],
  ['990','999','🇬🇧','GS1 coupons'],
];

function gs1Lookup(barcode) {
  const prefix = barcode.substring(0, 3);
  const num = parseInt(prefix);
  for (const [lo, hi, flag, country] of GS1_PREFIXES) {
    if (num >= parseInt(lo) && num <= parseInt(hi)) {
      return { flag, country, prefix };
    }
  }
  return { flag: '🌍', country: 'Unknown', prefix };
}

// ── Routes ───────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/lookup', async (req, res) => {
  const barcode = (req.query.barcode || '').replace(/\D/g, '');
  if (!barcode || barcode.length < 8) {
    return res.status(400).json({ error: 'Invalid barcode' });
  }
  try {
    const products = await lookupProduct(barcode);
    const gs1 = gs1Lookup(barcode);
    res.json({ barcode, gs1, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/enrich', async (req, res) => {
  const name = req.query.name || '';
  const brand = req.query.brand || '';
  const debug = req.query.debug === '1';
  if (!name && !brand) {
    return res.status(400).json({ error: 'Missing name or brand' });
  }
  try {
    const [originSearch, brandSearch] = await Promise.all([
      name ? searchManufacturingOrigin(name, brand) : Promise.resolve(null),
      brand ? searchBrandOrigin(brand) : Promise.resolve(null),
    ]);

    const result = {};
    if (originSearch) {
      result.manufacturing = originSearch.origin;
      result.manufacturingFromSearch = true;
    }
    if (brandSearch) {
      result.brandOrigin = brandSearch.origin;
      result.brandCompany = brandSearch.company;
      result.brandFromSearch = true;
    }
    if (debug) {
      const brandQuery = `"${brand}" "owned by" OR "subsidiary of" OR "parent company" OR "headquartered"`;
      const snippets = await fetchSearchSnippets(brandQuery);
      result._debug = { snippetCount: snippets.length, snippets: snippets.slice(0, 5) };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ScanOrigin API running on port ${PORT}`);
});