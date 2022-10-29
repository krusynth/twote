const fs = require('fs');
const https = require('https');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { writeToStream } = require('@fast-csv/format');
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
    description: 'A user ID number to start at. (defualt: null)',
    type: 'number'
  }).argv;

/* Config */

// Theres a javascript redirect we need to account for. If your machine or
// connection are slow, you may need to increase this number.
const delay = 1000; // milliseconds

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

  for(let i = start; i < (number + start); i++) {
    console.log(`${i} Fetching ` + followingData[i].following.accountId);
    let url = followingData[i].following.userLink;
    // url = 'https://twitter.com/intent/user?user_id=YOURACCTNUMBERHERE' /*** DEBUG ***/

    let user = scrapeUser(await getUser(url));
    user.links = processUserData(user);

    // console.log(user);

    output.push([user.name, user.handle, ...user.links]);
  }

  browser.close();

  let fileArgs = {};
  let writeArgs = {
    includeEndRowDelimiter: true
  };

  if(start > 0) {
    fileArgs.flags = 'a';
  }
  else {
    output.unshift(['Name', 'Username', 'Possible Accounts']);
  }

  return new Promise((resolve, reject) => {
    let stream = fs.createWriteStream('output.csv', fileArgs);

    writeToStream(stream, output, writeArgs)
      .on('error', err => reject(err))
      .on('finish', () => resolve());
  });

  /* Function Hoisting */

  async function getUser(url) {
    const pg = await browser.newPage();
    await pg.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');
    await pg.goto(url);
    await pg.waitForTimeout(delay);
    let body = await pg.evaluate(() => document.body.innerHTML);
    await pg.close();

    // TODO: Some error handling here probably.

    return body;
  }

  function scrapeUser(data) {
    let user = {}

    const $ = cheerio.load(data);

    // This is ugly. The html generated on this page is unsemantic css-class noise.
    // Those classes appear to change over time. We brute force regex the user data.
    // Users may have @s in their name, so we need to account for that.

    let name = $('[data-testid=UserName]').text().split('@');

    user.handle = '@'+name.pop(); // The last @name is the user's handle.
    user.name = name.join('@'); // Everything else is their name-name.

    user.profile = $('[data-testid=UserDescription]').text();

    // TODO: Some better error handling here probably.
    if(!user.handle) console.error('Something went wrong!')

    return user;
  }

  function processUserData(user) {
    let results = [];
    results = results.concat(findMastodonLinks(user.name));
    results = results.concat(findMastodonLinks(user.profile));

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

    return results;
  }
}

main().then(() => console.log('Done'));
