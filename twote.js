const fs = require('fs');
const https = require('https');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const yargs = require('yargs');

var argv = require('yargs/yargs')(process.argv.slice(2))
  .option('start', {
    alias: 's',
    description: 'Person number to start at. (default: 0)',
    type: 'number'
  })
  .option('number', {
    alias: 'n',
    description: 'How many people to process. (default: all)',
    type: 'number'
  })
  .option('userid', {
    alias: 'u',
    description: 'A user ID number to start at. (default: null)',
    type: 'number'
  })
  /*
    On loading the initial page, there's a javascript redirect from the user's
    identifier number to their handle page. That takes about a second on most
    computers.

    The user's content is then dynamically loaded, so to get pinned tweets we
    must wait another two seconds.

     If your computer or connection are slow, you may need to increase this
     number further.
  */
  .option('delay', {
    alias: 'd',
    description: 'Milliseconds to wait for page to load. (default 3000)',
    type: 'number',
    default: 3000
  })
  .argv;


async function main() {
  const browser = await puppeteer.launch();

  let followingData;
  let followingStr;

  let output = [];

  try {
    followingStr = fs.readFileSync('./following.js', 'utf8');
  } catch (err) {
    console.error(err);
  }

  followingStr = followingStr.replace(/^window\.YTD\.following\.part0 = /, 'followingData = ');

  // Please do not chide me about using eval.
  eval(followingStr);

  // Free memory
  delete followingStr;

  let number = argv.number || followingData.length;
  let start = argv.start || 0;

  if(argv.userid) {
    for(let j = 0; j < followingData.length; j++) {
      if(followingData[j].following.accountId == argv.userid) {
        start = j;
        break;
      }
    }
  }

  // console.log('params:', start, number);

  let end = number + start;
  if(end > followingData.length) {
    end = followingData.length;
  }

  let fileArgs = {};
  let writeArgs = {
    includeEndRowDelimiter: true
  };

  // If this isn't the first record, append to the existing csv.
  if(start > 0) {
    fileArgs.flags = 'a';
  }

  let stream = fs.createWriteStream('output.csv', fileArgs);

  // If this *is* the first record, we need to write our headers.
  if(start == 0) {
    await write(stream, ['Name', 'Username', 'Possible Accounts']);
  }


  for(let i = start; i < end; i++) {
    console.log(`${i} Fetching ` + followingData[i].following.accountId);
    let url = followingData[i].following.userLink;
    // url = 'https://twitter.com/intent/user?user_id=YOURACCTNUMBERHERE' /*** DEBUG ***/

    let userData = await getUser(url);
    let user = scrapeUser(userData);
    user.links = processUserData(user);

    // console.log(user);

    await write(stream, [user.name, user.handle, ...user.links]);
  }

  browser.close();
  stream.close();

  /* Function Hoisting */

  async function getUser(url) {
    const pg = await browser.newPage();
    await pg.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');
    await pg.goto(url);
    await pg.waitForTimeout(argv.delay);
    let body = await pg.evaluate(() => document.body.innerHTML);
    await pg.close();

    // TODO: Some error handling here probably.

    return body;
  }

  function scrapeUser(data) {
    let user = {}

    const $ = cheerio.load(data);

    // Users may have @s in their name, so we need to account for that.
    let name = $('[data-testid=UserName]').text().split('@');

    user.handle = clean('@'+name.pop()); // The last @name is the user's handle.
    user.name = clean(name.join('@')); // Everything else is their name-name.

    user.profile = $('[data-testid=UserDescription]').text();

    // Try to find a pinned tweet.
    try {
      const pinned = $('article[data-testid=tweet]').first();
      if($(pinned).find('[data-testid=socialContext]').text().trim().toLowerCase() == 'pinned tweet') {
        user.pinned = $(pinned).find('[data-testid=tweetText]').text();
      }
    } catch(e) { /* do nothing, most people don't have pinned tweets. */ }

    // TODO: Some better error handling here probably.
    if(!user.handle) console.error('Something went wrong!')

    return user;
  }

  function processUserData(user) {
    let results = [];
    results = results.concat(findMastodonLinks(user.name));
    results = results.concat(findMastodonLinks(user.profile));
    if(user.pinned) {
      results = results.concat(findMastodonLinks(user.pinned));
    }

    return results;
  }

  function findMastodonLinks(str) {
    let results = [];

    // https://github.com/mastodon/mastodon/blob/main/app/models/account.rb#L64
    const USERNAME_REGEX = /(@[a-z0-9_]+([a-z0-9_\.-]+[a-z0-9_]+)?)/;

    // https://stackoverflow.com/a/26987741
    const DOMAIN_REGEX = /((((?!\-))(xn\-\-)?[a-z0-9\-_]{0,61}[a-z0-9]{1,1}\.)*(xn\-\-)?([a-z0-9\-]{1,61}|[a-z0-9\-]{1,30})\.[a-z]{2,})/;

    // We are searching for two common patterns:
    // 1. @somethingsomething@something.something (Highest confidence.)
    const form1 = new RegExp(USERNAME_REGEX.source + '@' + DOMAIN_REGEX.source, 'ig');
    const results1 = str.matchAll(form1);

    if(results1) {
      // We have an interator not an array so can't just map() and concat()
      for(const match of results1) {
        // console.log('match', match);
        // console.log('---------------------------');
        results.push(match[0]);
      }
    }

    // 2. something.something/@something (Might give a lot of false positives.)
    const form2 = new RegExp(DOMAIN_REGEX.source + '/' + USERNAME_REGEX.source, 'ig');
    const results2 = str.matchAll(form2);

    if(results2) {
      // We have an interator not an array so can't just map() and concat()
      for(const match of results2) {
        // console.log('match', match);
        // console.log('---------------------------');
        results.push(match[0]);
      }
    }
    // console.log(results);

    for(let k = 0; k < results.length; k++) {
      results[k] = clean(results[k]);
    }

    // Remove duplicates
    results = [...new Set(results)];

    return results;
  }

  function write(stream, output) {
    let line  = output.join(',') + "\n";
    return stream.write(line);
  }

  function clean(output) {
    // Remove commas and newlines.
    return output
      .replace(/,/g, ' ')
      .replace(/(?:\r\n|\r|\n)/g, ' ')
      .trim();
  }
}

main().then(() => console.log('Done'));
