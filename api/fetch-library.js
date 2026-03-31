const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://gateway.bibliocommons.com/v2/libraries/tpl/events/search';
const RECORDS_PER_PAGE = 100;
const DELAY_MS = 300;

const AUDIENCES = [
  { id: '67eab59f53f2873000a90aa9', label: 'preschool', ageGroup: '0-5' },
  { id: '6894f7dab7a97e36001ab2b9', label: 'school-age', ageGroup: '6-12' },
  { id: '67eab59153f2873000a90aa8', label: 'teens', ageGroup: '13-17' },
];

const TPL_EVENT_BASE = 'https://www.torontopubliclibrary.ca/detail.jsp?R=';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  // dateStr can be "2026-04-01T16:00" or "2026-04-01"
  return dateStr.replace('T', ' ').slice(0, 16);
}

async function fetchPage(audienceId, page) {
  const params = {
    audiences: audienceId,
    limit: RECORDS_PER_PAGE,
    locale: 'en-CA',
    page,
  };

  const response = await axios.get(BASE_URL, {
    params,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; HelpingHandBot/1.0)',
    },
    timeout: 15000,
  });

  return response.data;
}

function normalizeEvent(eventId, eventData, entities, ageGroup) {
  const def = eventData.definition || {};
  const location = def.branchLocationId
    ? entities.locations?.[def.branchLocationId]
    : null;

  const locationName = location?.name || def.branchLocationId || 'Toronto Public Library';
  const address = location?.address
    ? `${location.address.number || ''} ${location.address.street || ''}, ${location.address.city || 'Toronto'}`.trim()
    : 'Toronto';

  const types = (def.typeIds || []).map(tid => {
    const t = entities.eventTypes?.[tid];
    return t?.name || '';
  }).filter(Boolean);

  const isFree = true; // TPL events are always free

  return {
    id: `tpl_${eventId}`,
    source: 'tpl',
    title: def.title || 'Library Event',
    description: stripHtml(def.description),
    location: locationName,
    address,
    startDate: formatDate(def.start),
    endDate: formatDate(def.end),
    isFree,
    fee: 'Free',
    ageGroup,
    ages: ageGroup === '0-5' ? 'Ages 0-5' : ageGroup === '6-12' ? 'Ages 6-12' : 'Ages 13-17',
    categories: types,
    isDropIn: !eventData.registrationClosed && !(def.registrationInfo?.cap),
    isFull: eventData.isFull || false,
    registrationRequired: !!(def.registrationInfo?.provider),
    url: `https://tpl.bibliocommons.com/events/${eventId}`,
    phone: def.contact?.phone?.value || location?.branchContacts?.[0]?.value || null,
    isRecurring: eventData.isRecurring || false,
    locationId: def.branchLocationId || null,
  };
}

async function fetchAudience(audienceId, ageGroup) {
  console.log(`\nFetching TPL events for ages ${ageGroup}...`);

  // Get first page to find total
  const firstPage = await fetchPage(audienceId, 1);
  const pagination = firstPage.events?.pagination;

  if (!pagination) {
    console.warn(`  No pagination data for audience ${audienceId}`);
    return [];
  }

  const totalPages = pagination.pages;
  const totalCount = pagination.count;
  console.log(`  Found ${totalCount} events across ${totalPages} pages`);

  const allEvents = [];

  // Process first page
  const firstEntities = firstPage.entities || {};
  const firstEventIds = firstPage.events?.results || [];
  for (const eventId of firstEventIds) {
    const eventData = firstEntities.events?.[eventId];
    if (eventData) {
      allEvents.push(normalizeEvent(eventId, eventData, firstEntities, ageGroup));
    }
  }

  // Fetch remaining pages (cap at 20 pages = 2000 events per audience)
  const maxPages = Math.min(totalPages, 20);
  for (let page = 2; page <= maxPages; page++) {
    await sleep(DELAY_MS);
    try {
      const data = await fetchPage(audienceId, page);
      const entities = data.entities || {};
      const eventIds = data.events?.results || [];

      for (const eventId of eventIds) {
        const eventData = entities.events?.[eventId];
        if (eventData) {
          allEvents.push(normalizeEvent(eventId, eventData, entities, ageGroup));
        }
      }

      if (page % 5 === 0) {
        console.log(`  Page ${page}/${maxPages} — ${allEvents.length} events so far`);
      }
    } catch (err) {
      console.warn(`  Error on page ${page}: ${err.message}`);
    }
  }

  console.log(`  Done — ${allEvents.length} events fetched for ages ${ageGroup}`);
  return allEvents;
}

async function main() {
  console.log('Starting TPL events fetch...');

  const allEvents = [];
  const seen = new Set();

  for (const { id, ageGroup } of AUDIENCES) {
    const events = await fetchAudience(id, ageGroup);

    // Deduplicate by event ID + ageGroup
    for (const event of events) {
      const key = `${event.id}_${event.ageGroup}`;
      if (!seen.has(key)) {
        seen.add(key);
        allEvents.push(event);
      }
    }

    await sleep(500);
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    totalEvents: allEvents.length,
    source: 'Toronto Public Library',
    events: allEvents,
  };

  const outPath = path.join(__dirname, '..', 'library-events.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved ${allEvents.length} TPL events to library-events.json`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
