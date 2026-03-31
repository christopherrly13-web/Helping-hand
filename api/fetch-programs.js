const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'https://anc.ca.apm.activecommunities.com/toronto';

const CATEGORIES = [
  { id: '56', name: 'Adapted Activities' },
  { id: '79', name: 'Adapted CampTO' },
  { id: '49', name: 'Adapted Swim' },
  { id: '120', name: 'Adapted Inclusive' },
  { id: '61', name: 'CampTO' },
  { id: '45', name: 'Early Years' },
  { id: '30', name: 'Learn to Skate' },
  { id: '35', name: 'Preschool Swim' },
  { id: '36', name: 'Youth Swim' },
  { id: '66', name: 'Basketball' },
  { id: '38', name: 'Soccer' },
  { id: '73', name: 'Gymnastics' },
  { id: '47', name: 'Dance' },
  { id: '26', name: 'Performing Arts' },
  { id: '22', name: 'Visual Arts' }
];

async function getSession() {
  const response = await axios.get(`${BASE_URL}/home`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  return response.headers['set-cookie']
    .map(c => c.split(';')[0])
    .join('; ');
}

async function fetchPage(cookies, categoryIds, page) {
  const payload = {
    activity_search_pattern: {
      skills: [],
      time_after_str: '',
      days_of_week: '',
      activity_select_param: 2,
      center_ids: [],
      category_ids: categoryIds,
      keyword: '',
      page_number: page,
      records_per_page: 20,
      order_by: 'Name',
      order_option: 'ASC'
    },
    activity_transfer_pattern: {}
  };

  const response = await axios.post(
    `${BASE_URL}/rest/activities/list?locale=en-US`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${BASE_URL}/activity/search`
      }
    }
  );

  return response.data;
}

function normalize(program, categoryName) {
  const spotsLeft = program.total_open - program.already_enrolled;
  return {
    id: program.id,
    name: program.name,
    description: program.desc.replace(/<[^>]*>/g, '').trim(),
    category: categoryName,
    location: program.location.label,
    neighbourhood: '',
    dates: program.date_range,
    dateStart: program.date_range_start,
    dateEnd: program.date_range_end,
    days: program.days_of_week,
    time: program.time_range,
    ages: program.ages,
    ageMin: program.age_min_year,
    ageMax: program.age_max_year,
    fee: program.fee.label,
    isFree: program.fee.label === '' || program.fee.label === '$0.00',
    spotsTotal: program.total_open,
    spotsLeft: spotsLeft,
    isFull: program.urgent_message.status_description === 'Full',
    status: program.urgent_message.status_description,
    isDropoff: true,
    source: 'city',
    detailUrl: program.detail_url,
    enrollUrl: program.enroll_now.href
  };
}

async function run() {
  console.log('Starting Toronto programs fetch...');

  const cookies = await getSession();
  console.log('Session obtained');

  const categoryIds = CATEGORIES.map(c => c.id);
  let allPrograms = [];
  let page = 1;
  let totalPages = 1;

  do {
    console.log(`Fetching page ${page} of ${totalPages}...`);
    
    const data = await fetchPage(cookies, categoryIds, page);
    totalPages = Math.min(data.headers.page_info.total_page, 50);
    
    const programs = data.body.activity_items.map(p => {
      const cat = CATEGORIES.find(c => c.id === String(p.category_id)) || { name: 'General' };
      return normalize(p, cat.name);
    });

    allPrograms = allPrograms.concat(programs);
    page++;

    await new Promise(r => setTimeout(r, 500));

  } while (page <= totalPages);

  const output = {
    lastUpdated: new Date().toISOString(),
    totalPrograms: allPrograms.length,
    programs: allPrograms
  };

  fs.writeFileSync('programs.json', JSON.stringify(output, null, 2));
  console.log(`Done. Saved ${allPrograms.length} programs to programs.json`);
}

run().catch(console.error);
