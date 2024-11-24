/* global getNormalizedId */
const base = 'http://10.0.1.56/dmi/lib/exe/xmlrpc.php'; /* global getNormalizedId, vis */
const domParser = new DOMParser();
let isAuthenticated = false;
let debug = true;

function log(...args) {
  if (debug) console.log('[DokuWiki API]', ...args);
}

async function login(username, password) {
  try {
    log('Attempting login for user:', username);
    const result = await queryApi('dokuwiki.login', [username, password]);
    isAuthenticated = result === '1' || result === 'true';
    log('Login result:', isAuthenticated ? 'success' : 'failed', result);
    return isAuthenticated;
  } catch (error) {
    console.error('[DokuWiki API] Login failed:', error);
    return false;
  }
}

function createXmlRpc(method, params = []) {
  const xml = new DOMParser().parseFromString(
    '<?xml version="1.0"?><methodCall></methodCall>',
    'text/xml'
  );
  
  const methodName = xml.createElement('methodName');
  methodName.textContent = method;
  xml.documentElement.appendChild(methodName);
  
  if (params.length > 0) {
    const paramsEl = xml.createElement('params');
    params.forEach(param => {
      const paramEl = xml.createElement('param');
      const value = xml.createElement('value');
      let type;
      
      if (typeof param === 'string') {
        type = xml.createElement('string');
      } else if (typeof param === 'number') {
        type = xml.createElement('i4');
      } else if (typeof param === 'boolean') {
        type = xml.createElement('boolean');
        param = param ? '1' : '0';
      } else if (Array.isArray(param)) {
        type = xml.createElement('array');
        const data = xml.createElement('data');
        param.forEach(item => {
          const valueEl = xml.createElement('value');
          const strEl = xml.createElement('string');
          strEl.textContent = item.toString();
          valueEl.appendChild(strEl);
          data.appendChild(valueEl);
        });
        type.appendChild(data);
        param = '';
      } else if (typeof param === 'object') {
        type = xml.createElement('struct');
        Object.entries(param).forEach(([key, val]) => {
          const member = xml.createElement('member');
          const name = xml.createElement('name');
          name.textContent = key;
          const valueEl = xml.createElement('value');
          const strEl = xml.createElement('string');
          strEl.textContent = val.toString();
          valueEl.appendChild(strEl);
          member.appendChild(name);
          member.appendChild(valueEl);
          type.appendChild(member);
        });
        param = '';
      }
      
      type.textContent = param;
      value.appendChild(type);
      paramEl.appendChild(value);
      paramsEl.appendChild(paramEl);
    });
    xml.documentElement.appendChild(paramsEl);
  }
  
  const xmlString = new XMLSerializer().serializeToString(xml);
  log('XML-RPC Request:', method, params);
  log('XML Request:', xmlString);
  return xmlString;
}

function queryApi(method, params = []) {
  const xmlData = createXmlRpc(method, params);
  return fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml'
    },
    body: xmlData,
    credentials: 'include'
  }).then(async response => {
    const text = await response.text();
    log('Raw Response:', text);
    
    // For getPagelist, return raw XML text
    if (method === 'dokuwiki.getPagelist') {
      log('getPagelist Result:', text);
      return text;
    }
    
    try {
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      
      // Check for parsing errors
      const parseError = xml.querySelector('parsererror');
      if (parseError) {
        log('XML Parse Error:', parseError.textContent);
        throw new Error('XML Parse Error: ' + parseError.textContent);
      }
      
      // Handle different response formats
      const value = xml.querySelector('value');
      if (!value) {
        log('No value element found in response');
        return null;
      }
      
      let result;
      const stringVal = value.querySelector('string');
      const intVal = value.querySelector('i4') || value.querySelector('int');
      const boolVal = value.querySelector('boolean');
      
      if (stringVal) {
        result = stringVal.textContent;
      } else if (intVal) {
        result = parseInt(intVal.textContent);
      } else if (boolVal) {
        result = boolVal.textContent === '1';
      } else {
        result = value.textContent;
      }
      
      log('Parsed Result:', result);
      return result;
    } catch (e) {
      console.error('[DokuWiki API] XML Processing Error:', e);
      log('Failed Response Text:', text);
      throw e;
    }
  });
}

async function checkApiStatus() {
  try {
    log('Checking API status...');
    const version = await queryApi('dokuwiki.getVersion');
    log('DokuWiki Version:', version);
    const apiVersion = await queryApi('dokuwiki.getXMLRPCAPIVersion');
    log('API Version:', apiVersion);
    return true;
  } catch (error) {
    console.error('[DokuWiki API] Status check failed:', error);
    return false;
  }
}

async function getRandomArticle() {
  log('Fetching random article...');
  try {
    // Get list of all pages
    const xmlString = await queryApi('dokuwiki.getPagelist', ['', { depth: 0 }]);
    log('Got pages:', xmlString);

    // Regular expression to match <string>...</string>
    const regex = /<string>(.*?)<\/string>/g;

    // Use matchAll to find all matches
    const matches = xmlString.matchAll(regex);

    // Extract the captured group (content inside <string>) and populate the array
    const pages = Array.from(matches, match => match[1]);
    log('All pages:', pages);

    if (!Array.isArray(pages) || pages.length === 0) {
      log('No pages found');
      return null;
    }

    // Filter main namespace pages
    const mainPages = pages.filter(page => {
      return (
        typeof page === 'string' &&
        //!page.includes(':') && // Exclude pages with namespaces
        !page.startsWith('index:') &&
        !page.startsWith('playground:')
      );
    });

    log('Filtered main pages:', mainPages);

    if (mainPages.length === 0) {
      log('No main namespace pages found');
      return null;
    }

    // Try up to 10 random pages
    for (let i = 0; i < 10; i++) {
      const randomPage = mainPages[Math.floor(Math.random() * mainPages.length)];
      log('Trying random page:', randomPage);

      try {
        const perms = await queryApi('wiki.aclCheck', [randomPage]);
        log('ACL check result:', perms);

        if (perms && parseInt(perms) > 0) {
          log('Found accessible page:', randomPage);
          return randomPage;
        }
      } catch (e) {
        log('ACL check failed:', e);
      }
    }

    log('No accessible pages found after 10 attempts');
    return null;
  } catch (error) {
    console.error('[DokuWiki API] getRandomArticle failed:', error);
    return null;
  }
}


async function getSuggestions(search) {
  log('Searching for:', search);
  try {
    const results = await queryApi('dokuwiki.search', [search]);
    log('Search results:', results);
    
    if (!Array.isArray(results)) return [];
    
    return results
      .filter(page => typeof page === 'object' && page.id && !page.id.includes(':'))
      .map(page => page.id)
      .slice(0, 10);
  } catch (error) {
    console.error('[DokuWiki API] Search failed:', error);
    return [];
  }
}

async function getPageHtml(pageName) {
  try {
    const html = await queryApi('wiki.getPageHTML', [pageName]);
    return {
      document: domParser.parseFromString(html || '', 'text/html'),
      redirectedTo: pageName // DokuWiki doesn't support redirects
    };
  } catch (error) {
    console.error('[DokuWiki API] getPageHTML failed:', error);
    return null;
  }
}

async function getSubPages(pageName) {
  try {
    const page = await getPageHtml(pageName);
    if (!page) return { redirectedTo: pageName, links: [] };
    
    const firstParagraph = Array.from(page.document.querySelectorAll('p'))
      .find(p => p.textContent.trim().length > 0);
      
    if (!firstParagraph) return { redirectedTo: pageName, links: [] };
    
    const links = Array.from(firstParagraph.querySelectorAll('a'))
      .map(link => link.getAttribute('href'))
      .filter(href => href && !href.startsWith('http'))
      .map(href => href.split(':').pop())
      .filter(id => !id.includes(':'))
      .map(id => id.replace(/_/g, ' '));
    
    const ids = links.map(getNormalizedId);
    const uniqueLinks = links.filter((link, i) => 
      ids.indexOf(ids[i]) === i
    );
    
    return {
      redirectedTo: pageName,
      links: uniqueLinks
    };
  } catch (error) {
    console.error('[DokuWiki API] getSubPages failed:', error);
    return { redirectedTo: pageName, links: [] };
  }
}

async function fetchPageTitle(xmlString) {
  try {
    // Verify if the page exists
    const exists = await queryApi('wiki.getPage', [xmlString]);
    if (!exists) {
      log('Page does not exist');
      return null;
    }
    log('xmlString:',xmlString);
/*     // Regular expression to match the title inside <string> tags, allowing for newlines and extra spaces
    const regex = /<string>\s?={4,6}\s?(.*?)\s?={4,6}/gm

    // Match the first occurrence of the title
    const match = xmlString.match(regex);

    // Extract the title if there's a match
    const pageTitle = match ? match[0] : null;

    log('Page title:', pageTitle); */

    return xmlString;
  } catch (error) {
    console.error('[DokuWiki API] fetchPageTitle failed:', error);
    return null;
  }
}

// Export all required functions
window.getRandomArticle = getRandomArticle;
window.getSuggestions = getSuggestions;
window.getSubPages = getSubPages;
window.fetchPageTitle = fetchPageTitle;
window.login = login;
window.checkApiStatus = checkApiStatus;
window.setDebug = (enabled) => { debug = enabled; };
